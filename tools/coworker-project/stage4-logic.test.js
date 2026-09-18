import test from 'node:test';
import assert from 'node:assert/strict';

import stage4Readiness from './stage4-logic.js';

const PAGE = { previewUrl: 'https://main--site--org.aem.page/drafts/my-page' };
const PREFLIGHT = { ranAt: '2025-01-01T00:00:00.000Z' };

test('stage4Readiness is ready once the page is generated and the pre-flight ran', () => {
  assert.deepEqual(stage4Readiness(PAGE, PREFLIGHT), { ready: true, reason: '' });
});

test('stage4Readiness asks for the page while there is no preview URL', () => {
  const { ready, reason } = stage4Readiness({ previewUrl: '  ' }, PREFLIGHT);
  assert.equal(ready, false);
  assert.equal(reason, 'Generate the page.');
});

test('stage4Readiness asks for the pre-flight check while it has not run', () => {
  const { ready, reason } = stage4Readiness(PAGE, { ranAt: '', categories: [] });
  assert.equal(ready, false);
  assert.equal(reason, 'Run the pre-flight check.');
});

test('stage4Readiness names both missing steps on an untouched stage', () => {
  const { ready, reason } = stage4Readiness(null, null);
  assert.equal(ready, false);
  assert.equal(reason, 'Generate the page. Run the pre-flight check.');
});

test('stage4Readiness has no approval gate: a generated + audited page is ready', () => {
  // Approvals are ticket #46; a page with no approvals still completes Stage 4.
  const page = { ...PAGE, status: 'Draft' };
  assert.equal(stage4Readiness(page, { ...PREFLIGHT, categories: [] }).ready, true);
});
