import test from 'node:test';
import assert from 'node:assert/strict';

import { parseProject } from './projects.js';
import {
  serializeRecord, savePage, savePreflight, saveBrief, saveCoworkerSession, saveKeywords,
  saveApprovals, saveStageState,
} from './stage-state.js';

// A fake daFetch backed by a single in-memory record: a GET (no options) reads
// it; a POST captures the written blob. Lets the merging save functions run
// their real read-modify-write against real serialize/parse, no logic mocked.
function fakeDa(record) {
  const writes = [];
  const daFetch = async (url, opts) => {
    if (!opts) return { ok: true, json: async () => record };
    const text = await opts.body.get('data').text();
    writes.push(JSON.parse(text));
    return { ok: true, status: 200, statusText: 'OK' };
  };
  return { daFetch, writes };
}

const ctx = { org: 'o', repo: 's' };
const page = {
  generatedAt: '2026-01-01T00:00:00Z',
  path: '/products/foo',
  previewUrl: 'https://main--r--o.aem.page/products/foo',
  editUrl: 'https://da.live/edit',
  status: 'generated',
};
const preflight = {
  ranAt: '2026-01-02T00:00:00Z',
  categories: [{
    name: 'Web performance', passed: 8, total: 10, score: 80, source: 'psi',
  }],
};

test('serializeRecord round-trips page and preflight through parseProject', () => {
  const stages = [{
    stage: 'a', stageIndex: 1, status: 'Complete', steps: [],
  }];
  const model = parseProject(
    serializeRecord({ slug: 'x' }, stages, [], null, null, null, page, preflight),
  );
  assert.deepEqual(model.page, page);
  assert.deepEqual(model.preflight, preflight);
});

test('savePage merges the change and preserves the other stage sheets', async () => {
  const brief = {
    title: 'T', body: 'B', destinationUrl: '/d', links: [{ label: 'L', url: '/u', description: '' }],
  };
  const record = serializeRecord({ slug: 'x' }, [], [{ text: 'k', role: 'primary' }], null, null, brief);
  const { daFetch, writes } = fakeDa(record);

  const saved = await savePage(ctx, daFetch, 'x', { path: '/new', status: 'generated' });
  assert.equal(saved.path, '/new');

  const written = parseProject(writes[0]);
  assert.equal(written.page.path, '/new');
  assert.equal(written.page.status, 'generated');
  assert.equal(written.brief.title, 'T');
  assert.deepEqual(written.keywords, [{ text: 'k', role: 'primary' }]);
});

test('saveBrief preserves the page and preflight sheets across its write', async () => {
  const record = serializeRecord({ slug: 'x' }, [], [], null, null, null, page, preflight);
  const { daFetch, writes } = fakeDa(record);

  await saveBrief(ctx, daFetch, 'x', { title: 'New' });

  const written = parseProject(writes[0]);
  assert.equal(written.brief.title, 'New');
  assert.deepEqual(written.page, page);
  assert.deepEqual(written.preflight, preflight);
});

test('savePreflight preserves the page sheet across its write', async () => {
  const record = serializeRecord({ slug: 'x' }, [], [], null, null, null, page, null);
  const { daFetch, writes } = fakeDa(record);

  await savePreflight(ctx, daFetch, 'x', preflight);

  const written = parseProject(writes[0]);
  assert.deepEqual(written.preflight, preflight);
  assert.deepEqual(written.page, page);
});

test('saveCoworkerSession stores the episode id keyed by user', async () => {
  const record = serializeRecord({ slug: 'x' }, [], [], null, null, null, page, preflight);
  const { daFetch, writes } = fakeDa(record);

  await saveCoworkerSession(ctx, daFetch, 'x', { userId: 'a@x.com', sessionId: '7301' });

  const written = parseProject(writes[0]);
  assert.equal(written.coworkerSessions.length, 1);
  assert.equal(written.coworkerSessions[0].userId, 'a@x.com');
  assert.equal(written.coworkerSessions[0].sessionId, '7301');
  assert.ok(written.coworkerSessions[0].startedAt);
  // The rest of the record survives the write.
  assert.deepEqual(written.page, page);
  assert.deepEqual(written.preflight, preflight);
});

test('saveCoworkerSession replaces only the calling producer\'s row', async () => {
  const rows = [{ userId: 'a@x.com', sessionId: '1', startedAt: 't1' }];
  const record = serializeRecord({ slug: 'x' }, [], [], null, null, null, null, null, rows);
  const { daFetch, writes } = fakeDa(record);

  await saveCoworkerSession(ctx, daFetch, 'x', { userId: 'b@x.com', sessionId: '2' });

  const written = parseProject(writes[0]);
  assert.deepEqual(
    written.coworkerSessions.map((r) => [r.userId, r.sessionId]).sort(),
    [['a@x.com', '1'], ['b@x.com', '2']],
  );
});

