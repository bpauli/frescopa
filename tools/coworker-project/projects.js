// Lists and reads project records. Projects are DA multi-sheet docs under
// /source/{org}/{site}/projects/. The list comes from the admin /list endpoint;
// each record is read from content.da.live.

const DA_ADMIN = 'https://admin.da.live';
const CONTENT = 'https://content.da.live';

// The `meta` row of a project record (multi-sheet), or {} if absent.
function metaRow(record) {
  if (!record || typeof record !== 'object') return {};
  if (record[':type'] === 'multi-sheet') return record.meta?.data?.[0] ?? {};
  return record.data?.[0] ?? {};
}

/**
 * List the site's projects, newest first. Returns [] on any failure.
 * @returns {Promise<Array<{slug, title, templateId, status, createdAt, path}>>}
 */
export async function listProjects(context, daFetch) {
  const { org, repo: site } = context || {};
  if (!org || !site || typeof daFetch !== 'function') return [];

  let entries;
  try {
    const resp = await daFetch(`${DA_ADMIN}/list/${org}/${site}/projects`);
    if (!resp.ok) return [];
    entries = await resp.json();
  } catch {
    return [];
  }
  const jsonEntries = (Array.isArray(entries) ? entries : []).filter((e) => e.ext === 'json');

  const items = await Promise.all(jsonEntries.map(async (e) => {
    try {
      const resp = await daFetch(`${CONTENT}${e.path}`);
      if (!resp.ok) return null;
      const meta = metaRow(await resp.json());
      return {
        slug: meta.slug || e.name,
        title: meta.title || e.name,
        templateId: meta.templateId || '',
        status: meta.status || '',
        createdAt: meta.createdAt || '',
        path: e.path,
      };
    } catch {
      return null;
    }
  }));

  return items
    .filter(Boolean)
    .sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
}

/** Read one project record by slug, or null. */
export async function readProject(context, daFetch, slug) {
  const { org, repo: site } = context || {};
  if (!org || !site || typeof daFetch !== 'function' || !slug) return null;
  try {
    const resp = await daFetch(`${CONTENT}/${org}/${site}/projects/${slug}.json`);
    if (!resp.ok) return null;
    return await resp.json();
  } catch {
    return null;
  }
}

// One of the two known creative-direction sources, or '' when unset.
const cdSource = (v) => {
  if (v === 'custom') return 'custom';
  if (v === 'suggested') return 'suggested';
  return '';
};

/**
 * Parse a project record into a view model: the meta row, stages ordered by
 * stageIndex (each with its ordered steps), the Stage 1 keyword list and
 * cannibalization result, the Stage 2 creative-direction selection, the
 * Stage 3 brief, the Stage 4 generated page and pre-flight result, the
 * per-producer Coworker session rows, the per-stage approvals, and the Stage 5
 * asset rows (one per page image slot).
 * @returns {{meta: object, stages: Array<{stage, stageIndex, status, steps}>,
 *   keywords: Array<{text, role}>, cannibalization: object,
 *   creativeDirection: {baseTemplate, visualStyle, colorPalette},
 *   brief: {title, body, destinationUrl, links: Array},
 *   page: {generatedAt, path, previewUrl, editUrl, status},
 *   preflight: {ranAt, categories: Array<{name, passed, total, score, source}>},
 *   coworkerSessions: Array<{userId, sessionId, startedAt}>,
 *   assets: Array<{id, slot, alt, prompt, status, sourceUrl, mediaUrl, model,
 *   aspect, visualStyle, palette, description, createdAt}>} | null}
 */
