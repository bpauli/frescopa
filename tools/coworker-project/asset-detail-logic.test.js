import test from 'node:test';
import assert from 'node:assert/strict';

import {
  MODEL_NOTE,
  assetTitle,
  formatCreatedAt,
  detailFields,
  imageCandidates,
  downloadName,
  regenerationJob,
  assetRow,
} from './asset-detail-logic.js';

const AT = '2026-01-12T09:30:00.000Z';

// A full assets-sheet row (#58), as the detail view receives it.
const row = (over = {}) => ({
  id: 'slot-2',
  slot: 2,
  alt: 'A barista pouring a flat white on a marble counter',
  prompt: 'A barista pouring a flat white on a marble counter. Visual style: Warm editorial.',
  status: 'Swapped',
  sourceUrl: 'https://firefly.s3.amazonaws.com/out.jpg?X-Amz-Expires=3600',
  mediaUrl: 'https://content.da.live/bpauli/frescopa/projects/coffee/slot-2.jpg',
  model: 'image4_standard',
  aspect: '16:9',
  visualStyle: 'Warm editorial',
  palette: 'Roasted earth',
  description: 'A barista pours milk into an espresso in warm morning light.',
  createdAt: AT,
  ...over,
});

const field = (asset, key) => detailFields(asset).find((f) => f.key === key);

// --- assetTitle: the settled title source ---

test('assetTitle names the asset from the slot alt, the page\'s own words', () => {
  assert.equal(
    assetTitle(row()),
    'A barista pouring a flat white on a marble counter',
  );
});

test('assetTitle keeps only the first sentence of a long alt', () => {
  const asset = row({ alt: 'A barista pours a flat white. Steam rises from the cup.' });
  assert.equal(assetTitle(asset), 'A barista pours a flat white');
});

test('assetTitle cuts an overlong title at a word boundary', () => {
  const alt = 'A barista pouring a flat white on a marble counter beside a window '
    + 'with a view over the old town square at sunrise';
  const title = assetTitle(row({ alt }));
  assert.ok(title.length <= 76, title);
  assert.ok(title.endsWith('...'), title);
  assert.ok(!/\s\.\.\.$/.test(title), title);
});

test('assetTitle does not follow the per-run description, so a Regenerate keeps the name', () => {
  const before = assetTitle(row());
  const after = assetTitle(row({ description: 'Something else entirely.' }));
  assert.equal(after, before);
});

test('assetTitle falls back to the slot position when the row has no alt', () => {
  assert.equal(assetTitle(row({ alt: '' })), 'Image 3');
  assert.equal(assetTitle({ slot: 0 }), 'Image 1');
  assert.equal(assetTitle({}), 'Image');
});

// --- formatCreatedAt ---

test('formatCreatedAt reads an ISO stamp as a date', () => {
  const shown = formatCreatedAt(AT);
  assert.ok(shown.includes('2026'), shown);
});

test('formatCreatedAt answers empty for a missing or unusable stamp', () => {
  assert.equal(formatCreatedAt(''), '');
  assert.equal(formatCreatedAt(undefined), '');
  assert.equal(formatCreatedAt('not a date'), '');
});

// --- detailFields: the seven FR-45 rows, honestly ---

test('detailFields lists the PRD fields in order', () => {
  assert.deepEqual(detailFields(row()).map((f) => f.label), [
    'Created on', 'Model', 'ALT Text', 'Aspect', 'Visual style', 'Palette', 'Description',
  ]);
});

test('detailFields reads real values off the row, never a demo placeholder', () => {
  const fields = detailFields(row());
  const value = (key) => fields.find((f) => f.key === key).value;
  assert.equal(value('model'), 'image4_standard');
  assert.equal(value('alt'), 'A barista pouring a flat white on a marble counter');
  assert.equal(value('aspect'), '16:9');
  assert.equal(value('visualStyle'), 'Warm editorial');
  assert.equal(value('palette'), 'Roasted earth');
  assert.equal(value('description'), 'A barista pours milk into an espresso in warm morning light.');
  assert.ok(fields.every((f) => !f.missing));
});