test('saveCoworkerSession with no id drops the row (a refused episode is forgotten)', async () => {
  const rows = [
    { userId: 'a@x.com', sessionId: '1', startedAt: 't1' },
    { userId: 'b@x.com', sessionId: '2', startedAt: 't2' },
  ];
  const record = serializeRecord({ slug: 'x' }, [], [], null, null, null, null, null, rows);
  const { daFetch, writes } = fakeDa(record);

  await saveCoworkerSession(ctx, daFetch, 'x', { userId: 'a@x.com', sessionId: null });

  const written = parseProject(writes[0]);
  assert.deepEqual(written.coworkerSessions.map((r) => r.userId), ['b@x.com']);
});

test('another stage write preserves the coworkerSessions sheet', async () => {
  const rows = [{ userId: 'a@x.com', sessionId: '7301', startedAt: 't1' }];
  const record = serializeRecord({ slug: 'x' }, [], [], null, null, null, null, null, rows);
  const { daFetch, writes } = fakeDa(record);

  await saveKeywords(ctx, daFetch, 'x', [{ text: 'k', role: 'primary' }]);

  assert.deepEqual(parseProject(writes[0]).coworkerSessions, rows);
});

test('saveApprovals stores one stage\'s sign-offs and keeps the rest of the record', async () => {
  const record = serializeRecord({ slug: 'x' }, [], [], null, null, null, page, preflight);
  const { daFetch, writes } = fakeDa(record);

  const saved = await saveApprovals(ctx, daFetch, 'x', {
    stageIndex: 4,
    approvals: [
      { name: 'Content', approved: true, approvedAt: '2026-01-05T00:00:00Z' },
      { name: 'Compliance', approved: false, approvedAt: '' },
    ],
  });
  assert.equal(saved.length, 2);

  const written = parseProject(writes[0]);
  assert.deepEqual(written.approvals, [
    {
      stageIndex: 4, name: 'Content', approved: true, approvedAt: '2026-01-05T00:00:00Z',
    },
    {
      stageIndex: 4, name: 'Compliance', approved: false, approvedAt: '',
    },
  ]);
  assert.deepEqual(written.page, page);
  assert.deepEqual(written.preflight, preflight);
});

test('saveApprovals replaces only the named stage - other stages keep their sign-offs', async () => {
  const rows = [
    {
      stageIndex: 4, name: 'Content', approved: true, approvedAt: 't1',
    },
    {
      stageIndex: 5, name: 'Compliance', approved: true, approvedAt: 't2',
    },
  ];
  const record = serializeRecord({ slug: 'x' }, [], [], null, null, null, null, null, [], rows);
  const { daFetch, writes } = fakeDa(record);

  await saveApprovals(ctx, daFetch, 'x', {
    stageIndex: 4,
    approvals: [{ name: 'Content', approved: false, approvedAt: '' }],
  });

  const written = parseProject(writes[0]);
  assert.deepEqual(written.approvals, [
    {
      stageIndex: 5, name: 'Compliance', approved: true, approvedAt: 't2',
    },
    {
      stageIndex: 4, name: 'Content', approved: false, approvedAt: '',
    },
  ]);
});

test('another stage write preserves the approvals sheet', async () => {
  const rows = [{
    stageIndex: 4, name: 'Content', approved: true, approvedAt: 't1',
  }];
  const record = serializeRecord({ slug: 'x' }, [], [], null, null, null, null, null, [], rows);
  const { daFetch, writes } = fakeDa(record);

  await savePreflight(ctx, daFetch, 'x', preflight);

  assert.deepEqual(parseProject(writes[0]).approvals, rows);
});

test('saveStageState preserves the approvals sheet across a status write', async () => {
  const stages = [
    {
      stage: 'Page Generation', stageIndex: 4, status: 'In Progress', steps: [],
    },
  ];
  const rows = [{
    stageIndex: 4, name: 'Content', approved: true, approvedAt: 't1',
  }];
  const record = serializeRecord({ slug: 'x' }, stages, [], null, null, null, null, null, [], rows);
  const { daFetch, writes } = fakeDa(record);
  const project = parseProject(record);

  await saveStageState(ctx, daFetch, 'x', project, { stageIndex: 4, status: 'Approved' });

  const written = parseProject(writes[0]);
  assert.equal(written.stages[0].status, 'Approved');
  assert.deepEqual(written.approvals, rows);
});
