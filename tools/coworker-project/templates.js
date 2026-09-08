// Reads the site's existing DA "Templates" panel config and returns its
// templates. It mirrors the canvas panel's two-hop lookup and does NOT modify
// any config: site config -> `library` sheet -> the "Templates" row -> the
// listing sheet -> one row per template.

const DA_ADMIN = 'https://admin.da.live';

// Read a named sheet's rows from a DA sheet JSON (single- or multi-sheet).
function sheetRows(json, name) {
  if (!json || typeof json !== 'object') return [];
  if (json[':type'] === 'multi-sheet') return json[name]?.data ?? [];
  return json.data ?? [];
}

// Normalise a library row title the same way the DA panel does: "Templates" -> "templates".
const norm = (s) => (s || '').trim().toLowerCase().replaceAll(' ', '-');

// Resolve a listing row path to a fetchable URL. Absolute URLs pass through;
// relative paths resolve to the deployed site, matching the DA panel.
function resolvePath(path, org, site) {
  if (!path) return null;
  if (/^https?:\/\//.test(path)) return path;
  return `https://main--${site}--${org}.aem.live${path}`;
}

/**
 * Fetch the templates the DA Templates panel would show for this site.
 * Returns [] on any missing/broken config so callers can show an empty state.
 * @param {{org: string, repo: string}} context - the DA SDK context.
 * @param {(url: string, opts?: object) => Promise<Response>} daFetch - token-attaching fetch.
 * @returns {Promise<Array<{name: string, url: string}>>}
 */
export async function fetchTemplates(context, daFetch) {
  const { org, repo: site } = context || {};
  if (!org || !site || typeof daFetch !== 'function') return [];

  // Hop 1: site config -> `library` sheet -> the row titled "Templates".
  let configJson;
  try {
    const resp = await daFetch(`${DA_ADMIN}/config/${org}/${site}/`);
    if (!resp.ok) return [];
    configJson = await resp.json();
  } catch {
    return [];
  }
  const libRow = sheetRows(configJson, 'library').find((r) => norm(r.title) === 'templates');
  const listingUrl = resolvePath(libRow?.path, org, site);
  if (!listingUrl) return [];

  // Hop 2: the listing sheet -> one row per template.
  let listingJson;
  try {
    const resp = await daFetch(listingUrl);
    if (!resp.ok) return [];
    listingJson = await resp.json();
  } catch {
    return [];
  }
  return sheetRows(listingJson)
    .map((row) => ({
      name: row.key ?? row.name ?? row.title ?? '',
      url: row.path ?? row.value ?? '',
    }))
    .filter((t) => t.name && t.url);
}