export function parseProject(record) {
  if (!record || typeof record !== 'object') return null;
  const meta = metaRow(record);
  const stageRows = record.stages?.data ?? [];
  const stepRows = record.steps?.data ?? [];
  const stages = stageRows
    .map((s) => ({
      stage: s.stage,
      stageIndex: Number(s.stageIndex),
      status: s.status || '',
      steps: stepRows
        .filter((st) => Number(st.stageIndex) === Number(s.stageIndex))
        .map((st) => ({
          step: st.step, displayName: st.displayName, stepIndex: Number(st.stepIndex),
        }))
        .sort((a, b) => a.stepIndex - b.stepIndex),
    }))
    .sort((a, b) => a.stageIndex - b.stageIndex);
  const keywords = (record.keywords?.data ?? [])
    .map((k) => ({
      text: (k.text || '').trim(),
      role: k.role === 'primary' ? 'primary' : 'secondary',
    }))
    .filter((k) => k.text);
  const cannRows = record.cannibalization?.data ?? [];
  const cannibalization = {
    checkedAt: cannRows[0]?.checkedAt || '',
    competitors: cannRows
      .map((c) => ({
        url: (c.url || '').trim(),
        title: c.title || '',
        overlap: c.overlap === 'high' ? 'high' : 'low',
        status: c.status === 'ignored' ? 'ignored' : 'flagged',
        reason: c.reason || '',
      }))
      .filter((c) => c.url),
  };
  const cdRow = record.creativeDirection?.data?.[0] ?? {};
  const creativeDirection = {
    baseTemplate: {
      name: (cdRow.templateName || '').trim(),
      url: (cdRow.templateUrl || '').trim(),
      recommended: !!cdRow.templateRecommended,
    },
    visualStyle: {
      name: (cdRow.styleName || '').trim(),
      description: (cdRow.styleDescription || '').trim(),
      source: cdSource(cdRow.styleSource),
    },
    colorPalette: {
      name: (cdRow.paletteName || '').trim(),
      description: (cdRow.paletteDescription || '').trim(),
      colors: (cdRow.paletteColors || '').split(',').map((c) => c.trim()).filter(Boolean),
      source: cdSource(cdRow.paletteSource),
    },
  };
  const briefRow = record.brief?.data?.[0] ?? {};
  const brief = {
    title: (briefRow.title || '').trim(),
    // body is markdown - keep it verbatim (no trim) so edits round-trip exactly.
    body: typeof briefRow.body === 'string' ? briefRow.body : '',
    destinationUrl: (briefRow.destinationUrl || '').trim(),
    links: (record.briefLinks?.data ?? [])
      .map((l) => ({
        label: (l.label || '').trim(),
        url: (l.url || '').trim(),
        description: (l.description || '').trim(),
      }))
      .filter((l) => l.label && l.url),
  };
  const pageRow = record.page?.data?.[0] ?? {};
  const page = {
    // timestamps are machine-generated - keep them verbatim.
    generatedAt: pageRow.generatedAt || '',
    path: (pageRow.path || '').trim(),
    previewUrl: (pageRow.previewUrl || '').trim(),
    editUrl: (pageRow.editUrl || '').trim(),
    status: (pageRow.status || '').trim(),
  };
  const pfRows = record.preflight?.data ?? [];
  const preflight = {
    ranAt: pfRows[0]?.ranAt || '',
    categories: pfRows
      .map((r) => ({
        name: (r.name || '').trim(),
        passed: Number(r.passed) || 0,
        total: Number(r.total) || 0,
        score: Number(r.score) || 0,
        source: r.source === 'ai' ? 'ai' : 'psi',
      }))
      .filter((c) => c.name),
  };
  // One row per producer: AO episodes are owned by an IMS user, so the project's
  // Coworker chat is per user (ticket #49). An older record has no sheet -> [].
  const coworkerSessions = (record.coworkerSessions?.data ?? [])
    .map((r) => ({
      userId: String(r.userId ?? '').trim(),
      sessionId: String(r.sessionId ?? '').trim(),
      startedAt: r.startedAt || '',
    }))
    .filter((r) => r.userId && r.sessionId);
  // One row per named sign-off, keyed by stage: the approvals gate is shared by
  // stages 4, 5, and 7 (ticket #46). An older record has no sheet -> [].
  const approvals = (record.approvals?.data ?? [])
    .map((r) => ({
      stageIndex: Number(r.stageIndex) || 0,
      name: String(r.name ?? '').trim(),
      approved: r.approved === true || r.approved === 'true',
      approvedAt: r.approvedAt || '',
    }))
    .filter((r) => r.stageIndex && r.name);
  // One row per page image slot, keyed by `slot` (ticket #58): `sourceUrl` is
  // where the asset came from (a Firefly presigned URL that expires after an
  // hour), `mediaUrl` the permanent DA-hosted copy the page doc references
  // (populated by the page-swap ticket #60). An older record has no sheet -> [].
  const assets = (record.assets?.data ?? [])
    .map((r) => ({
      id: String(r.id ?? ''),
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
    }))
    .filter((r) => Number.isFinite(r.slot));
  return {
    meta,
    stages,
    keywords,
    cannibalization,
    creativeDirection,
    brief,
    page,
    preflight,
    coworkerSessions,
    approvals,
    assets,
  };
}
