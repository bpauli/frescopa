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
 * Rebuild the multi-sheet record from the parsed view model. The `keywords`,
 * `cannibalization`, `creativeDirection`, `brief`, `preflight`, and
 * `coworkerSessions` sheets hold the stage data; all are always written (empty
 * when there is none) so a save never drops them. The cannibalization check
 * timestamp is denormalized onto each competitor row and the pre-flight run
 * timestamp onto each category row; the creative-direction selection and the
 * generated page are each a single flat row (palette colors comma-joined).
 *
 * `coworkerSessions` is one row per producer (`{ userId, sessionId, startedAt }`):
 * AO episodes are owned by an IMS user, so the project's Coworker chat is per
 * user (ticket #49).
 *
 * `approvals` is one row per named sign-off, keyed by stage
 * (`{ stageIndex, name, approved, approvedAt }`), so the one sheet carries every
 * stage's approvals - the gate is reused by stages 4, 5, and 7 (ticket #46).
 *
 * `assets` is one row per page image slot, keyed by `slot` (the index of the
 * `<img>` in the page doc): `{id, slot, alt, prompt, status, sourceUrl,
 * mediaUrl, model, aspect, visualStyle, palette, description, createdAt}`
 * (ticket #58). `sourceUrl` is the Firefly presigned URL the asset came from
 * (expires after an hour); `mediaUrl` is the permanent DA-hosted copy the page
 * doc references, populated later by the page-swap ticket (#60).
 *
 * `locales` is one row per locale the producer selected in Stage 6, keyed by
 * `code`: `{code, label, prefix, isDefault, status, path, previewUrl, editUrl,
 * generatedAt, error}` (ticket #76). `prefix` is the site folder the locale is
 * served from (`/fr`), `path` the localized page path (`/fr/drafts/x`), and the
 * default locale's row points at the Stage 4 page itself, which is never
 * translated.
 */
export function serializeRecord(
  meta,
  stages,
  keywords = [],
  cannibalization = null,
  creativeDirection = null,
  brief = null,
  page = null,
  preflight = null,
  coworkerSessions = [],
  approvals = [],
  assets = [],
  locales = [],
) {
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
  const cd = creativeDirection || {};
  const bt = cd.baseTemplate || {};
  const vs = cd.visualStyle || {};
  const cp = cd.colorPalette || {};
  const cdRow = {
    templateName: bt.name || '',
    templateUrl: bt.url || '',
    templateRecommended: !!bt.recommended,
    styleName: vs.name || '',
    styleDescription: vs.description || '',
    styleSource: vs.source || '',
    paletteName: cp.name || '',
    paletteDescription: cp.description || '',
    paletteColors: (cp.colors || []).join(','),
    paletteSource: cp.source || '',
  };
  const b = brief || {};
  const briefRow = {
    title: b.title || '',
    body: b.body || '',
    destinationUrl: b.destinationUrl || '',
  };
  const briefLinkRows = (b.links || []).map((l) => ({
    label: l.label || '',
    url: l.url || '',
    description: l.description || '',
  }));
  const pg = page || {};
  const pageRow = {
    generatedAt: pg.generatedAt || '',
    path: pg.path || '',
    previewUrl: pg.previewUrl || '',
    editUrl: pg.editUrl || '',
    status: pg.status || '',
  };
  const pf = preflight || {};
  const preflightRows = (pf.categories || []).map((c) => ({
    name: c.name,
    passed: c.passed,
    total: c.total,
    score: c.score,
    source: c.source,
    ranAt: pf.ranAt || '',
  }));
  const sessionRows = (coworkerSessions || [])
    .filter((r) => r && r.userId && r.sessionId)
    .map((r) => ({
      userId: r.userId,
      sessionId: String(r.sessionId),
      startedAt: r.startedAt || '',
    }));
  const approvalRows = (approvals || [])
    .filter((r) => r && Number(r.stageIndex) && String(r.name || '').trim())
    .map((r) => ({
      stageIndex: Number(r.stageIndex),
      name: String(r.name).trim(),
      approved: !!r.approved,
      approvedAt: r.approved ? (r.approvedAt || '') : '',
    }));
  const assetRows = (assets || [])
    .filter((r) => r && Number.isFinite(Number(r.slot)))
    .map((r) => ({
      id: r.id || '',
      slot: Number(r.slot),
      alt: r.alt || '',
      prompt: r.prompt || '',
      status: r.status || '',
      sourceUrl: r.sourceUrl || '',
      mediaUrl: r.mediaUrl || '',
      model: r.model || '',
      aspect: r.aspect || '',
      visualStyle: r.visualStyle || '',
      palette: r.palette || '',
      description: r.description || '',
      createdAt: r.createdAt || '',
    }));
  const localeRows = (locales || [])
    .filter((r) => r && String(r.code || '').trim())
    .map((r) => ({
      code: String(r.code).trim(),
      label: r.label || '',
      prefix: r.prefix || '',
      isDefault: !!r.isDefault,
      status: r.status || '',
      path: r.path || '',
      previewUrl: r.previewUrl || '',
      editUrl: r.editUrl || '',
      generatedAt: r.generatedAt || '',
      error: r.error || '',
    }));
  return {
    ':type': 'multi-sheet',
    ':version': 10,
    ':names': ['meta', 'stages', 'steps', 'keywords', 'cannibalization', 'creativeDirection', 'brief', 'briefLinks', 'page', 'preflight', 'coworkerSessions', 'approvals', 'assets', 'locales'],
    meta: sheet([meta]),
    stages: sheet(stageRows),
    steps: sheet(stepRows),
    keywords: sheet(keywordRows),
    cannibalization: sheet(cannRows),
    creativeDirection: sheet([cdRow]),
    brief: sheet([briefRow]),
    briefLinks: sheet(briefLinkRows),
    page: sheet([pageRow]),
    preflight: sheet(preflightRows),
    coworkerSessions: sheet(sessionRows),
    approvals: sheet(approvalRows),
    assets: sheet(assetRows),
    locales: sheet(localeRows),
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

  // Preserve the keyword list, cannibalization, creative-direction, brief,
  // page, pre-flight, Coworker-session, approvals, and assets data across a
  // status write.
  const record = serializeRecord(
    meta,
    gated,
    project.keywords,
    project.cannibalization,
    project.creativeDirection,
    project.brief,
    project.page,
    project.preflight,
    project.coworkerSessions,
    project.approvals,
    project.assets,
    project.locales,
  );
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
  const record = serializeRecord(
    model.meta,
    model.stages,
    keywords,
    model.cannibalization,
    model.creativeDirection,
    model.brief,
    model.page,
    model.preflight,
    model.coworkerSessions,
    model.approvals,
    model.assets,
    model.locales,
  );
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
  const record = serializeRecord(
    model.meta,
    model.stages,
    model.keywords,
    cannibalization,
    model.creativeDirection,
    model.brief,
    model.page,
    model.preflight,
    model.coworkerSessions,
    model.approvals,
    model.assets,
    model.locales,
  );
  await writeRecord(org, site, slug, daFetch, record);
  return cannibalization;
}

/**
 * Persist a Stage 2 creative-direction change. Read-modify-write so a concurrent
 * keyword, cannibalization, or stage-status change is not clobbered, and the
 * given part(s) are MERGED onto the current selection so one panel's write does
 * not drop another's. Pass any subset, e.g. `{ baseTemplate }` or `{ colorPalette }`.
 * @param {{org: string, repo: string}} context
 * @param {(url: string, opts?: object) => Promise<Response>} daFetch
 * @param {string} slug
 * @param {{baseTemplate?: object, visualStyle?: object, colorPalette?: object}} changes
 * @returns {Promise<object>} the full merged creative-direction value
 */
export async function saveCreativeDirection(context, daFetch, slug, changes) {
  const { org, repo: site } = context || {};
  if (!org || !site || typeof daFetch !== 'function' || !slug) throw new Error('Missing DA context.');
  const model = parseProject(await readProject(context, daFetch, slug));
  if (!model) throw new Error('Project not found.');
  const creativeDirection = { ...model.creativeDirection, ...changes };
  const record = serializeRecord(
    model.meta,
    model.stages,
    model.keywords,
    model.cannibalization,
    creativeDirection,
    model.brief,
    model.page,
    model.preflight,
    model.coworkerSessions,
    model.approvals,
    model.assets,
    model.locales,
  );
  await writeRecord(org, site, slug, daFetch, record);
  return creativeDirection;
}

/**
 * Persist a Stage 3 brief change. Read-modify-write so a concurrent write is not
 * clobbered, and the given part(s) are MERGED onto the current brief so one
 * panel's write does not drop another's. Pass any subset, e.g. `{ body }`,
 * `{ destinationUrl }`, or `{ links }`.
 * @param {{org: string, repo: string}} context
 * @param {(url: string, opts?: object) => Promise<Response>} daFetch
 * @param {string} slug
 * @param {{title?: string, body?: string, destinationUrl?: string, links?: Array}} changes
 * @returns {Promise<object>} the full merged brief value
 */
export async function saveBrief(context, daFetch, slug, changes) {
  const { org, repo: site } = context || {};
  if (!org || !site || typeof daFetch !== 'function' || !slug) throw new Error('Missing DA context.');
  const model = parseProject(await readProject(context, daFetch, slug));
  if (!model) throw new Error('Project not found.');
  const brief = { ...model.brief, ...changes };
  const record = serializeRecord(
    model.meta,
    model.stages,
    model.keywords,
    model.cannibalization,
    model.creativeDirection,
    brief,
    model.page,
    model.preflight,
    model.coworkerSessions,
    model.approvals,
    model.assets,
    model.locales,
  );
  await writeRecord(org, site, slug, daFetch, record);
  return brief;
}

/**
 * Persist a Stage 4 generated-page change. Read-modify-write so a concurrent
 * write is not clobbered, and the given part(s) are MERGED onto the current page
 * so one panel's write does not drop another's. Pass any subset, e.g.
 * `{ path }` or `{ generatedAt, previewUrl, editUrl, status }`.
 * @param {{org: string, repo: string}} context
 * @param {(url: string, opts?: object) => Promise<Response>} daFetch
 * @param {string} slug
 * @param {{generatedAt?, path?, previewUrl?, editUrl?, status?}} changes
 * @returns {Promise<object>} the full merged page value
 */
export async function savePage(context, daFetch, slug, changes) {
  const { org, repo: site } = context || {};
  if (!org || !site || typeof daFetch !== 'function' || !slug) throw new Error('Missing DA context.');
  const model = parseProject(await readProject(context, daFetch, slug));
  if (!model) throw new Error('Project not found.');
  const page = { ...model.page, ...changes };
  const record = serializeRecord(
    model.meta,
    model.stages,
    model.keywords,
    model.cannibalization,
    model.creativeDirection,
    model.brief,
    page,
    model.preflight,
    model.coworkerSessions,
    model.approvals,
    model.assets,
    model.locales,
  );
  await writeRecord(org, site, slug, daFetch, record);
  return page;
}

/**
 * Persist a Stage 4 pre-flight result. Read-modify-write so a concurrent write
 * is not clobbered, and the given part(s) are MERGED onto the current result.
 * The pre-flight is written whole after a run, so `changes` is usually the full
 * `{ ranAt, categories }`.
 * @param {{org: string, repo: string}} context
 * @param {(url: string, opts?: object) => Promise<Response>} daFetch
 * @param {string} slug
 * @param {{ranAt?: string, categories?: Array}} changes
 * @returns {Promise<object>} the full merged pre-flight value
 */
export async function savePreflight(context, daFetch, slug, changes) {
  const { org, repo: site } = context || {};
  if (!org || !site || typeof daFetch !== 'function' || !slug) throw new Error('Missing DA context.');
  const model = parseProject(await readProject(context, daFetch, slug));
  if (!model) throw new Error('Project not found.');
  const preflight = { ...model.preflight, ...changes };
  const record = serializeRecord(
    model.meta,
    model.stages,
    model.keywords,
    model.cannibalization,
    model.creativeDirection,
    model.brief,
    model.page,
    preflight,
    model.coworkerSessions,
    model.approvals,
    model.assets,
    model.locales,
  );
  await writeRecord(org, site, slug, daFetch, record);
  return preflight;
}

/**
 * Persist the AO episode ("Coworker chat") this producer works the project in,
 * so every later wizard call joins that one chat instead of minting a new one
 * (ticket #49). Read-modify-write so a concurrent write is not clobbered; the
 * row is keyed by user because AO episodes are owned by an IMS user. A falsy
 * `sessionId` drops the user's row, which is how an episode AO refused is
 * forgotten.
 * @param {{org: string, repo: string}} context
 * @param {(url: string, opts?: object) => Promise<Response>} daFetch
 * @param {string} slug
 * @param {{userId: string, sessionId: string|null}} session
 * @returns {Promise<Array<{userId, sessionId, startedAt}>>} the saved rows
 */
export async function saveCoworkerSession(context, daFetch, slug, { userId, sessionId } = {}) {
  const { org, repo: site } = context || {};
  if (!org || !site || typeof daFetch !== 'function' || !slug) throw new Error('Missing DA context.');
  if (!userId) throw new Error('Missing user.');
  const model = parseProject(await readProject(context, daFetch, slug));
  if (!model) throw new Error('Project not found.');
  const others = (model.coworkerSessions || []).filter((r) => r.userId !== userId);
  const coworkerSessions = sessionId
    ? [...others, { userId, sessionId: String(sessionId), startedAt: new Date().toISOString() }]
    : others;
  const record = serializeRecord(
    model.meta,
    model.stages,
    model.keywords,
    model.cannibalization,
    model.creativeDirection,
    model.brief,
    model.page,
    model.preflight,
    coworkerSessions,
    model.approvals,
    model.assets,
    model.locales,
  );
  await writeRecord(org, site, slug, daFetch, record);
  return coworkerSessions;
}

/**
 * Persist one stage's named approvals (ticket #46). Read-modify-write so a
 * concurrent write is not clobbered, and keyed BY STAGE: only the named stage's
 * rows are replaced, every other stage's sign-offs are kept. That is what lets
 * stages 4, 5, and 7 share the one sheet.
 * @param {{org: string, repo: string}} context
 * @param {(url: string, opts?: object) => Promise<Response>} daFetch
 * @param {string} slug
 * @param {{stageIndex: number, approvals: Array<{name, approved, approvedAt}>}} changes
 * @returns {Promise<Array<{stageIndex, name, approved, approvedAt}>>} every stage's rows
 */
export async function saveApprovals(context, daFetch, slug, { stageIndex, approvals } = {}) {
  const { org, repo: site } = context || {};
  if (!org || !site || typeof daFetch !== 'function' || !slug) throw new Error('Missing DA context.');
  const idx = Number(stageIndex);
  if (!idx) throw new Error('Missing stage.');
  const model = parseProject(await readProject(context, daFetch, slug));
  if (!model) throw new Error('Project not found.');
  const others = (model.approvals || []).filter((r) => Number(r.stageIndex) !== idx);
  const merged = [
    ...others,
    ...(approvals || []).map((r) => ({ ...r, stageIndex: idx })),
  ];
  const record = serializeRecord(
    model.meta,
    model.stages,
    model.keywords,
    model.cannibalization,
    model.creativeDirection,
    model.brief,
    model.page,
    model.preflight,
    model.coworkerSessions,
    merged,
    model.assets,
    model.locales,
  );
  await writeRecord(org, site, slug, daFetch, record);
  return merged;
}

/**
 * Persist Stage 5 asset rows (ticket #58). Read-modify-write so a concurrent
 * write is not clobbered, and keyed BY SLOT: an incoming row replaces the
 * stored row with the same `slot` and every other row is kept, so a Regenerate
 * of one slot rewrites exactly that one row. The row carries both `sourceUrl`
 * (the expiring Firefly presigned URL the asset came from) and `mediaUrl` (the
 * permanent DA-hosted copy the page doc references, populated by the page-swap
 * ticket #60) - this save only stores what it is given.
 * @param {{org: string, repo: string}} context
 * @param {(url: string, opts?: object) => Promise<Response>} daFetch
 * @param {string} slug
 * @param {{assets: Array<{id, slot, alt, prompt, status, sourceUrl, mediaUrl,
 *   model, aspect, visualStyle, palette, description, createdAt}>}} changes
 * @returns {Promise<Array<object>>} every stored asset row
 */
export async function saveAssets(context, daFetch, slug, { assets } = {}) {
  const { org, repo: site } = context || {};
  if (!org || !site || typeof daFetch !== 'function' || !slug) throw new Error('Missing DA context.');
  const model = parseProject(await readProject(context, daFetch, slug));
  if (!model) throw new Error('Project not found.');
  const incoming = (assets || []).filter((r) => r && Number.isFinite(Number(r.slot)));
  const replaced = new Set(incoming.map((r) => Number(r.slot)));
  const merged = [
    ...(model.assets || []).filter((r) => !replaced.has(Number(r.slot))),
    ...incoming,
  ];
  const record = serializeRecord(
    model.meta,
    model.stages,
    model.keywords,
    model.cannibalization,
    model.creativeDirection,
    model.brief,
    model.page,
    model.preflight,
    model.coworkerSessions,
    model.approvals,
    merged,
    model.locales,
  );
  await writeRecord(org, site, slug, daFetch, record);
  return merged;
}

/**
 * Persist Stage 6 locale rows (ticket #76). Read-modify-write so a concurrent
 * write is not clobbered, and keyed BY CODE: an incoming row replaces the
 * stored row with the same `code` and every other row is kept, so re-translating
 * one locale rewrites exactly that one row while the others keep their
 * generated pages.
 *
 * Removing a locale is a save too, and it is the one case a merge cannot
 * express: pass `remove` with the codes the producer de-selected and they are
 * dropped from the sheet. Deleting the locale's DA doc is the panel's job, not
 * this one - this function only owns the record.
 *
 * @param {{org: string, repo: string}} context
 * @param {(url: string, opts?: object) => Promise<Response>} daFetch
 * @param {string} slug
 * @param {{locales?: Array<{code, label, prefix, isDefault, status, path,
 *   previewUrl, editUrl, generatedAt, error}>, remove?: Array<string>}} changes
 * @returns {Promise<Array<object>>} every stored locale row
 */
export async function saveLocales(context, daFetch, slug, { locales, remove } = {}) {
  const { org, repo: site } = context || {};
  if (!org || !site || typeof daFetch !== 'function' || !slug) throw new Error('Missing DA context.');
  const model = parseProject(await readProject(context, daFetch, slug));
  if (!model) throw new Error('Project not found.');
  const key = (c) => String(c ?? '').trim().toLowerCase();
  const incoming = (locales || []).filter((r) => r && key(r.code));
  const dropped = new Set([
    ...incoming.map((r) => key(r.code)),
    ...(remove || []).map(key).filter(Boolean),
  ]);
  const merged = [
    ...(model.locales || []).filter((r) => !dropped.has(key(r.code))),
    ...incoming,
  ];
  const record = serializeRecord(
    model.meta,
    model.stages,
    model.keywords,
    model.cannibalization,
    model.creativeDirection,
    model.brief,
    model.page,
    model.preflight,
    model.coworkerSessions,
    model.approvals,
    model.assets,
    merged,
  );
  await writeRecord(org, site, slug, daFetch, record);
  return merged;
}
