// Stage 4 page-generation contract (ticket #41).
//
// One seam over the structured Coworker (AO) client (coworker.js `askJson`) that
// turns the Stage 3 brief plus the Stage 2 creative direction into a REAL page:
//   1. AO returns a structured section outline (JSON, never raw HTML).
//   2. `buildInnerHtml` builds the EDS section markup from that outline.
//   3. `replaceHtml` (da.live's own helper) wraps it in the DA page envelope.
//   4. The doc is written to DA at `{path}.html` and previewed on aem.page.
// Like the sibling contracts it never throws: every failure degrades to a soft
// error the panel (#42) can render without a try/catch.
//
// Format decision (proven by the gate, #38): DA page docs are an HTML fragment,
// NOT markdown - each direct child `<div>` of `<main>` is one EDS section. AO is
// asked for structured JSON rather than markup so the HTML that lands on the
// customer's site is built here, deterministically and escaped.
//
// Images are PLACEHOLDERS: AO describes the wanted image in `alt` and never
// invents an asset URL. Real asset generation is a later stage. On preview the
// aem.page pipeline ingests each placeholder into the site's own `./media`, so
// the page carries no runtime dependency on the placeholder service.

import { getCoworker } from './coworker.js';

const DA_ADMIN = 'https://admin.da.live';
const AEM_ADMIN = 'https://admin.hlx.page';
const DAFETCH_URL = 'https://da.live/nx/utils/daFetch.js';
const REF = 'main';

// Placeholder image service used until real assets are generated. The alt text
// carries the wanted image, so a later stage can swap the src without re-asking.
const PLACEHOLDER_BASE = 'https://placehold.co/1600x900/e9e9e9/6b6b6b';

const MAX_SECTIONS = 8;
const MAX_PARAGRAPHS = 6;
const MAX_BULLETS = 8;
const PLACEHOLDER_LABEL_MAX = 60;

const str = (v) => (typeof v === 'string' ? v.trim() : '');

const escapeHtml = (s) => String(s)
  .replaceAll('&', '&amp;')
  .replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;');

