// Pure helpers for the Stage 4 Page Preview panel (ticket #42).
//
// The panel keeps the AO/DA work in page-generation.js and the persistence in
// stage-state.js; everything here is plain data shaping, so it is unit tested
// without a DOM.

const str = (v) => (typeof v === 'string' ? v.trim() : '');

const escapeHtml = (s) => String(s)
  .replaceAll('&', '&amp;')
  .replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;');

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
 * The PLACEHOLDER document shown in the Layout tab's frame. The real aem.live
 * embed is a follow-up (#45), so the frame states what it will show and names
 * the target URL instead of loading it. Pure.
 * @param {string} previewUrl
 * @returns {string}
 */
export function placeholderDoc(previewUrl) {
  const url = escapeHtml(str(previewUrl));
  const target = url
    ? `<p class="url">${url}</p>`
    : '<p class="url">No preview URL yet.</p>';
  return '<!DOCTYPE html><html lang="en"><head><meta charset="utf-8">'
    + '<style>'
    + 'body{margin:0;display:flex;align-items:center;justify-content:center;'
    + 'min-height:100vh;background:#f4f4f4;color:#4b4b4b;'
    + 'font-family:system-ui,-apple-system,sans-serif;text-align:center}'
    + 'div{padding:24px}h1{font-size:16px;margin:0 0 8px}'
    + 'p{font-size:13px;margin:0 0 4px}.url{word-break:break-all;color:#1473e6}'
    + '</style></head><body><div><h1>Page preview placeholder</h1>'
    + '<p>The live aem.live embed arrives in a follow-up.</p>'
    + `${target}</div></body></html>`;
}
