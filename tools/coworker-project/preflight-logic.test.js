import test from 'node:test';
import assert from 'node:assert/strict';

import {
  PASS_SCORE, PSI_CATEGORY_NAMES, AI_CATEGORY_NAMES, auditUrl, measuredCategories,
  unavailableRows, displayRows, categoryState, rowCount, rowDetail, readinessLabel,
  readinessNote, preflightChanges,
} from './preflight-logic.js';

const psiOk = {
  categories: [
    {
      name: 'Web performance', passed: 20, total: 24, score: 96, source: 'psi',
    },
    {
      name: 'Accessibility', passed: 18, total: 20, score: 88, source: 'psi',
    },
  ],
  error: null,
};

const aoOk = {
  categories: [
    {
      name: 'LLM visibility', passed: 3, total: 4, score: 75, source: 'ai',
    },
  ],
  error: null,
};

const psiFailed = { categories: [], error: 'PageSpeed Insights 429 (rate limited - set a PSI API key)' };
const aoFailed = { categories: [], error: 'Page assessment failed.' };

test('auditUrl is the generated page preview URL', () => {
  assert.equal(auditUrl({ previewUrl: ' https://x.aem.page/a ' }), 'https://x.aem.page/a');
  assert.equal(auditUrl({ previewUrl: '' }), '');
  assert.equal(auditUrl({ path: '/drafts/a' }), '');
  assert.equal(auditUrl(null), '');
});

test('measuredCategories keeps PSI rows first, then the AO rows', () => {
  const rows = measuredCategories(psiOk, aoOk);
  assert.deepEqual(rows.map((r) => r.name), ['Web performance', 'Accessibility', 'LLM visibility']);
  assert.deepEqual(rows.map((r) => r.source), ['psi', 'psi', 'ai']);
});

test('measuredCategories drops rows without a name or a numeric score', () => {
  const rows = measuredCategories({
    categories: [
      { name: '', score: 90 },
      { name: 'SEO', score: 'high' },
      { name: 'SEO', score: 91, passed: 9 },
    ],
  }, null);
  assert.deepEqual(rows, [{
    name: 'SEO', passed: 9, total: 0, score: 91, source: 'psi',
  }]);
});

test('measuredCategories de-dupes by name', () => {
  const dupe = { categories: [{ name: 'SEO', score: 70 }] };
  assert.deepEqual(measuredCategories({ categories: [{ name: 'SEO', score: 95 }] }, dupe)
    .map((r) => r.score), [95]);
});

test('measuredCategories is empty when both audits failed', () => {
  assert.deepEqual(measuredCategories(psiFailed, aoFailed), []);
});

test('unavailableRows lists the categories a failed source could not measure', () => {
  const rows = unavailableRows(psiFailed, 'psi', PSI_CATEGORY_NAMES, []);
  assert.deepEqual(rows.map((r) => r.name), PSI_CATEGORY_NAMES);
  assert.equal(rows[0].status, 'unavailable');
  assert.equal(rows[0].error, psiFailed.error);
});

test('unavailableRows skips categories that were measured anyway', () => {
  const partial = { categories: psiOk.categories, error: 'No PageSpeed results came back.' };
  const measured = measuredCategories(partial, null);
  const rows = unavailableRows(partial, 'psi', PSI_CATEGORY_NAMES, measured);
  assert.deepEqual(rows.map((r) => r.name), ['SEO', 'Best practices']);
});

test('unavailableRows is empty without a soft error', () => {
  assert.deepEqual(unavailableRows(psiOk, 'psi', PSI_CATEGORY_NAMES, []), []);
  assert.deepEqual(unavailableRows(null, 'psi', PSI_CATEGORY_NAMES, []), []);
});

test('displayRows lists the measured rows plus the soft rows of a failed source', () => {
  const rows = displayRows(psiOk, aoFailed);
  assert.deepEqual(rows.map((r) => r.name), [
    'Web performance', 'Accessibility', ...AI_CATEGORY_NAMES,
  ]);
  assert.deepEqual(rows.slice(2).map((r) => r.status), ['unavailable', 'unavailable']);
  // A failed PSI run degrades all four of its categories instead of blocking.
  assert.deepEqual(displayRows(psiFailed, aoOk).map((r) => r.name), [
    'LLM visibility', ...PSI_CATEGORY_NAMES,
  ]);
});

test('categoryState passes at the cut-off and flags anything below it', () => {
  assert.equal(PASS_SCORE, 90);
  assert.equal(categoryState({ score: 90 }), 'pass');
  assert.equal(categoryState({ score: 89 }), 'attention');
  assert.equal(categoryState({ status: 'unavailable', score: 99 }), 'unavailable');
  assert.equal(categoryState(null), 'unavailable');
});

test('rowCount is passed/total, and empty for a soft row', () => {
  assert.equal(rowCount({ passed: 18, total: 20, score: 88 }), '18/20');
  assert.equal(rowCount({ status: 'unavailable' }), '');
});

test('rowDetail names the score, the checks, and the audit', () => {
  assert.equal(
    rowDetail({
      name: 'Web performance', passed: 20, total: 24, score: 96, source: 'psi',
    }),
    'Score 96/100 - 20 of 24 checks passed (PageSpeed Insights).',
  );
  assert.match(rowDetail({ name: 'LLM visibility', score: 75, source: 'ai' }), /Coworker assessment/);
});

test('rowDetail explains a soft row with its audit error', () => {
  const [row] = unavailableRows(psiFailed, 'psi', ['SEO'], []);
  assert.equal(
    rowDetail(row),
    'PageSpeed Insights could not measure this category: '
      + 'PageSpeed Insights 429 (rate limited - set a PSI API key)',
  );
});

test('readinessLabel runs the demo progression', () => {
  assert.equal(readinessLabel('running', 0), 'Running audit...');
  assert.equal(readinessLabel('done', 86.4), '86% readiness');
  assert.equal(readinessLabel('done', 0), '0% readiness');
  assert.equal(readinessLabel('idle', 0), 'Not checked yet');
});

test('readinessNote counts the checked and the unavailable categories', () => {
  assert.equal(readinessNote('running', []), 'Checking page...');
  assert.equal(readinessNote('idle', []), 'The pre-flight check runs once the page is generated.');
  assert.equal(readinessNote('done', displayRows(psiOk, aoOk)), '3 categories checked');
  assert.equal(readinessNote('done', displayRows(psiFailed, aoOk)), '1 category checked, 4 unavailable');
  assert.equal(readinessNote('done', [{ score: 90 }]), '1 category checked');
});

test('preflightChanges persists only the measured categories, with a run stamp', () => {
  const rows = displayRows(psiOk, aoFailed);
  const changes = preflightChanges(rows, '2026-01-01T00:00:00.000Z');
  assert.equal(changes.ranAt, '2026-01-01T00:00:00.000Z');
  assert.deepEqual(changes.categories, [
    {
      name: 'Web performance', passed: 20, total: 24, score: 96, source: 'psi',
    },
    {
      name: 'Accessibility', passed: 18, total: 20, score: 88, source: 'psi',
    },
  ]);
});

test('preflightChanges stamps the run and survives an empty roll-up', () => {
  const changes = preflightChanges(null);
  assert.deepEqual(changes.categories, []);
  assert.match(changes.ranAt, /^\d{4}-\d{2}-\d{2}T/);
});