// Normalise a link target: keep absolute http(s), otherwise ensure a leading
// "/". Returns '' when empty or another scheme.
function normalizeHref(raw) {
  const s = str(raw);
  if (!s || /\s/.test(s)) return '';
  if (/^https?:\/\//i.test(s)) return s;
  if (/^[a-z][a-z0-9+.-]*:/i.test(s)) return '';
  return s.startsWith('/') ? s : `/${s}`;
}

// A single path segment, slugified the way `project.js` slugifies a title.
const slugSegment = (s) => s
  .toLowerCase().trim()
  .replace(/[^a-z0-9]+/g, '-')
  .replace(/^-|-$/g, '');

/**
 * Derive the DA/EDS page path from a destination URL: the site-relative,
 * EXTENSIONLESS, slugified path (e.g. "Drafts/My Page.html" -> "/drafts/my-page").
 * An absolute URL contributes its pathname only. Returns '' when nothing usable
 * is left. Pure.
 * @param {unknown} raw
 * @returns {string}
 */
export function derivePagePath(raw) {
  let s = str(raw);
  if (!s) return '';
  if (/^https?:\/\//i.test(s)) {
    try {
      s = new URL(s).pathname;
    } catch {
      return '';
    }
  }
  s = s.replace(/\.(html|md)$/i, '');
  const segments = s.split('/').map(slugSegment).filter(Boolean);
  return segments.length ? `/${segments.join('/')}` : '';
}

/**
 * The preview (aem.page) and DA edit URLs for a page path. Used as a fallback
 * when the DA write response does not carry them. Pure.
 * @param {string} org
 * @param {string} site
 * @param {string} path - extensionless, leading-slash page path
 * @returns {{previewUrl: string, editUrl: string}}
 */
export function pageUrls(org, site, path) {
  return {
    previewUrl: `https://${REF}--${site}--${org}.aem.page${path}`,
    editUrl: `https://da.live/edit#/${org}/${site}${path}`,
  };
}

// --- AO contract ---

// A one-line summary of the Stage 2 creative direction, or ''.
function directionSummary(cd) {
  const c = cd || {};
  const parts = [];
  const style = str(c.visualStyle?.name);
  const palette = str(c.colorPalette?.name);
  const template = str(c.baseTemplate?.name);
  if (style) parts.push(`visual style "${style}"${str(c.visualStyle?.description) ? ` (${str(c.visualStyle.description)})` : ''}`);
  if (palette) {
    const raw = c.colorPalette?.colors;
    const colors = Array.isArray(raw) ? raw.filter(Boolean) : [];
    parts.push(`color palette "${palette}"${colors.length ? ` (${colors.join(', ')})` : ''}`);
  }
  if (template) parts.push(`base template "${template}"`);
  return parts.length ? `The agreed creative direction is ${parts.join('; ')}.` : '';
}

// The CTA targets the producer already chose in Stage 3, or ''.
function linkSummary(brief) {
  const links = Array.isArray(brief?.links) ? brief.links : [];
  const rows = links
    .map((l) => ({ label: str(l?.label), url: normalizeHref(l?.url) }))
    .filter((l) => l.label && l.url)
    .map((l) => `${l.label} -> ${l.url}`);
  return rows.length ? `Use these calls-to-action where they fit:\n${rows.join('\n')}` : '';
}

function buildPagePrompt(brief, creativeDirection, path) {
  const b = brief || {};
  const title = str(b.title);
  const body = str(b.body);
  const ctx = [
    title ? `Page title: "${title}".` : '',
    path ? `Destination path: ${path}.` : '',
    body ? `Page brief:\n${body.slice(0, 1500)}` : '',
    directionSummary(creativeDirection),
    linkSummary(b),
  ].filter(Boolean).join('\n\n');
  return 'You are a marketing copywriter composing a complete web page from a page brief. '
    + `Write the finished page copy.\n\n${ctx}\n\n`
    + 'Return ONLY JSON of the form {"sections":[{"heading":"...","body":["paragraph"],'
    + '"bullets":["..."],"image":{"alt":"..."},"cta":{"label":"...","url":"/path"}}]} where:\n'
    + '- There are 4 to 6 sections. The first section is the hero: one headline, one short '
    + 'paragraph, and a call-to-action.\n'
    + '- "heading" and every "body" paragraph are PLAIN TEXT - no markdown, no HTML, no emoji.\n'
    + '- "bullets", "image" and "cta" are optional per section; use them only where they help.\n'
    + '- "image" is a PLACEHOLDER: describe the wanted picture in "alt" (one short sentence). '
    + 'Never invent an image URL or file name.\n'
    + '- "cta.url" is a site-relative path that starts with "/".\n'
    + 'No prose and no markdown outside the JSON.';
}

/**
 * Clean a raw AO page outline to `[{heading, body, bullets, image, cta}]`.
 * Accepts `{sections: [...]}` or a bare array. Text is trimmed, paragraphs and
 * bullets are capped, an image survives only with a description, a CTA only with
 * a label and a usable href, and an empty section is dropped. Pure.
 * @param {unknown} raw
 * @param {number} [max]
 * @returns {Array<{heading: string, body: string[], bullets: string[],
 *   image: {alt: string}|null, cta: {label: string, url: string}|null}>}
 */
export function cleanSections(raw, max = MAX_SECTIONS) {
  let list = [];
  if (Array.isArray(raw)) list = raw;
  else if (raw && Array.isArray(raw.sections)) list = raw.sections;

  const out = [];
  for (let i = 0; i < list.length && out.length < max; i += 1) {
    const item = list[i] && typeof list[i] === 'object' ? list[i] : {};
    const heading = str(item.heading || item.title);
    const rawBody = Array.isArray(item.body) ? item.body : [item.body];
    const body = rawBody.map(str).filter(Boolean).slice(0, MAX_PARAGRAPHS);
    const rawBullets = Array.isArray(item.bullets) ? item.bullets : [];
    const bullets = rawBullets.map(str).filter(Boolean).slice(0, MAX_BULLETS);

    const imageAlt = typeof item.image === 'string'
      ? str(item.image)
      : str(item.image?.alt || item.image?.description || item.image?.prompt);
    const image = imageAlt ? { alt: imageAlt } : null;

    const ctaLabel = str(item.cta?.label || item.cta?.text);
    const ctaUrl = normalizeHref(item.cta?.url || item.cta?.href);
    const cta = ctaLabel && ctaUrl ? { label: ctaLabel, url: ctaUrl } : null;

    if (heading || body.length || bullets.length) {
      out.push({
        heading, body, bullets, image, cta,
      });
    }
  }
  return out;
}

/**
 * The short label drawn inside a placeholder image: the description, cut at a
 * word boundary so it does not break mid-word. Pure.
 * @param {string} alt
 * @returns {string}
 */
export function placeholderLabel(alt) {
  const s = str(alt) || 'Image placeholder';
  if (s.length <= PLACEHOLDER_LABEL_MAX) return s;
  const cut = s.slice(0, PLACEHOLDER_LABEL_MAX);
  const space = cut.lastIndexOf(' ');
  const head = space > 20 ? cut.slice(0, space) : cut;
  return `${head.replace(/[.,;:!?-]+$/, '')}...`;
}

/**
 * Placeholder image markup for a described image. The description is kept in
 * `alt` so a later stage can generate the real asset from it. Pure.
 * @param {string} alt
 * @returns {string}
 */
export function placeholderImageHtml(alt) {
  const text = encodeURIComponent(placeholderLabel(alt));
  return `<img src="${PLACEHOLDER_BASE}?text=${text}" alt="${escapeHtml(str(alt))}">`;
}

/**
 * Build the INNER EDS markup for a page: one `<div>` per section, in order,
 * each holding a heading, a placeholder image, paragraphs, a bullet list and a
 * call-to-action link as authored. The first section's heading is the page `h1`,
 * later headings are `h2`. All text is escaped. Pure.
 * @param {Array<object>} sections - cleaned sections (see `cleanSections`)
 * @returns {string}
 */
export function buildInnerHtml(sections) {
  const list = Array.isArray(sections) ? sections : [];
  return list.map((section, index) => {
    const s = section || {};
    const parts = [];
    if (s.heading) {
      const tag = index === 0 ? 'h1' : 'h2';
      parts.push(`<${tag}>${escapeHtml(s.heading)}</${tag}>`);
    }
    if (s.image?.alt) parts.push(`<p>${placeholderImageHtml(s.image.alt)}</p>`);
    (Array.isArray(s.body) ? s.body : []).forEach((p) => parts.push(`<p>${escapeHtml(p)}</p>`));
    const bullets = Array.isArray(s.bullets) ? s.bullets : [];
    if (bullets.length) {
      parts.push(`<ul>${bullets.map((b) => `<li>${escapeHtml(b)}</li>`).join('')}</ul>`);
    }
    // A lone link in its own paragraph is what EDS decorates into a button.
    if (s.cta) parts.push(`<p><a href="${escapeHtml(s.cta.url)}">${escapeHtml(s.cta.label)}</a></p>`);
    return `<div>${parts.join('')}</div>`;
  }).join('');
}

// --- DA write + aem.page preview (the #38 recipe) ---

// Wrap the inner section markup in DA's page envelope. `replaceHtml` is da.live's
// own helper, imported from the hosted module (as coworker.js does) so this file
// stays importable outside the browser.
async function wrapPageHtml(inner, org, site) {
  const { replaceHtml } = await import(DAFETCH_URL);
  return replaceHtml(inner, org, site);
}

// Write the page doc to DA. Same FormData/Blob mechanism as the project record
// (project.js), with a `text/html` blob at `{path}.html`.
async function writePageDoc(daFetch, org, site, path, html) {
  const body = new FormData();
  body.set('data', new Blob([html], { type: 'text/html' }));
  const resp = await daFetch(`${DA_ADMIN}/source/${org}/${site}${path}.html`, { method: 'POST', body });
  if (!resp.ok) throw new Error(`Page write failed: ${resp.status} ${resp.statusText}`);
  const json = await resp.json().catch(() => ({}));
  const fallback = pageUrls(org, site, path);
  return {
    previewUrl: str(json?.aem?.previewUrl) || fallback.previewUrl,
    editUrl: str(json?.source?.editUrl) || fallback.editUrl,
  };
}

// Trigger the aem.page preview. The path must be extensionless. `daFetch` adds
// both `Authorization` and `x-content-source-authorization` for this origin.
// Returns a soft error message, or null on success: the doc is already in DA, so
// a preview failure must not lose the page.
async function triggerPreview(daFetch, org, site, path) {
  try {
    const resp = await daFetch(`${AEM_ADMIN}/preview/${org}/${site}/${REF}${path}`, { method: 'POST' });
    if (resp.ok) return null;
    return `Page saved, but the preview failed: ${resp.status} ${resp.statusText}`;
  } catch (e) {
    return `Page saved, but the preview failed: ${e.message || 'unknown error'}`;
  }
}

/**
 * Generate the page for a project: ask AO for the section outline, build the EDS
 * markup, write the doc to DA at the destination path, and trigger the aem.page
 * preview. Never throws - any failure returns `status: 'Failed'` plus a soft
 * error message, and a preview failure keeps the written page with a soft error.
 * @param {{org: string, repo: string}} context
 * @param {(url: string, opts?: object) => Promise<Response>} daFetch
 * @param {{brief?: object, creativeDirection?: object, path?: string}} options
 * @returns {Promise<{path: string, previewUrl: string, editUrl: string,
 *   generatedAt: string, status: string, error: string|null}>}
 */
export async function generatePage(context, daFetch, { brief, creativeDirection, path } = {}) {
  const { org, repo: site } = context || {};
  const generatedAt = new Date().toISOString();
  const target = derivePagePath(path ?? brief?.destinationUrl);
  const fail = (error) => ({
    path: target,
    previewUrl: '',
    editUrl: '',
    generatedAt,
    status: 'Failed',
    error,
  });

  if (!org || !site || typeof daFetch !== 'function') return fail('Missing DA context.');
  if (!target) return fail('Set a destination URL for the page first.');
  if (!str(brief?.title) && !str(brief?.body)) return fail('Write the page brief first.');

  try {
    const prompt = buildPagePrompt(brief, creativeDirection, target);
    const json = await getCoworker(context).askJson(prompt);
    const sections = cleanSections(json);
    if (!sections.length) return fail('No page content came back. Try again.');

    const html = await wrapPageHtml(buildInnerHtml(sections), org, site);
    const { previewUrl, editUrl } = await writePageDoc(daFetch, org, site, target, html);
    const error = await triggerPreview(daFetch, org, site, target);
    return {
      path: target, previewUrl, editUrl, generatedAt, status: 'Generated', error,
    };
  } catch (e) {
    return fail(e.message || 'Page generation failed.');
  }
}
