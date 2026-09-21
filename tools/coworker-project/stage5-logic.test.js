import test from 'node:test';
import assert from 'node:assert/strict';

import stage5Readiness, { STAGE5_APPROVALS, assetsStamp } from './stage5-logic.js';

const PAGE = { previewUrl: 'https://main--site--org.aem.page/drafts/my-page' };

const row = (slot, over = {}) => ({
  id: `slot-${slot}`,
  slot,
  status: 'Generated',
  sourceUrl: `https://firefly.example/${slot}.jpg`,
  mediaUrl: `https://content.da.live/org/site/projects/my-page/slot-${slot}.jpg`,
  ...over,
});

// --- stage5Readiness ---

test('stage5Readiness is ready once every slot has an asset that is on the page', () => {
  assert.deepEqual(stage5Readiness(PAGE, [row(0), row(1)]), { ready: true, reason: '' });
});

test('stage5Readiness asks for the page while there is no preview URL', () => {
  const { ready, reason } = stage5Readiness({ previewUrl: '  ' }, [row(0)]);
  assert.equal(ready, false);
  assert.equal(reason, 'Generate the page.');
});

test('stage5Readiness asks for the page before it asks for the assets', () => {
  const { ready, reason } = stage5Readiness(null, null);
  assert.equal(ready, false);
  assert.equal(reason, 'Generate the page.');
});

test('stage5Readiness asks for the assets while the page has none', () => {
  const { ready, reason } = stage5Readiness(PAGE, []);
  assert.equal(ready, false);
  assert.equal(reason, 'Generate the assets.');
});

test('stage5Readiness is not ready while only some slots are generated', () => {
  const { ready, reason } = stage5Readiness(PAGE, [row(0), row(1, { status: 'Failed' })]);
  assert.equal(ready, false);
  assert.equal(reason, 'Generate the assets.');
});

test('stage5Readiness is not ready while an image was generated but never swapped in', () => {
  // A row with a Firefly URL and no `mediaUrl` never reached the page doc (#60).
  const { ready } = stage5Readiness(PAGE, [row(0), row(1, { mediaUrl: '' })]);
  assert.equal(ready, false);
});

test('stage5Readiness does not look at approvals: generated + swapped is ready', () => {
  // The approvals gate (#46) is what reaches "Approved"; this rule only asks
  // whether the stage's work is done.
  assert.equal(stage5Readiness(PAGE, [row(0)]).ready, true);
});

test('stage5Readiness has two approvals, per FR-47', () => {
  assert.equal(STAGE5_APPROVALS.length, 2);
});

// --- assetsStamp: the "the page's pictures moved" signal ---

test('assetsStamp is stable for the same rows in any order', () => {
  assert.equal(assetsStamp([row(0), row(1)]), assetsStamp([row(1), row(0)]));
});

test('assetsStamp changes when a slot gets a new image', () => {
  const before = assetsStamp([row(0), row(1)]);
  const after = assetsStamp([row(0), row(1, { mediaUrl: 'https://content.da.live/a.jpg?v=2' })]);
  assert.notEqual(before, after);
});

test('assetsStamp ignores rows that are not on the page yet', () => {
  assert.equal(assetsStamp([row(0, { mediaUrl: '' })]), '');
  assert.equal(assetsStamp(null), '');
});
