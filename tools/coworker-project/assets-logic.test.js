import test from 'node:test';
import assert from 'node:assert/strict';

import {
  FIREFLY_URL,
  pagePath,
  assetRow,
  assetRecord,
  mergeAssets,
  thumbnailCandidates,
  assetState,
  assetTitle,
  gridRows,
  assetCount,
  slotJobs,
  swappableAssets,
} from './assets-logic.js';

// A page doc slot, as `extractSlots` (#59) hands it out.
const slot = (index, alt) => ({
  slot: index,
  alt,
  src: `https://placehold.co/1600x900/e9e9e9/6b6b6b?text=${encodeURIComponent(alt)}`,
  aspect: '16:9',
});

// A generation result, as `generateAssets` (#59) hands it back.
const result = (index, over = {}) => ({
  slot: index,
  prompt: 'A cup of coffee.',
  aspect: '16:9',
  sourceUrl: `https://firefly.example/${index}.jpg?X-Amz-Expires=3600`,
  model: 'image4_standard',
  description: 'A cup of coffee on a table.',
  seed: 42,
  jobId: 'job-1',
  width: 2688,
  height: 1512,
  createdAt: '2026-09-21T10:00:00.000Z',
  status: 'Generated',
  error: null,
  ...over,
});

const DIRECTION = {
  visualStyle: { name: 'Warm editorial', description: 'Soft daylight, shallow depth' },
  colorPalette: { name: 'Roasted', colors: ['#3b2313', '#c98f5a'] },
};

// --- pagePath ---

test('pagePath reads the page path the doc, swap and preview are keyed by', () => {
  assert.equal(pagePath({ path: '/drafts/coffee' }), '/drafts/coffee');
  assert.equal(pagePath({ path: '/drafts/coffee.html' }), '/drafts/coffee');
});

test('pagePath falls back to the preview URL when the record carries no path', () => {
  assert.equal(
    pagePath({ previewUrl: 'https://main--frescopa--bpauli.aem.page/drafts/coffee' }),
    '/drafts/coffee',
  );
});

test('pagePath answers empty for a project with no page, which is the idle state', () => {
  assert.equal(pagePath(null), '');
  assert.equal(pagePath({}), '');
  assert.equal(pagePath({ path: '' }), '');
});

// --- assetRow ---

test('assetRow builds the sheet row from the result, the slot and the direction', () => {
  const row = assetRow(result(1), slot(1, 'Green beans drying'), DIRECTION);
  assert.equal(row.id, 'slot-1');
  assert.equal(row.slot, 1);
  assert.equal(row.alt, 'Green beans drying');
  assert.equal(row.aspect, '16:9');
  assert.equal(row.status, 'Generated');
  assert.equal(row.model, 'image4_standard');
  assert.equal(row.visualStyle, 'Warm editorial');
  assert.equal(row.palette, 'Roasted');
  assert.equal(row.createdAt, '2026-09-21T10:00:00.000Z');
  assert.equal(row.error, null);
});

test('assetRow keeps a failed slot as a soft row rather than dropping it', () => {
  const row = assetRow(
    result(2, { status: 'Failed', sourceUrl: '', error: 'Firefly did not finish this slot.' }),
    slot(2, 'A roastery'),
    DIRECTION,
  );
  assert.equal(row.status, 'Failed');
  assert.equal(row.sourceUrl, '');
  assert.equal(row.error, 'Firefly did not finish this slot.');
  assert.equal(row.alt, 'A roastery');
});

test('assetRow falls back to the palette colours when the palette has no name', () => {
  const row = assetRow(result(0), slot(0, 'Beans'), { colorPalette: { colors: ['#111', '#222'] } });
  assert.equal(row.palette, '#111, #222');
});

test('assetRow survives a missing slot and a missing creative direction', () => {
  const row = assetRow(result(0));
  assert.equal(row.slot, 0);
  assert.equal(row.alt, '');
  assert.equal(row.visualStyle, '');
  assert.equal(row.palette, '');
});

// --- assetRecord ---

test('assetRecord drops the transient soft error, which has no sheet column', () => {
  const row = assetRow(result(0, { status: 'Failed', error: 'nope' }), slot(0, 'Beans'), DIRECTION);
  const record = assetRecord(row);
  assert.equal('error' in record, false);
  assert.equal(record.status, 'Failed');
  assert.equal(record.slot, 0);
});

// --- mergeAssets ---

test('mergeAssets replaces exactly one slot and leaves the others alone', () => {
  const existing = [
    { slot: 0, sourceUrl: 'a' },
    { slot: 1, sourceUrl: 'b' },
    { slot: 2, sourceUrl: 'c' },
  ];
  const merged = mergeAssets(existing, [{ slot: 1, sourceUrl: 'NEW' }]);
  assert.deepEqual(merged.map((r) => r.sourceUrl), ['a', 'NEW', 'c']);
});

