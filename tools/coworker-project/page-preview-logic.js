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
 * The breakpoints the Layout tab can preview at. `width` 0 means "as wide as
 * the panel"; a number is a fixed device width in CSS pixels.
 */
export const BREAKPOINTS = [
  { id: 'desktop', label: 'Desktop', width: 0 },
  { id: 'mobile', label: 'Mobile', width: 390 },
];

/**
 * The CSS width for a breakpoint id, used to resize the preview frame. An
 * unknown id falls back to the full-width desktop view. Pure.
 * @param {string} id
 * @returns {string}
 */
export function frameWidth(id) {
  const bp = BREAKPOINTS.find((b) => b.id === id) || BREAKPOINTS[0];
  return bp.width ? `${bp.width}px` : '100%';
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