test('detailFields marks an absent field missing instead of inventing a value', () => {
  const bare = detailFields({ slot: 1 });
  assert.ok(bare.every((f) => f.missing));
  assert.ok(bare.every((f) => f.value === ''));
  assert.ok(bare.every((f) => f.placeholder));
});

test('detailFields says the model was NOT REPORTED and only claims best effort', () => {
  assert.equal(field({ slot: 1 }, 'model').placeholder, 'Not reported');
  assert.equal(field({ slot: 1 }, 'model').note, '');
  assert.equal(field(row(), 'model').note, MODEL_NOTE);
  assert.match(MODEL_NOTE, /reports no model/);
});

test('detailFields treats whitespace as absent', () => {
  assert.equal(field(row({ palette: '   ' }), 'palette').missing, true);
});

// --- imageCandidates ---

test('imageCandidates prefers the durable DA copy over the expiring Firefly URL', () => {
  const found = imageCandidates(row());
  assert.equal(found.length, 2);
  assert.equal(found[0].durable, true);
  assert.ok(found[0].url.startsWith('https://content.da.live/bpauli/frescopa/projects/coffee/slot-2.jpg'));
  assert.deepEqual(found[1], {
    url: 'https://firefly.s3.amazonaws.com/out.jpg?X-Amz-Expires=3600', durable: false,
  });
});

test('imageCandidates stamps the DA copy, whose path a Regenerate overwrites', () => {
  const before = imageCandidates(row())[0].url;
  const after = imageCandidates(row({ createdAt: '2026-02-02T10:00:00.000Z' }))[0].url;
  assert.notEqual(after, before);
  assert.match(before, /[?&]v=2026-01-12T09%3A30%3A00\.000Z$/);
  // The presigned Firefly URL is signed over its query, so it is never stamped.
  assert.equal(
    imageCandidates(row())[1].url,
    'https://firefly.s3.amazonaws.com/out.jpg?X-Amz-Expires=3600',
  );
});

test('imageCandidates leaves an unstamped row addressed as it stands', () => {
  const asset = row({ createdAt: '' });
  assert.equal(
    imageCandidates(asset)[0].url,
    'https://content.da.live/bpauli/frescopa/projects/coffee/slot-2.jpg',
  );
});

test('imageCandidates drops the pipeline fragment from the stored reference', () => {
  const asset = row({
    mediaUrl: 'https://content.da.live/a/b/slot-2.jpg#width=2688&height=1512',
    createdAt: '',
  });
  assert.equal(imageCandidates(asset)[0].url, 'https://content.da.live/a/b/slot-2.jpg');
});

test('imageCandidates falls back to Firefly alone, and to nothing at all', () => {
  assert.deepEqual(imageCandidates(row({ mediaUrl: '', createdAt: '' })), [
    { url: 'https://firefly.s3.amazonaws.com/out.jpg?X-Amz-Expires=3600', durable: false },
  ]);
  assert.deepEqual(imageCandidates(row({ mediaUrl: '', sourceUrl: '' })), []);
  assert.deepEqual(imageCandidates(row({ mediaUrl: 'not-a-url', sourceUrl: '' })), []);
  assert.deepEqual(imageCandidates(null), []);
});

// --- downloadName ---

test('downloadName names the file after the project and the slot', () => {
  assert.equal(downloadName(row(), 'coffee', 'image/jpeg'), 'coffee-slot-2.jpg');
  assert.equal(downloadName(row(), 'Green Coffee!', 'image/png'), 'green-coffee-slot-2.png');
});

test('downloadName still answers without a project or a content type', () => {
  assert.equal(downloadName(row(), ''), 'slot-2.jpg');
  assert.equal(downloadName({}, 'coffee'), 'coffee-asset.jpg');
});

