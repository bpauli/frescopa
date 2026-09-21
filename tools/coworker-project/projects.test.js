import test from 'node:test';
import assert from 'node:assert/strict';

import { parseProject } from './projects.js';
import { serializeRecord } from './stage-state.js';

test('parseProject reads the page sheet onto the view model', () => {
  const page = {
    generatedAt: '2026-01-01T00:00:00Z',
    path: '/products/foo',
    previewUrl: 'https://main--r--o.aem.page/products/foo',
    editUrl: 'https://da.live/edit',
    status: 'generated',
  };
  const record = serializeRecord({ slug: 'x' }, [], [], null, null, null, page);
  assert.deepEqual(parseProject(record).page, page);
});

test('parseProject reads the preflight sheet (row per category) onto the view model', () => {
  const preflight = {
    ranAt: '2026-01-02T00:00:00Z',
    categories: [
      {
        name: 'Web performance', passed: 8, total: 10, score: 80, source: 'psi',
      },
      {
        name: 'LLM visibility', passed: 3, total: 5, score: 60, source: 'ai',
      },
    ],
  };
  const record = serializeRecord({ slug: 'x' }, [], [], null, null, null, null, preflight);
  assert.deepEqual(parseProject(record).preflight, preflight);
});

test('parseProject defaults page and preflight when the sheets are absent', () => {
  const model = parseProject(serializeRecord({ slug: 'x' }, [], [], null, null, null));
  assert.deepEqual(model.page, {
    generatedAt: '', path: '', previewUrl: '', editUrl: '', status: '',
  });
  assert.deepEqual(model.preflight, { ranAt: '', categories: [] });
});

test('parseProject reads the coworkerSessions sheet (row per producer)', () => {
  const rows = [
    { userId: 'a@x.com', sessionId: '7301', startedAt: '2026-01-03T00:00:00Z' },
    { userId: 'b@x.com', sessionId: '7302', startedAt: '2026-01-04T00:00:00Z' },
  ];
  const record = serializeRecord({ slug: 'x' }, [], [], null, null, null, null, null, rows);
  assert.deepEqual(parseProject(record).coworkerSessions, rows);
});

test('parseProject yields no coworker sessions for an older record without the sheet', () => {
  // A v6 record: no `coworkerSessions` sheet -> [] -> the first AO call opens a
  // new chat and the id is written on the next save. No migration needed.
  const v6 = serializeRecord({ slug: 'x' }, []);
  delete v6.coworkerSessions;
  v6[':version'] = 6;
  assert.deepEqual(parseProject(v6).coworkerSessions, []);
});

test('parseProject drops coworker-session rows missing a user or an id', () => {
  const record = serializeRecord({ slug: 'x' }, []);
  record.coworkerSessions.data = [
    { userId: 'a@x.com', sessionId: '', startedAt: '' },
    { userId: '', sessionId: '7301', startedAt: '' },
    { userId: 'b@x.com', sessionId: 7302, startedAt: '' },
  ];
  assert.deepEqual(parseProject(record).coworkerSessions, [
    { userId: 'b@x.com', sessionId: '7302', startedAt: '' },
  ]);
});

test('parseProject reads the approvals sheet (row per sign-off, keyed by stage)', () => {
  const approvals = [
    {
      stageIndex: 4, name: 'Content', approved: true, approvedAt: '2026-01-05T00:00:00Z',
    },
    {
      stageIndex: 5, name: 'Compliance', approved: false, approvedAt: '',
    },
  ];
  const record = serializeRecord({ slug: 'x' }, [], [], null, null, null, null, null, [], approvals);
  assert.deepEqual(parseProject(record).approvals, approvals);
});

test('parseProject yields no approvals for an older record without the sheet', () => {
  // A v7 record: no `approvals` sheet -> [] -> every sign-off opens pending.
  const v7 = serializeRecord({ slug: 'x' }, []);
  delete v7.approvals;
  v7[':version'] = 7;
  assert.deepEqual(parseProject(v7).approvals, []);
});

test('parseProject drops approval rows missing a stage or a name', () => {
  const record = serializeRecord({ slug: 'x' }, []);
  record.approvals.data = [
    { stageIndex: 0, name: 'Content', approved: true },
    { stageIndex: 4, name: '', approved: true },
    { stageIndex: '4', name: 'Compliance', approved: 'true' },
  ];
  assert.deepEqual(parseProject(record).approvals, [
    {
      stageIndex: 4, name: 'Compliance', approved: true, approvedAt: '',
    },
  ]);
});

test('parseProject reads the assets sheet (row per page image slot)', () => {
  const assets = [
    {
      id: 'asset-0',
      slot: 0,
      alt: 'Hero',
      prompt: 'A hero shot',
      status: 'Generated',
      sourceUrl: 'https://firefly.example/hero.png',
      mediaUrl: '',
      model: 'image4_standard',
      aspect: '16:9',
      visualStyle: 'Editorial',
      palette: 'Warm',
      description: 'A hero image',
      createdAt: '2026-01-06T00:00:00Z',
    },
  ];
  const record = serializeRecord({ slug: 'x' }, [], [], null, null, null, null, null, [], [], assets);
  assert.deepEqual(parseProject(record).assets, assets);
});

test('parseProject yields no assets for an older record without the sheet', () => {
  // A v8 record: no `assets` sheet -> [] -> Stage 5 starts empty. No migration.
  const v8 = serializeRecord({ slug: 'x' }, []);
  delete v8.assets;
  v8[':version'] = 8;
  assert.deepEqual(parseProject(v8).assets, []);
});

test('parseProject drops asset rows without a usable slot', () => {
  const record = serializeRecord({ slug: 'x' }, []);
  record.assets.data = [
    { id: 'a', slot: 'x' },
    { id: 'b' },
    { id: 'c', slot: '2' },
  ];
  const parsed = parseProject(record).assets;
  assert.equal(parsed.length, 1);
  assert.equal(parsed[0].id, 'c');
  assert.equal(parsed[0].slot, 2);
});
