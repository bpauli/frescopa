// Stage 4 pre-flight audit contracts (ticket #40).
//
// Three seams for the pre-flight check:
//   runPsiAudit     - a real Google PageSpeed Insights (Lighthouse) audit over HTTP.
//   assessPage      - AO-assessed LLM visibility + Engagement & conversion (askJson).
//   rollupReadiness - a pure roll-up of category scores to an overall readiness %.
// Each network seam degrades to an empty result plus a soft error, so the panel
// (#43) never needs a try/catch.
//
// The keyless PSI quota is exhausted (shared anonymous project -> HTTP 429), so
// the audit needs a referrer-restricted API key. To keep the key out of the git
// repo it lives in the DA `coworker` config sheet (row key `psi-api-key`), read
// at runtime by `readPsiKey`; the audit still runs keyless when none is set.

import { getCoworker } from './coworker.js';

const PSI_ENDPOINT = 'https://www.googleapis.com/pagespeedonline/v5/runPagespeed';
const DA_ADMIN = 'https://admin.da.live';

// Lighthouse category id -> the demo's display name, in display order.
const PSI_CATEGORIES = [
  ['performance', 'Web performance'],
  ['accessibility', 'Accessibility'],
  ['seo', 'SEO'],
  ['best-practices', 'Best practices'],
];
const PASS_THRESHOLD = 0.9; // Lighthouse "pass" cut-off for a scorable audit.

// Rows of a named sheet in a DA multi-sheet config blob (or a single sheet).
function sheetRows(json, name) {
  if (!json || typeof json !== 'object') return [];
  if (json[':type'] === 'multi-sheet') return json[name]?.data ?? [];
  return json.data ?? [];
}

const norm = (s) => (s || '').trim().toLowerCase().replaceAll(' ', '-');
const toInt = (v, d = 0) => {
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? n : d;
};
const clampScore = (v) => {
  const n = Math.round(Number(v));
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(100, n));
};

/**
 * Read the referrer-restricted PSI API key from the DA `coworker` config sheet
 * (row key `psi-api-key`), or '' when unset/unavailable. Never throws.
 * @param {{org: string, repo: string}} context
 * @param {(url: string, opts?: object) => Promise<Response>} daFetch
 * @returns {Promise<string>}
 */
export async function readPsiKey(context, daFetch) {
  const { org, repo: site } = context || {};
  if (!org || !site || typeof daFetch !== 'function') return '';
  try {
    const resp = await daFetch(`${DA_ADMIN}/config/${org}/${site}/`);
    if (!resp.ok) return '';
    const json = await resp.json();
    const row = sheetRows(json, 'coworker').find((r) => norm(r.key ?? r.name) === 'psi-api-key');
    return (row?.value ?? '').toString().trim();
  } catch {
    return '';
  }
}

/**
 * Map a Lighthouse result to the demo's PSI categories. For each category the
 * score is the Lighthouse category score as a percentage; passed/total count the
 * category's scorable audits (score is a number) that meet the pass threshold.
 * Categories without a numeric score are dropped; with no scorable audits the
 * score is represented as a percentage (passed=score, total=100). Pure.
 * @param {object} lighthouseResult
 * @returns {Array<{name, passed, total, score, source: 'psi'}>}
 */
export function psiCategories(lighthouseResult) {
  const lr = lighthouseResult && typeof lighthouseResult === 'object' ? lighthouseResult : {};
  const cats = lr.categories || {};
  const audits = lr.audits || {};
  return PSI_CATEGORIES
    .map(([key, name]) => {
      const cat = cats[key];
      if (!cat || typeof cat.score !== 'number') return null;
      const score = Math.round(cat.score * 100);
      const refs = Array.isArray(cat.auditRefs) ? cat.auditRefs : [];
      let passed = 0;
      let total = 0;
      refs.forEach((ref) => {
        const a = audits[ref && ref.id];
        if (a && typeof a.score === 'number') {
          total += 1;
          if (a.score >= PASS_THRESHOLD) passed += 1;
        }
      });
      if (total === 0) {
        passed = score;
        total = 100;
      }
      return {
        name, passed, total, score, source: 'psi',
      };
    })
    .filter(Boolean);
}

/**
 * Run a real PageSpeed Insights audit for a URL and map it to pre-flight
 * categories. Never throws: a bad URL, a non-2xx (e.g. 429 rate limit), or a
 * network error degrades to an empty result plus a soft error message.
 * @param {string} url - the page URL to audit (e.g. the aem.page preview URL).
 * @param {{apiKey?: string, strategy?: 'mobile'|'desktop',
 *   fetchImpl?: typeof fetch}} [opts]
 * @returns {Promise<{categories: Array, error: string|null}>}
 */
