// Keyword cannibalization contract (ticket #15).
//
// Ask the Coworker (AO) `experience-workspace` agent which existing site pages
// compete with a target keyword, over the structured seam (coworker.js
// `askJson`). The JSON contract we own is
//   { "competitors": [{ "url", "title", "overlap": "high"|"low", "reason" }] }.
// Results are cleaned (valid rows, normalized overlap, de-duped by url) and
// failures degrade to an empty list plus a soft error. The producer supplies
// the page inventory (pages.js); the Stage 1 panel (#17) adds flagged/ignored
// status on top of this raw analysis.

import { getCoworker } from './coworker.js';
import { fetchPageInventory } from './pages.js';

// Cap how many pages go into the prompt, to keep it bounded.
const MAX_PAGES = 60;

function buildPrompt(keyword, pages) {
  const list = pages
    .map((p, i) => {
      const meta = [p.title || p.url, p.url, p.description].filter(Boolean).join(' - ');
      return `${i + 1}. ${meta}`;
    })
    .join('\n');
  return 'You are an SEO cannibalization analyst. The team is about to publish a new page '
    + `targeting the keyword "${keyword}". Below is the existing page inventory for this site. `
    + 'Identify which existing pages compete for that keyword and could split rankings '
    + '(cannibalization). Include only pages with real keyword overlap; omit clearly unrelated '
    + 'pages. Mark "overlap":"high" for strong competition and "low" for minor overlap.\n\n'
    + `Pages:\n${list}\n\n`
    + 'Return ONLY JSON of the form '
    + '{"competitors":[{"url":"...","title":"...","overlap":"high","reason":"..."}]} '
    + 'with no prose or markdown.';
}

/**
 * Clean a raw competitors array from the agent: keep rows with a string url,
 * normalize `overlap` to "high"|"low" (default "low"), fill title from the
 * inventory when missing, de-dupe by url. Pure - safe to unit test.
 * @param {unknown} raw
 * @param {Array<{url, title}>} [inventory]
 * @returns {Array<{url, title, overlap, reason}>}
 */
export function cleanCompetitors(raw, inventory = []) {
  const list = Array.isArray(raw) ? raw : [];
  const titleByUrl = new Map((inventory || []).map((p) => [p.url, p.title]));
  const seen = new Set();
  const out = [];
  for (let i = 0; i < list.length; i += 1) {
    const c = list[i] || {};
    const url = (typeof c.url === 'string' ? c.url : '').trim();
    if (url && !seen.has(url)) {
      seen.add(url);
      out.push({
        url,
        title: (typeof c.title === 'string' && c.title.trim()) || titleByUrl.get(url) || '',
        overlap: c.overlap === 'high' ? 'high' : 'low',
        reason: typeof c.reason === 'string' ? c.reason : '',
      });
    }
  }
  return out;
}

/**
 * Run the cannibalization check for a keyword against the site's pages. Never
 * throws: an empty inventory, malformed response, or AO error degrades to an
 * empty competitor list with a soft error.
 * @param {{org: string, repo: string}} context
 * @param {(url: string, opts?: object) => Promise<Response>} daFetch
 * @param {string} keyword
 * @returns {Promise<{ competitors: Array, checkedAt: string, error: string|null }>}
 */
export async function checkCannibalization(context, daFetch, keyword) {
  const checkedAt = new Date().toISOString();
  const primary = (keyword || '').trim();
  if (!primary) return { competitors: [], checkedAt, error: null };

  const inventory = await fetchPageInventory(context, daFetch);
  if (!inventory.length) {
    return { competitors: [], checkedAt, error: 'No site pages found to check against.' };
  }

  try {
    const prompt = buildPrompt(primary, inventory.slice(0, MAX_PAGES));
    const json = await getCoworker(context).askJson(prompt);
    const competitors = cleanCompetitors(json && json.competitors, inventory);
    return { competitors, checkedAt, error: null };
  } catch (e) {
    return { competitors: [], checkedAt, error: e.message || 'Cannibalization check failed.' };
  }
}
