// Pure helpers for the Stage 4 Page Preview panel (ticket #42).
//
// The panel keeps the AO/DA work in page-generation.js and the persistence in
// stage-state.js; everything here is plain data shaping, so it is unit tested
// without a DOM.

const str = (v) => (typeof v === 'string' ? v.trim() : '');

// Query parameter carrying the generation timestamp on the embedded preview
// URL. The aem.page render is cached for a minute, and an iframe whose `src`
// does not change is never reloaded, so the stamp is what makes a regenerated
// page show up in the Layout tab instead of the previous render.
const EMBED_STAMP_PARAM = 'cw-generated';

/**
 * The breakpoints the Layout tab can preview at, each a REAL viewport size: the
 * page is rendered at that size and then scaled down to fit the panel, so
 * Desktop shows the whole desktop layout rather than the desktop page squeezed
 * into the panel width.
 */
export const BREAKPOINTS = [
  {
    id: 'desktop', label: 'Desktop', width: 1280, height: 800,
  },
  {
    id: 'mobile', label: 'Mobile', width: 390, height: 844,
  },
];

// How tall the scaled preview may get inside the panel. It caps the scale the
// same way the panel width does, so a tall mobile viewport stays a thumbnail.
export const PREVIEW_MAX_HEIGHT = 520;

const breakpoint = (id) => BREAKPOINTS.find((b) => b.id === id) || BREAKPOINTS[0];

/**
 * The geometry of the Layout tab's preview for a breakpoint inside a panel of
 * `availableWidth` CSS pixels: the viewport size to render the page at, the
 * scale factor that shrinks it to fit, and the size of the box the scaled
 * render occupies. Never scales up, and an unknown breakpoint or an unusable
 * width falls back to the desktop view at a scale that still fits. Pure.
 * @param {number} availableWidth
 * @param {string} id
 * @returns {{width: number, height: number, scale: number,
 *   boxWidth: number, boxHeight: number}}
 */
export function previewFrame(availableWidth, id) {
  const bp = breakpoint(id);
  const avail = Number(availableWidth);
  const byWidth = Number.isFinite(avail) && avail > 0 ? avail / bp.width : 1;
  const byHeight = PREVIEW_MAX_HEIGHT / bp.height;
  const scale = Math.round(Math.min(1, byWidth, byHeight) * 1000) / 1000;
  return {
    width: bp.width,
    height: bp.height,
    scale,
    boxWidth: Math.round(bp.width * scale),
    boxHeight: Math.round(bp.height * scale),
  };
}

/**
 * Whether the project already carries a generated page. The preview URL is the
 * proof: it only exists once the doc was written to DA. Pure.
 * @param {{previewUrl?: string}} page
 * @returns {boolean}
 */
export function hasGeneratedPage(page) {
  return !!str(page?.previewUrl);
}

/**
 * The status shown next to the page title. A generated page is a Draft until a
 * later stage approves it; a failed run keeps saying so. Pure.
 * @param {{previewUrl?: string, status?: string}} page
 * @returns {string}
 */
export function pageStatusLabel(page) {
  if (!hasGeneratedPage(page)) return 'Not generated';
  return str(page?.status) === 'Failed' ? 'Failed' : 'Draft';
}

// "/drafts/my-new-page" -> "My new page"
function titleFromPath(path) {
  const last = str(path).split('/').filter(Boolean).pop() || '';
  const words = last.replace(/-+/g, ' ').trim();
  return words ? words.charAt(0).toUpperCase() + words.slice(1) : '';
}

/**
 * The page's display title: the brief title, else a title made from the page
 * path, else a neutral fallback. Pure.
 * @param {{path?: string}} page
 * @param {{title?: string}} brief
 * @returns {string}
 */
export function pageTitle(page, brief) {
  return str(brief?.title) || titleFromPath(page?.path) || 'Generated page';
}

/**
 * The markdown URL for a generated page: the aem.page preview URL with the `.md`
 * extension, which is what the Content tab reads. Query and hash are dropped.
 * Returns '' when there is no preview URL. Pure.
 * @param {string} previewUrl
 * @returns {string}
 */
export function contentUrl(previewUrl) {
  let s = str(previewUrl);
  if (!s) return '';
  s = s.split('#')[0].split('?')[0].replace(/\/+$/, '');
  if (!s) return '';
  if (/\.md$/i.test(s)) return s;
  return `${s.replace(/\.html$/i, '')}.md`;
}

/**
 * The record fields persisted through `savePage`: the generation result without
 * its soft-error field, which is transient UI state and not part of the record.
 * Pure.
 * @param {{generatedAt?, path?, previewUrl?, editUrl?, status?}} result
 * @returns {{generatedAt: string, path: string, previewUrl: string,
 *   editUrl: string, status: string}}
 */
export function pageChanges(result) {
  const r = result || {};
  return {
    generatedAt: str(r.generatedAt),
    path: str(r.path),
    previewUrl: str(r.previewUrl),
    editUrl: str(r.editUrl),
    status: str(r.status),
  };
}

/**
 * The URL the Layout tab embeds: the page's own aem.page render, stamped with
 * the generation time so a regenerated page reloads the frame instead of
 * showing the cached previous render. Any fragment is dropped, and a missing or
 * non-http(s) preview URL yields '' so the panel can show its empty state
 * rather than a blank frame. Pure.
 * @param {string} previewUrl
 * @param {string} [generatedAt]
 * @returns {string}
 */
export function embedUrl(previewUrl, generatedAt) {
  const s = str(previewUrl);
  if (!/^https?:\/\//i.test(s)) return '';
  let url;
  try {
    url = new URL(s);
  } catch {
    return '';
  }
  url.hash = '';
  const stamp = str(generatedAt);
  if (stamp) url.searchParams.set(EMBED_STAMP_PARAM, stamp);
  return url.toString();
}