// --- regenerationJob ---

test('regenerationJob rebuilds the prompt from the alt and the current direction', () => {
  const job = regenerationJob(row(), {
    visualStyle: { name: 'Cold minimal' },
    colorPalette: { name: 'Slate', colors: ['#222', '#eee'] },
  });
  assert.equal(job.slot, 2);
  assert.equal(job.aspect, '16:9');
  assert.match(job.prompt, /A barista pouring a flat white on a marble counter\./);
  assert.match(job.prompt, /Cold minimal/);
  assert.match(job.prompt, /Slate/);
  assert.match(job.prompt, /16:9 landscape crop/);
});

test('regenerationJob keeps the look from the row when no direction is passed', () => {
  const job = regenerationJob(row());
  assert.match(job.prompt, /Warm editorial/);
  assert.match(job.prompt, /Roasted earth/);
});

test('regenerationJob reuses the stored prompt only when the row has no alt', () => {
  const asset = row({ alt: '', prompt: 'The exact prompt used last time.' });
  assert.equal(regenerationJob(asset).prompt, 'The exact prompt used last time.');
});

test('regenerationJob still builds a prompt for a row with neither alt nor prompt', () => {
  const job = regenerationJob({ slot: 4, aspect: '1:1' });
  assert.ok(job.prompt.length > 0);
  assert.equal(job.slot, 4);
  assert.equal(job.aspect, '1:1');
});

// --- assetRow ---

const result = {
  slot: 2,
  prompt: 'A new prompt.',
  aspect: '16:9',
  sourceUrl: 'https://firefly.s3.amazonaws.com/new.jpg',
  model: 'image4_standard',
  description: 'A fresh take on the same counter.',
  createdAt: '2026-02-02T10:00:00.000Z',
  status: 'Generated',
  error: null,
};

test('assetRow keeps what belongs to the slot and takes what belongs to the image', () => {
  const next = assetRow(row(), result);
  assert.equal(next.id, 'slot-2');
  assert.equal(next.slot, 2);
  assert.equal(next.alt, 'A barista pouring a flat white on a marble counter');
  assert.equal(next.prompt, 'A new prompt.');
  assert.equal(next.sourceUrl, 'https://firefly.s3.amazonaws.com/new.jpg');
  assert.equal(next.description, 'A fresh take on the same counter.');
  assert.equal(next.createdAt, '2026-02-02T10:00:00.000Z');
  assert.equal(next.status, 'Generated');
});

test('assetRow clears the durable URL, which the new bytes do not have yet', () => {
  assert.equal(assetRow(row(), result).mediaUrl, '');
});

test('assetRow drops a description that described the previous image', () => {
  const next = assetRow(row(), { ...result, description: '' });
  assert.equal(next.description, '');
});

test('assetRow records the creative direction the new image was made under', () => {
  const next = assetRow(row(), result, {
    visualStyle: { name: 'Cold minimal' },
    colorPalette: { name: 'Slate' },
  });
  assert.equal(next.visualStyle, 'Cold minimal');
  assert.equal(next.palette, 'Slate');
});

test('assetRow keeps the row\'s look when the caller passes no direction', () => {
  const next = assetRow(row(), result);
  assert.equal(next.visualStyle, 'Warm editorial');
  assert.equal(next.palette, 'Roasted earth');
});

test('assetRow carries no soft error, so it is saveAssets-ready as it stands', () => {
  assert.deepEqual(Object.keys(assetRow(row(), result)).sort(), [
    'alt', 'aspect', 'createdAt', 'description', 'id', 'mediaUrl', 'model',
    'palette', 'prompt', 'slot', 'sourceUrl', 'status', 'visualStyle',
  ]);
});

test('assetRow gives an id-less row a deterministic id from its slot', () => {
  assert.equal(assetRow({ slot: 5 }, { ...result, slot: 5 }).id, 'slot-5');
});
