// Stage-state persistence + gating for the stage-execution shell.
//
// The project record's `stages` sheet (columns: stage, stageIndex, status) IS
// the state store. Status is one of the PRD set: Locked / Not Started /
// In Progress / Complete / Approved. `Locked` is a gating state, not progress:
// it is recomputed from the prior stage on every change so it stays consistent.
//
// Writes mirror the create path (project.js): rebuild the whole multi-sheet
// record and POST it to admin.da.live/source (DA whole-blob write).

import { readProject, parseProject } from './projects.js';

const DA_ADMIN = 'https://admin.da.live';

const isDone = (status) => status === 'Complete' || status === 'Approved';

// POST the multi-sheet record blob to DA source.
async function writeRecord(org, site, slug, daFetch, record) {
  const body = new FormData();
  body.set('data', new Blob([JSON.stringify(record, null, 2)], { type: 'application/json' }));
  const resp = await daFetch(`${DA_ADMIN}/source/${org}/${site}/projects/${slug}.json`, {
    method: 'POST',
    body,
  });
  if (!resp.ok) throw new Error(`Save failed: ${resp.status} ${resp.statusText}`);
  return resp;
}

// Wrap a rows array as a DA single sheet payload.
const sheet = (data) => ({
  total: data.length, limit: data.length, offset: 0, data,
});

/**
 * Apply gating to ordered stages. Stage 1 is never Locked; every later stage is
 * Locked until the stage before it is Complete (or Approved). Unlocking a Locked
 * stage reveals it as "Not Started"; a still-gated stage stays "Locked".
 * Pure - returns a new array, input untouched.
 */
export function recomputeGating(stages) {
  const ordered = [...stages].sort((a, b) => a.stageIndex - b.stageIndex);
  let prevDone = true; // nothing precedes the first stage
  return ordered.map((s) => {
    let status = s.status || 'Locked';
    if (!prevDone) status = 'Locked';
    else if (status === 'Locked') status = 'Not Started';
    prevDone = isDone(status);
    return { ...s, status };
  });
}

/** Overall project status derived from its (gated) stages. */
export function deriveOverallStatus(stages) {
  if (stages.length && stages.every((s) => isDone(s.status))) return 'Complete';
  if (stages.some((s) => isDone(s.status) || s.status === 'In Progress')) return 'In Progress';
  return 'Not Started';
}

/**
 * Rebuild the multi-sheet record from the parsed view model. The `keywords` and
 * `cannibalization` sheets hold Stage 1's data; both are always written (empty
 * when there is none) so a save never drops them. The cannibalization check
 * timestamp is denormalized onto each competitor row.
 */
export function serializeRecord(meta, stages, keywords = [], cannibalization = null) {
  const ordered = [...stages].sort((a, b) => a.stageIndex - b.stageIndex);
  const stageRows = ordered.map((s) => ({
    stage: s.stage, stageIndex: s.stageIndex, status: s.status,
  }));
  const stepRows = ordered.flatMap((s) => s.steps.map((st) => ({
    stage: s.stage,
    stageIndex: s.stageIndex,
    stepIndex: st.stepIndex,
    step: st.step,
    displayName: st.displayName,
  })));
  const keywordRows = (keywords || []).map((k) => ({ text: k.text, role: k.role }));
  const cann = cannibalization || {};
  const cannRows = (cann.competitors || []).map((c) => ({
    url: c.url,
    title: c.title,
    overlap: c.overlap,
    status: c.status,
    reason: c.reason,
    checkedAt: cann.checkedAt || '',
  }));
  return {
    ':type': 'multi-sheet',
    ':version': 3,
    ':names': ['meta', 'stages', 'steps', 'keywords', 'cannibalization'],
    meta: sheet([meta]),
    stages: sheet(stageRows),
    steps: sheet(stepRows),
    keywords: sheet(keywordRows),
    cannibalization: sheet(cannRows),
  };
}

/**
 * Set one stage's status, re-gate, refresh the overall status, and persist.
 * @param {{org: string, repo: string}} context
 * @param {(url: string, opts?: object) => Promise<Response>} daFetch
 * @param {string} slug
 * @param {{meta: object, stages: Array}} project - the current view model
 * @param {{stageIndex: number, status: string}} change
 * @returns {Promise<{meta: object, stages: Array}>} the new view model
 */
export async function saveStageState(context, daFetch, slug, project, { stageIndex, status }) {
  const { org, repo: site } = context || {};
  if (!org || !site || typeof daFetch !== 'function' || !slug) throw new Error('Missing DA context.');

  const next = project.stages.map((s) => (
    s.stageIndex === stageIndex ? { ...s, status } : s
  ));
  const gated = recomputeGating(next);
  const meta = { ...project.meta, status: deriveOverallStatus(gated) };

  // Preserve the keyword list + cannibalization data across a status write.
  const record = serializeRecord(meta, gated, project.keywords, project.cannibalization);
  await writeRecord(org, site, slug, daFetch, record);
  return { meta, stages: gated };
}

/**
 * Persist Stage 1's keyword list. Read-modify-write: re-read the record so a
 * concurrent stage-status change is not clobbered, swap in the new keywords,
 * and write the whole record back.
 * @param {{org: string, repo: string}} context
 * @param {(url: string, opts?: object) => Promise<Response>} daFetch
 * @param {string} slug
 * @param {Array<{text, role}>} keywords
 * @returns {Promise<Array<{text, role}>>} the saved keywords
 */
export async function saveKeywords(context, daFetch, slug, keywords) {
  const { org, repo: site } = context || {};
  if (!org || !site || typeof daFetch !== 'function' || !slug) throw new Error('Missing DA context.');
  const model = parseProject(await readProject(context, daFetch, slug));
  if (!model) throw new Error('Project not found.');
  const record = serializeRecord(model.meta, model.stages, keywords, model.cannibalization);
  await writeRecord(org, site, slug, daFetch, record);
  return keywords;
}

/**
 * Persist Stage 1's cannibalization result. Read-modify-write so a concurrent
 * keyword or stage-status change is not clobbered.
 * @param {{org: string, repo: string}} context
 * @param {(url: string, opts?: object) => Promise<Response>} daFetch
 * @param {string} slug
 * @param {{checkedAt: string, competitors: Array}} cannibalization
 * @returns {Promise<{checkedAt: string, competitors: Array}>} the saved value
 */
export async function saveCannibalization(context, daFetch, slug, cannibalization) {
  const { org, repo: site } = context || {};
  if (!org || !site || typeof daFetch !== 'function' || !slug) throw new Error('Missing DA context.');
  const model = parseProject(await readProject(context, daFetch, slug));
  if (!model) throw new Error('Project not found.');
  const record = serializeRecord(model.meta, model.stages, model.keywords, cannibalization);
  await writeRecord(org, site, slug, daFetch, record);
  return cannibalization;
}