export async function runPsiAudit(url, {
  apiKey = '', strategy = 'mobile', fetchImpl = fetch,
} = {}) {
  const target = (url || '').trim();
  if (!target) return { categories: [], error: null };
  try {
    const params = new URLSearchParams({ url: target, strategy });
    ['PERFORMANCE', 'ACCESSIBILITY', 'SEO', 'BEST_PRACTICES'].forEach((c) => params.append('category', c));
    if (apiKey) params.set('key', apiKey);
    const resp = await fetchImpl(`${PSI_ENDPOINT}?${params}`);
    if (!resp.ok) {
      const hint = resp.status === 429 ? ' (rate limited - set a PSI API key)' : '';
      return { categories: [], error: `PageSpeed Insights ${resp.status}${hint}` };
    }
    const json = await resp.json();
    const categories = psiCategories(json.lighthouseResult);
    return { categories, error: categories.length ? null : 'No PageSpeed results came back.' };
  } catch (e) {
    return { categories: [], error: e.message || 'PageSpeed Insights failed.' };
  }
}

/**
 * Clean a raw AO assessment to `[{name, passed, total, score, source: 'ai'}]`.
 * Accepts `{categories: [...]}` or a bare array; keeps rows with a name, coerces
 * passed/total to integers (total defaults to 100), clamps score to 0-100, and
 * de-dupes by name. Pure.
 * @param {unknown} raw
 * @param {number} [max]
 * @returns {Array<{name, passed, total, score, source: 'ai'}>}
 */
export function cleanAssessment(raw, max = 4) {
  let list = [];
  if (Array.isArray(raw)) list = raw;
  else if (raw && Array.isArray(raw.categories)) list = raw.categories;
  const seen = new Set();
  const out = [];
  for (let i = 0; i < list.length && out.length < max; i += 1) {
    const item = list[i] || {};
    const name = (typeof item.name === 'string' ? item.name : '').trim();
    const key = name.toLowerCase();
    if (name && !seen.has(key)) {
      seen.add(key);
      const score = clampScore(item.score);
      const total = toInt(item.total, 100) || 100;
      const passed = Math.min(total, toInt(item.passed, Math.round((score / 100) * total)));
      out.push({
        name, passed, total, score, source: 'ai',
      });
    }
  }
  return out;
}

// Build the AO-assess prompt: score the two dimensions no standard tool measures.
function buildAssessPrompt(brief, page) {
  const b = brief || {};
  const title = (typeof b.title === 'string' ? b.title : '').trim();
  const body = (typeof b.body === 'string' ? b.body : '').trim();
  const path = (page && typeof page.path === 'string' ? page.path : '').trim();
  const ctx = [
    title ? `Page title: "${title}".` : '',
    path ? `Destination path: ${path}.` : '',
    body ? `Page brief:\n${body.slice(0, 1200)}` : '',
  ].filter(Boolean).join('\n');
  return 'You are an SEO and content-quality assessor. Assess a marketing page on two '
    + 'dimensions that automated tools cannot measure: "LLM visibility" (how well an AI '
    + 'assistant or answer engine would surface, understand, and cite this page) and '
    + '"Engagement & conversion" (how well the page holds attention and drives the visitor '
    + `to act).${ctx ? `\n\n${ctx}` : ''}\n\nFor each dimension give an integer score 0-100 and, `
    + 'out of a small number of checks, how many the page passes. Return ONLY JSON of the form '
    + '{"categories":[{"name":"LLM visibility","passed":<int>,"total":<int>,"score":<int>},'
    + '{"name":"Engagement & conversion","passed":<int>,"total":<int>,"score":<int>}]} '
    + 'with no prose or markdown.';
}

/**
 * AO-assess LLM visibility + Engagement & conversion for the generated page.
 * Never throws: an AO or parse failure degrades to an empty result plus a soft
 * error message.
 * @param {{org: string, repo: string}} context
 * @param {object} brief - the Stage 3 brief (title + body ground the assessment).
 * @param {object} [page] - the generated page (its path grounds the assessment).
 * @returns {Promise<{categories: Array, error: string|null}>}
 */
export async function assessPage(context, brief, page) {
  try {
    const json = await getCoworker(context).askJson(buildAssessPrompt(brief, page));
    const categories = cleanAssessment(json);
    return { categories, error: categories.length ? null : 'No assessment came back.' };
  } catch (e) {
    return { categories: [], error: e.message || 'Page assessment failed.' };
  }
}

/**
 * Overall readiness % as the rounded mean of the category scores (PSI + AI).
 * Entries without a numeric score are ignored; an empty roll-up is 0. Pure.
 * @param {Array<{score: number}>} categories
 * @returns {number}
 */
export function rollupReadiness(categories) {
  const list = (Array.isArray(categories) ? categories : [])
    .filter((c) => c && typeof c.score === 'number' && Number.isFinite(c.score));
  if (!list.length) return 0;
  const sum = list.reduce((acc, c) => acc + c.score, 0);
  return Math.round(sum / list.length);
}
