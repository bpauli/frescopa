// Reads the dedicated stage-config sheet and returns a template's workflow as
// ordered stages, each with its ordered steps. The sheet is a flat one-row-per-
// step list (columns: template, stage, stageIndex, stepIndex, step, displayName).
//
// Discovery: try the `coworker` config sheet row `project-stages` for the sheet
// URL; fall back to the known content.da.live path so the app works even when
// the optional config pointer was never written.

const DA_ADMIN = 'https://admin.da.live';
const CONTENT = 'https://content.da.live';
const STAGES_PATH = '/docs/library/project-stages.json';

function sheetRows(json, name) {
  if (!json || typeof json !== 'object') return [];
  if (json[':type'] === 'multi-sheet') return json[name]?.data ?? [];
  return json.data ?? [];
}

const norm = (s) => (s || '').trim().toLowerCase().replaceAll(' ', '-');

async function stagesUrl(org, site, daFetch) {
  try {
    const resp = await daFetch(`${DA_ADMIN}/config/${org}/${site}/`);
    if (resp.ok) {
      const json = await resp.json();
      const row = sheetRows(json, 'coworker').find((r) => norm(r.key ?? r.name) === 'project-stages');
      const val = row?.value ?? row?.path;
      if (val) return /^https?:\/\//.test(val) ? val : `${CONTENT}/${org}/${site}${val}`;
    }
  } catch {
    // fall through to the known path
  }
  return `${CONTENT}/${org}/${site}${STAGES_PATH}`;
}

/**
 * Load a template's stage config, grouped and ordered.
 * @param {{org: string, repo: string}} context
 * @param {(url: string, opts?: object) => Promise<Response>} daFetch
 * @param {string} templateId - keep only rows for this template (e.g. "SEO").
 * @returns {Promise<Array<{stage: string, stageIndex: number,
 *   steps: Array<{step: string, displayName: string, stepIndex: number}>}>>}
 */
export async function fetchStageConfig(context, daFetch, templateId) {
  const { org, repo: site } = context || {};
  if (!org || !site || typeof daFetch !== 'function') return [];

  const url = await stagesUrl(org, site, daFetch);
  let json;
  try {
    const resp = await daFetch(url);
    if (!resp.ok) return [];
    json = await resp.json();
  } catch {
    return [];
  }

  const rows = sheetRows(json).filter((r) => !templateId || r.template === templateId);
  const byStage = new Map();
  rows.forEach((r) => {
    const stageIndex = Number(r.stageIndex);
    if (!byStage.has(stageIndex)) {
      byStage.set(stageIndex, { stage: r.stage, stageIndex, steps: [] });
    }
    byStage.get(stageIndex).steps.push({
      step: r.step,
      displayName: r.displayName,
      stepIndex: Number(r.stepIndex),
    });
  });

  return [...byStage.values()]
    .sort((a, b) => a.stageIndex - b.stageIndex)
    .map((s) => ({ ...s, steps: s.steps.sort((a, b) => a.stepIndex - b.stepIndex) }));
}
