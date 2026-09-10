// Stage 3 Brief-Generation AO contracts (ticket #32).
//
// Three seams over the structured Coworker (AO) client (coworker.js `askJson`),
// each owning its JSON contract, cleaning the response, and degrading to an
// empty result plus a soft error so the panels (#33/#34/#35) never try/catch:
//   generateBrief - a page brief (title + markdown body) from keyword + creative direction.
//   suggestUrls   - SEO-friendly destination URL slugs.
//   suggestLinks  - link / call-to-action targets.

import { getCoworker } from './coworker.js';

const MAX_URLS = 6;
const MAX_LINKS = 6;

// Normalise a URL/path: trim; keep absolute http(s); otherwise ensure a leading
// "/". Returns null when empty.
function normalizeUrl(raw) {
  const s = (typeof raw === 'string' ? raw : '').trim();
  if (!s) return null;
  if (/^https?:\/\//i.test(s)) return s;
  return s.startsWith('/') ? s : `/${s}`;
}

// --- brief ---

function buildBriefPrompt(keyword, cd) {
  const c = cd || {};
  const dir = [];
  if (c.visualStyle?.name) dir.push(`visual style "${c.visualStyle.name}"`);
  if (c.colorPalette?.name) dir.push(`color palette "${c.colorPalette.name}"`);
  if (c.baseTemplate?.name) dir.push(`base template "${c.baseTemplate.name}"`);
  const dirStr = dir.length ? ` The chosen creative direction is ${dir.join(', ')}.` : '';
  return 'You are an SEO content strategist. Write a page brief for a new marketing page '
    + `targeting the keyword "${keyword}".${dirStr} The brief should cover the page purpose, `
    + 'the target audience, the key messages, and 3 to 5 content sections. '
    + 'Return ONLY JSON of the form {"title":"...","body":"..."} where body is markdown '
    + '(headings, short paragraphs, bullet lists). No prose or markdown outside the JSON.';
}

/**
 * Clean a raw brief object to `{title, body}` (trimmed strings). Pure.
 * @param {unknown} raw
 * @returns {{title: string, body: string}}
 */
export function cleanBrief(raw) {
  const o = raw && typeof raw === 'object' ? raw : {};
  return {
    title: (typeof o.title === 'string' ? o.title : '').trim(),
    body: (typeof o.body === 'string' ? o.body : '').trim(),
  };
}

/**
 * Generate a page brief for a keyword + creative direction. Never throws.
 * @param {{org: string, repo: string}} context
 * @param {string} keyword
 * @param {object} [creativeDirection]
 * @returns {Promise<{title: string, body: string, error: string|null}>}
 */
export async function generateBrief(context, keyword, creativeDirection) {
  const primary = (keyword || '').trim();
  if (!primary) return { title: '', body: '', error: null };
  try {
    const json = await getCoworker(context).askJson(buildBriefPrompt(primary, creativeDirection));
    const { title, body } = cleanBrief(json);
    return { title, body, error: body ? null : 'No brief came back. Try again.' };
  } catch (e) {
    return { title: '', body: '', error: e.message || 'Brief generation failed.' };
  }
}

// --- destination URL suggestions ---

function buildUrlsPrompt(keyword) {
  return 'You are an SEO strategist. Suggest up to 5 concise, SEO-friendly URL path slugs '
    + `for a page targeting the keyword "${keyword}". Each starts with "/" and uses lowercase `
    + 'words separated by hyphens. Return ONLY JSON of the form '
    + '{"urls":["/slug-one","/slug-two"]} with no prose or markdown.';
}

/**
 * Clean a raw urls array: normalise, de-dupe, cap. Pure.
 * @param {unknown} raw
 * @param {number} [max]
 * @returns {string[]}
 */
export function cleanUrls(raw, max = MAX_URLS) {
  const list = Array.isArray(raw) ? raw : [];
  const seen = new Set();
  const out = [];
  for (let i = 0; i < list.length && out.length < max; i += 1) {
    const item = list[i];
    const u = normalizeUrl(typeof item === 'string' ? item : item && item.url);
    if (u && !seen.has(u)) {
      seen.add(u);
      out.push(u);
    }
  }
  return out;
}

/**
 * Suggest destination URL slugs for a keyword. Never throws.
 * @param {{org: string, repo: string}} context
 * @param {string} keyword
 * @returns {Promise<{urls: string[], error: string|null}>}
 */
export async function suggestUrls(context, keyword) {
  const primary = (keyword || '').trim();
  if (!primary) return { urls: [], error: null };
  try {
    const json = await getCoworker(context).askJson(buildUrlsPrompt(primary));
    const urls = cleanUrls(json && json.urls);
    return { urls, error: urls.length ? null : 'No URL suggestions came back.' };
  } catch (e) {
    return { urls: [], error: e.message || 'URL suggestions failed.' };
  }
}

// --- links / calls-to-action ---

function buildLinksPrompt(keyword, brief) {
  const body = (brief && typeof brief === 'object' ? brief.body : brief) || '';
  const briefStr = body ? ` The page brief is:\n${String(body).slice(0, 600)}` : '';
  return 'You are a conversion strategist. Suggest up to 5 links / calls-to-action that guide a '
    + `visitor to their next step on a page targeting "${keyword}" (each a short label, a target `
    + `URL path, and a one-line description).${briefStr} Return ONLY JSON of the form `
    + '{"links":[{"label":"...","url":"/path","description":"..."}]} with no prose or markdown.';
}

/**
 * Clean a raw links array to [{label, url, description}], keeping rows with a
 * label and a valid url, de-duped by label, capped. Pure.
 * @param {unknown} raw
 * @param {number} [max]
 * @returns {Array<{label: string, url: string, description: string}>}
 */
export function cleanLinks(raw, max = MAX_LINKS) {
  const list = Array.isArray(raw) ? raw : [];
  const seen = new Set();
  const out = [];
  for (let i = 0; i < list.length && out.length < max; i += 1) {
    const item = list[i] || {};
    const label = (typeof item.label === 'string' ? item.label : '').trim();
    const url = normalizeUrl(item.url);
    const key = label.toLowerCase();
    if (label && url && !seen.has(key)) {
      seen.add(key);
      out.push({
        label,
        url,
        description: (typeof item.description === 'string' ? item.description : '').trim(),
      });
    }
  }
  return out;
}

/**
 * Suggest link / call-to-action targets for a keyword (optionally grounded in
 * the brief). Never throws.
 * @param {{org: string, repo: string}} context
 * @param {string} keyword
 * @param {object|string} [brief]
 * @returns {Promise<{links: Array, error: string|null}>}
 */
export async function suggestLinks(context, keyword, brief) {
  const primary = (keyword || '').trim();
  if (!primary) return { links: [], error: null };
  try {
    const json = await getCoworker(context).askJson(buildLinksPrompt(primary, brief));
    const links = cleanLinks(json && json.links);
    return { links, error: links.length ? null : 'No link suggestions came back.' };
  } catch (e) {
    return { links: [], error: e.message || 'Link suggestions failed.' };
  }
}