test('mergeAssets adds a slot that was not held yet, in slot order', () => {
  const merged = mergeAssets([{ slot: 3 }], [{ slot: 0 }, { slot: 1 }]);
  assert.deepEqual(merged.map((r) => r.slot), [0, 1, 3]);
});

test('mergeAssets ignores rows without a usable slot', () => {
  const merged = mergeAssets([{ slot: 0 }], [{ slot: 'x' }, null, undefined, {}]);
  assert.deepEqual(merged.map((r) => r.slot), [0]);
});

test('mergeAssets handles missing lists', () => {
  assert.deepEqual(mergeAssets(null, undefined), []);
});

// --- thumbnailCandidates ---

test('thumbnailCandidates prefers the Firefly image, then DA, then the placeholder', () => {
  const list = thumbnailCandidates(
    { sourceUrl: 'https://firefly.example/0.jpg', mediaUrl: 'https://content.da.live/o/s/a.jpg' },
    slot(0, 'Beans'),
  );
  assert.equal(list.length, 3);
  assert.equal(list[0], 'https://firefly.example/0.jpg');
  assert.equal(list[1], 'https://content.da.live/o/s/a.jpg');
  assert.ok(list[2].includes('placehold.co'));
});

test('thumbnailCandidates keeps the placeholder as the last resort for a failed slot', () => {
  const list = thumbnailCandidates({ sourceUrl: '', mediaUrl: '' }, slot(0, 'Beans'));
  assert.equal(list.length, 1);
  assert.ok(list[0].includes('placehold.co'));
});

test('thumbnailCandidates drops anything that is not an http URL, and duplicates', () => {
  assert.deepEqual(thumbnailCandidates({ sourceUrl: 'not a url' }, {}), []);
  assert.deepEqual(
    thumbnailCandidates({ sourceUrl: 'https://x/a.jpg', mediaUrl: 'https://x/a.jpg' }, {}),
    ['https://x/a.jpg'],
  );
});

// --- assetState ---

test('assetState reads a generating slot as progress, whatever it holds', () => {
  assert.equal(assetState({ status: 'Generated', sourceUrl: 'https://x/a.jpg' }, true), 'generating');
  assert.equal(assetState({}, true), 'generating');
});

test('assetState reads a generated slot with an image as ready', () => {
  assert.equal(assetState({ status: 'Generated', sourceUrl: 'https://x/a.jpg' }), 'ready');
  assert.equal(assetState({ status: 'Generated', mediaUrl: 'https://x/a.jpg' }), 'ready');
});

test('assetState degrades a slot that came back without an image to failed', () => {
  assert.equal(assetState({ status: 'Failed', sourceUrl: '' }), 'failed');
  assert.equal(assetState({ status: 'Generated', sourceUrl: '' }), 'empty');
  assert.equal(assetState({ error: 'Could not store the image.' }), 'failed');
});

test('assetState reads a slot nobody has asked for yet as empty', () => {
  assert.equal(assetState({ slot: 0 }), 'empty');
  assert.equal(assetState(null), 'empty');
});

// --- assetTitle ---

test('assetTitle names an asset with what the page says the picture shows', () => {
  assert.equal(assetTitle({ slot: 0, alt: 'Green beans drying' }), 'Green beans drying');
});

test('assetTitle keeps only the first sentence, so a caption stays a caption', () => {
  assert.equal(
    assetTitle({ slot: 0, alt: 'Green beans drying. Steam rises behind them.' }),
    'Green beans drying',
  );
});

test('assetTitle does not follow the per-run description, which a Regenerate replaces', () => {
  // Settled at #62 (ADR 0002): the caption must not rename itself with the image.
  assert.equal(assetTitle({ slot: 1, description: 'A roastery at dawn.' }), 'Image 2');
  assert.equal(assetTitle({ slot: 2 }), 'Image 3');
  assert.equal(assetTitle({}), 'Image');
});

// --- gridRows ---

test('gridRows shows one card per placeholder slot before anything is generated', () => {
  const cards = gridRows([slot(0, 'Beans'), slot(1, 'A roastery')], []);
  assert.deepEqual(cards.map((c) => c.slot), [0, 1]);
  assert.deepEqual(cards.map((c) => c.state), ['empty', 'empty']);
  assert.equal(cards[0].label, 'Beans');
  assert.ok(cards[0].thumbnails[0].includes('placehold.co'));
});

test('gridRows keeps the card of a slot whose placeholder is already swapped', () => {
  // After the swap the doc holds no placeholder for slot 0 any more.
  const assets = [assetRow(result(0), slot(0, 'Beans'), DIRECTION)];
  const cards = gridRows([slot(1, 'A roastery')], assets);
  assert.deepEqual(cards.map((c) => c.slot), [0, 1]);
  assert.equal(cards[0].state, 'ready');
  assert.equal(cards[1].state, 'empty');
});

