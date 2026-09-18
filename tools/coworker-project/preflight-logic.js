// Pure helpers for the Stage 4 "Pre-flight check" panel (ticket #43).
//
// The panel keeps the audits in preflight-contracts.js (`runPsiAudit`,
// `assessPage`, `rollupReadiness`) and the persistence in stage-state.js
// (`savePreflight`); everything here is plain data shaping, so it is unit
// tested without a DOM.
//
// Both audit seams return `{categories, error}` and never throw, so a failed
// run is a SOURCE-level soft state: the categories that source would have
// measured are still listed, as "unavailable" rows carrying the error. Only
// MEASURED categories are rolled up and persisted, so a failed source never
// scores the page down to 0.

const str = (v) => (typeof v === 'string' ? v.trim() : '');

/** A category counts as passed at the Lighthouse pass cut-off (90). */
export const PASS_SCORE = 90;

/** The categories each source measures, in display order. */
export const PSI_CATEGORY_NAMES = ['Web performance', 'Accessibility', 'SEO', 'Best practices'];
export const AI_CATEGORY_NAMES = ['LLM visibility', 'Engagement & conversion'];

const SOURCE_LABELS = {
  psi: 'PageSpeed Insights',
  ai: 'Coworker assessment',
};

/**
 * The URL the pre-flight audits run against: the generated page's preview URL,
 * or '' when the project has no generated page yet (the panel then shows its
 * idle state instead of auditing). Pure.
 * @param {{previewUrl?: string}} page
 * @returns {string}
 */
export function auditUrl(page) {
  return str(page?.previewUrl);
}

// A measured row keeps its numbers; anything malformed is dropped.
function measuredRows(result, source) {
  const list = Array.isArray(result?.categories) ? result.categories : [];
  return list
    .filter((c) => c && str(c.name) && typeof c.score === 'number' && Number.isFinite(c.score))
    .map((c) => ({
      name: str(c.name),
      passed: Number(c.passed) || 0,
      total: Number(c.total) || 0,
      score: Math.round(c.score),
      source: c.source === 'ai' ? 'ai' : source,
    }));
}

/**
 * The categories both audits actually measured, PSI first then the AO
 * assessment, de-duped by name. This is what gets rolled up and persisted.
 * Pure.
 * @param {{categories?: Array, error?: string|null}} psi
 * @param {{categories?: Array, error?: string|null}} ao
 * @returns {Array<{name, passed, total, score, source}>}
 */
export function measuredCategories(psi, ao) {
  const rows = [...measuredRows(psi, 'psi'), ...measuredRows(ao, 'ai')];
  const seen = new Set();
  return rows.filter((r) => {
    const key = r.name.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/**
 * The soft rows for a source that failed or came back empty: the categories it
 * would have measured, marked unavailable and carrying the soft error. An
 * audit error degrades those categories, it never blocks the panel. Pure.
 * @param {{categories?: Array, error?: string|null}} result
 * @param {string} source - 'psi' or 'ai'
 * @param {string[]} names - the categories that source measures
 * @param {Array} measured - the rows already measured (by any source)
 * @returns {Array<{name, source, status: 'unavailable', error: string}>}
 */
export function unavailableRows(result, source, names, measured = []) {
  const error = str(result?.error);
  if (!error) return [];
  const have = new Set(measured.map((c) => str(c.name).toLowerCase()));
  return names
    .filter((name) => !have.has(name.toLowerCase()))
    .map((name) => ({
      name, source, status: 'unavailable', error,
    }));
}

/**
 * Every row the panel lists: the measured categories plus an unavailable row
 * for each category a failed source could not measure. Pure.
 * @param {{categories?: Array, error?: string|null}} psi
 * @param {{categories?: Array, error?: string|null}} ao
 * @returns {Array<object>}
 */
export function displayRows(psi, ao) {
  const measured = measuredCategories(psi, ao);
  return [
    ...measured,
    ...unavailableRows(psi, 'psi', PSI_CATEGORY_NAMES, measured),
    ...unavailableRows(ao, 'ai', AI_CATEGORY_NAMES, measured),
  ];
}

/**
 * A row's state: 'unavailable' for a soft row, else 'pass' at or above the pass
 * cut-off and 'attention' below it. Pure.
 * @param {{status?: string, score?: number}} row
 * @returns {'pass'|'attention'|'unavailable'}
 */
export function categoryState(row) {
  if (!row || row.status === 'unavailable' || typeof row.score !== 'number') return 'unavailable';
  return row.score >= PASS_SCORE ? 'pass' : 'attention';
}

/**
 * The "passed/total" text of a row, or '' for a soft row (it has no counts).
 * Pure.
 * @param {object} row
 * @returns {string}
 */
export function rowCount(row) {
  if (categoryState(row) === 'unavailable') return '';
  return `${row.passed}/${row.total}`;
}

/**
 * The expandable detail of a row: the soft error for an unavailable category,
 * else the score, the checks passed, and which audit measured it. Pure.
 * @param {object} row
 * @returns {string}
 */
export function rowDetail(row) {
  if (!row) return '';
  const label = SOURCE_LABELS[row.source] || 'Audit';
  if (categoryState(row) === 'unavailable') {
    return `${label} could not measure this category: ${str(row.error) || 'no result came back.'}`;
  }
  return `Score ${row.score}/100 - ${row.passed} of ${row.total} checks passed (${label}).`;
}

/**
 * The headline of the status card: the demo's "Running audit..." while the
 * audits run, "NN% readiness" once they are in, and a neutral label when
 * nothing has run yet. Pure.
 * @param {'idle'|'running'|'done'} phase
 * @param {number} readiness
 * @returns {string}
 */
export function readinessLabel(phase, readiness) {
  if (phase === 'running') return 'Running audit...';
  if (phase === 'done') return `${Math.round(readiness) || 0}% readiness`;
  return 'Not checked yet';
}

/**
 * The line under the headline: what the check is doing, or how it ended. Pure.
 * @param {'idle'|'running'|'done'} phase
 * @param {Array} rows
 * @returns {string}
 */
export function readinessNote(phase, rows = []) {
  if (phase === 'running') return 'Checking page...';
  if (phase !== 'done') return 'The pre-flight check runs once the page is generated.';
  const soft = rows.filter((r) => categoryState(r) === 'unavailable').length;
  const measured = rows.length - soft;
  const counted = `${measured} ${measured === 1 ? 'category' : 'categories'} checked`;
  return soft ? `${counted}, ${soft} unavailable` : counted;
}

/**
 * The record persisted through `savePreflight`: the run timestamp plus the
 * measured categories only, so a failed source cannot score the page down.
 * Pure.
 * @param {Array} categories
 * @param {string} [ranAt] - ISO timestamp; defaults to now.
 * @returns {{ranAt: string, categories: Array}}
 */
export function preflightChanges(categories, ranAt = new Date().toISOString()) {
  const list = (Array.isArray(categories) ? categories : [])
    .filter((c) => c && str(c.name) && typeof c.score === 'number');
  return {
    ranAt,
    categories: list.map((c) => ({
      name: str(c.name),
      passed: Number(c.passed) || 0,
      total: Number(c.total) || 0,
      score: Math.round(c.score),
      source: c.source === 'ai' ? 'ai' : 'psi',
    })),
  };
}
