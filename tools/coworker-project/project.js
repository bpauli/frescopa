// Builds and persists a project record. A project is stored as a DA multi-sheet
// doc at /source/{org}/{site}/projects/<slug>.json: a `meta` row plus a frozen
// `stages`/`steps` snapshot of the chosen template's stage config. The read-only
// project view renders from this record alone, so nothing is re-read after create.

import { fetchStageConfig } from './stages.js';

const DA_ADMIN = 'https://admin.da.live';

// Slug from a title: lowercase, non-alphanumerics to hyphens, trimmed.
export function slugify(title) {
  return (title || '')
    .toLowerCase().trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

function userOf(context) {
  const u = context?.user;
  return (u && (u.email || u.id)) || '';
}

// Wrap a rows array as a DA single sheet payload.
const sheet = (data) => ({ total: data.length, limit: data.length, offset: 0, data });

/**
 * Build the multi-sheet project record. Stage-level status is seeded:
 * the first stage is "Not Started", every later stage is "Locked".
 */
export function buildRecord({
  slug, title, description, templateId, templatePath, stages, createdBy,
}) {
  const stageRows = stages.map((s) => ({
    stage: s.stage,
    stageIndex: s.stageIndex,
    status: s.stageIndex === 1 ? 'Not Started' : 'Locked',
  }));
  const stepRows = stages.flatMap((s) => s.steps.map((st) => ({
    stage: s.stage,
    stageIndex: s.stageIndex,
    stepIndex: st.stepIndex,
    step: st.step,
    displayName: st.displayName,
  })));
  return {
    ':type': 'multi-sheet',
    ':version': 3,
    ':names': ['meta', 'stages', 'steps'],
    meta: sheet([{
      slug,
      title,
      description: description || '',
      templateId: templateId || '',
      templatePath: templatePath || '',
      status: 'Not Started',
      createdAt: new Date().toISOString(),
      createdBy: createdBy || '',
      version: '1',
    }]),
    stages: sheet(stageRows),
    steps: sheet(stepRows),
  };
}

// True when a project record already lives at this slug.
export async function projectExists(context, daFetch, slug) {
  const { org, repo: site } = context || {};
  try {
    const resp = await daFetch(`${DA_ADMIN}/source/${org}/${site}/projects/${slug}.json`);
    return resp.ok;
  } catch {
    return false;
  }
}

/**
 * Create a project: derive the slug, refuse duplicates (live check), snapshot the
 * template's stage config, and write the record. Returns { slug, record, editUrl }.
 * Throws on a missing name, a duplicate slug, or a failed write.
 */
export async function createProject(context, daFetch, {
  title, description, templateId, templatePath,
}) {
  const { org, repo: site } = context || {};
  if (!org || !site || typeof daFetch !== 'function') throw new Error('Missing DA context.');

  const slug = slugify(title);
  if (!slug) throw new Error('Enter a project name.');
  if (await projectExists(context, daFetch, slug)) {
    throw new Error(`A project named "${slug}" already exists. Choose another name.`);
  }

  const stages = await fetchStageConfig(context, daFetch, templateId);
  const record = buildRecord({
    slug, title, description, templateId, templatePath, stages, createdBy: userOf(context),
  });

  const body = new FormData();
  body.set('data', new Blob([JSON.stringify(record, null, 2)], { type: 'application/json' }));
  const resp = await daFetch(`${DA_ADMIN}/source/${org}/${site}/projects/${slug}.json`, {
    method: 'POST',
    body,
  });
  if (!resp.ok) throw new Error(`Create failed: ${resp.status} ${resp.statusText}`);

  const json = await resp.json().catch(() => ({}));
  return {
    slug,
    record,
    editUrl: json?.source?.editUrl,
    contentUrl: json?.source?.contentUrl,
  };
}