test('gridRows merges a saved row onto its slot without losing the placeholder', () => {
  const assets = [assetRow(result(0), slot(0, 'Beans'), DIRECTION)];
  const [card] = gridRows([slot(0, 'Beans')], assets);
  assert.equal(card.state, 'ready');
  assert.equal(card.model, 'image4_standard');
  assert.equal(card.thumbnails.length, 2);
  assert.ok(card.thumbnails.at(-1).includes('placehold.co'));
});

test('gridRows marks the slots whose generation is in flight', () => {
  const cards = gridRows([slot(0, 'Beans'), slot(1, 'A roastery')], [], [1]);
  assert.deepEqual(cards.map((c) => c.state), ['empty', 'generating']);
});

test('gridRows degrades a failed slot softly, still showing its placeholder', () => {
  const assets = [assetRow(
    result(0, { status: 'Failed', sourceUrl: '', error: 'Firefly did not finish this slot.' }),
    slot(0, 'Beans'),
    DIRECTION,
  )];
  const [card] = gridRows([slot(0, 'Beans')], assets);
  assert.equal(card.state, 'failed');
  assert.equal(card.error, 'Firefly did not finish this slot.');
  assert.equal(card.thumbnails.length, 1);
  assert.ok(card.thumbnails[0].includes('placehold.co'));
});

test('gridRows keeps document order by slot, whatever order the rows arrive in', () => {
  const assets = [{ slot: 2, status: 'Generated', sourceUrl: 'https://x/2.jpg' },
    { slot: 0, status: 'Generated', sourceUrl: 'https://x/0.jpg' }];
  const cards = gridRows([slot(1, 'Middle')], assets);
  assert.deepEqual(cards.map((c) => c.slot), [0, 1, 2]);
});

test('gridRows survives missing slots, missing assets and unusable rows', () => {
  assert.deepEqual(gridRows(null, null), []);
  assert.deepEqual(gridRows(undefined, [{ slot: 'x' }, null]), []);
});

// --- assetCount ---

test('assetCount counts the cards that carry an image, out of the page slots', () => {
  const assets = [assetRow(result(0), slot(0, 'Beans'), DIRECTION)];
  const cards = gridRows([slot(0, 'Beans'), slot(1, 'A roastery')], assets);
  const count = assetCount(cards);
  assert.equal(count.ready, 1);
  assert.equal(count.total, 2);
  assert.equal(count.label, '1 of 2 assets');
});

test('assetCount does not count a generating or failed slot as an asset', () => {
  const cards = gridRows([slot(0, 'Beans'), slot(1, 'A roastery')], [], [0]);
  assert.equal(assetCount(cards).label, '0 of 2 assets');
});

test('assetCount reads a single slot in the singular, and no slots at all', () => {
  assert.equal(assetCount(gridRows([slot(0, 'Beans')], [])).label, '0 of 1 asset');
  assert.equal(assetCount([]).label, '0 of 0 assets');
  assert.equal(assetCount(null).label, '0 of 0 assets');
});

// --- slotJobs ---

test('slotJobs builds one prompt per slot from the alt and the creative direction', () => {
  const [job] = slotJobs([slot(0, 'Green beans drying in the sun')], DIRECTION);
  assert.equal(job.slot, 0);
  assert.equal(job.aspect, '16:9');
  assert.ok(job.prompt.includes('Green beans drying in the sun.'));
  assert.ok(job.prompt.includes('Warm editorial'));
  assert.ok(job.prompt.includes('Roasted'));
});

test('slotJobs rebuilds the prompt from the card, so a changed direction is picked up', () => {
  const card = { slot: 1, alt: 'A roastery at dawn', aspect: '16:9' };
  const [job] = slotJobs([card], { visualStyle: { name: 'Cold documentary' } });
  assert.ok(job.prompt.includes('Cold documentary'));
});

test('slotJobs skips a card without a usable slot', () => {
  assert.deepEqual(slotJobs([{ alt: 'no slot' }, null], DIRECTION), []);
  assert.deepEqual(slotJobs(null, DIRECTION), []);
});

// --- swappableAssets ---

test('swappableAssets keeps only the rows that actually hold an image', () => {
  const rows = [
    { slot: 0, sourceUrl: 'https://x/0.jpg' },
    { slot: 1, sourceUrl: '', mediaUrl: 'https://content.da.live/o/s/1.jpg' },
    { slot: 2, sourceUrl: '', mediaUrl: '' },
  ];
  assert.deepEqual(swappableAssets(rows).map((r) => r.slot), [0, 1]);
});

test('swappableAssets leaves a failed slot out, so it keeps its placeholder', () => {
  const failed = assetRow(result(0, { status: 'Failed', sourceUrl: '' }), slot(0, 'Beans'));
  assert.deepEqual(swappableAssets([failed]), []);
  assert.deepEqual(swappableAssets(null), []);
});

// --- the link out ---

test('Go to Firefly points at the producer Firefly workspace', () => {
  assert.ok(FIREFLY_URL.startsWith('https://firefly.adobe.com/'));
});
