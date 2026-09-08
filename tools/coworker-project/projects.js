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

/**
 * Parse a project record into a view model: the meta row plus stages ordered by
 * stageIndex, each with its ordered steps attached from the steps sheet.
 * @returns {{meta: object, stages: Array<{stage, stageIndex, status, steps}>} | null}
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
        .map((st) => ({ step: st.step, displayName: st.displayName, stepIndex: Number(st.stepIndex) }))
        .sort((a, b) => a.stepIndex - b.stepIndex),
    }))
    .sort((a, b) => a.stageIndex - b.stageIndex);
  return { meta, stages };
}
