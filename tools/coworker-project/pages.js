// Page inventory for the cannibalization check (ticket #15).
//
// The corpus is every content page of the site. Primary source is the
// published `query-index.json` (read via `daFetch`, since this site's index is
// not on the public delivery origin). Fallback is a bounded walk of the DA
// source tree (`admin.da.live/list`, the app-runtime equivalent of
// `da_list_sources`), collecting `.html` docs. App/utility folders are skipped.

const DA_ADMIN = 'https://admin.da.live';
const CONTENT = 'https://content.da.live';

// Source folders that are not site content, so not cannibalization competitors.
const SKIP_FOLDERS = new Set(['tools', 'drafts', 'projects', 'docs', '.da']);
// Fragment docs (nav/footer/header) are page furniture, not competitor pages.
const SKIP_DOCS = new Set(['nav', 'footer', 'header']);
const MAX_DEPTH = 5;

/** Map a `query-index.json` payload to inventory rows. Pure. */
export function fromIndex(json) {
  const rows = json && Array.isArray(json.data) ? json.data : [];
  return rows
    .map((r) => ({
      url: r.path || r.url || '',
      title: r.title || '',
      description: r.description || '',
      keywords: r.keywords || '',
    }))
    .filter((r) => r.url);
}

// A page path relative to the site, without the `.html` extension.
function pagePath(absPath, org, site) {
  let p = absPath || '';
  const prefix = `/${org}/${site}`;
  if (p.startsWith(prefix)) p = p.slice(prefix.length);
  return p.replace(/\.html$/, '') || '/';
}

// Recursively collect `.html` docs under a DA source path. Bounded by depth and
// the skip list; folder fan-out runs in parallel.
async function walkSources(daFetch, absPath, org, site, depth) {
  if (depth > MAX_DEPTH) return [];
  let entries;
  try {
    const resp = await daFetch(`${DA_ADMIN}/list${absPath}`);
    if (!resp.ok) return [];
    entries = await resp.json();
  } catch {
    return [];
  }
  const arr = Array.isArray(entries) ? entries : [];
  const pages = arr
    .filter((e) => e.ext === 'html' && !SKIP_DOCS.has(e.name))
    .map((e) => ({
      url: pagePath(e.path, org, site), title: e.name || '', description: '', keywords: '',
    }));
  const folders = arr.filter((e) => !e.ext && e.path && !SKIP_FOLDERS.has(e.name));
  const nested = await Promise.all(
    folders.map((f) => walkSources(daFetch, f.path, org, site, depth + 1)),
  );
  return nested.reduce((acc, n) => acc.concat(n), pages);
}

/**
 * Fetch the site's page inventory: the published index if present, else a walk
 * of the source tree. Returns [] on any failure.
 * @param {{org: string, repo: string}} context
 * @param {(url: string, opts?: object) => Promise<Response>} daFetch
 * @returns {Promise<Array<{url, title, description, keywords}>>}
 */
export async function fetchPageInventory(context, daFetch) {
  const { org, repo: site } = context || {};
  if (!org || !site || typeof daFetch !== 'function') return [];
  try {
    const resp = await daFetch(`${CONTENT}/${org}/${site}/query-index.json`);
    if (resp.ok) {
      const rows = fromIndex(await resp.json());
      if (rows.length) return rows;
    }
  } catch {
    // fall through to the source walk
  }
  return walkSources(daFetch, `/${org}/${site}`, org, site, 0);
}
