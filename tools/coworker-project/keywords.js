// Keyword suggestion contract (ticket #14).
//
// Ask the Coworker (AO) `experience-workspace` agent for keywords related to a
// primary keyword, over the structured seam (coworker.js `askJson`). The JSON
// contract we own is { "suggestions": ["...", "..."] }. Responses are cleaned
// (de-duped, input dropped, capped) and failures degrade to an empty list plus
// a soft error, so a caller (the Stage 1 panel, #16) never has to try/catch.

import { getCoworker } from './coworker.js';

// Cap the returned list. The ticket asks for roughly 8-12.
const MAX = 10;

function buildPrompt(primary, max) {
  return `You are an SEO keyword research assistant. For the primary keyword "${primary}", `
    + `suggest up to ${max} closely related search keywords a marketing team could target on or `
    + 'around the same page. Exclude the primary keyword itself. Return ONLY JSON of the form '
    + '{"suggestions": ["keyword one", "keyword two"]} with no prose or markdown.';
}

/**
 * Clean a raw suggestions array from the agent: keep non-empty strings (or a
 * `{text}` shape), trim them, drop the primary keyword, de-dupe
 * case-insensitively, and cap at `max`. Pure - safe to unit test.
 * @param {unknown} raw
 * @param {string} primary
 * @param {number} [max]
 * @returns {string[]}
 */
export function cleanSuggestions(raw, primary, max = MAX) {
  const list = Array.isArray(raw) ? raw : [];
  const seen = new Set();
  const p = (primary || '').trim().toLowerCase();
  if (p) seen.add(p);
  const out = [];
  for (let i = 0; i < list.length && out.length < max; i += 1) {
    const item = list[i];
    const text = (typeof item === 'string' ? item : (item && item.text) || '').trim();
    const key = text.toLowerCase();
    if (text && !seen.has(key)) {
      seen.add(key);
      out.push(text);
    }
  }
  return out;
}

/**
 * Suggest keywords related to a primary keyword via the Coworker (AO) agent.
 * Never throws: on an empty or malformed response, or an AO error, returns an
 * empty list with a soft error string.
 * @param {{org: string, repo: string}} context
 * @param {string} keyword - the primary keyword
 * @param {{ max?: number }} [opts]
 * @returns {Promise<{ suggestions: string[], error: string|null }>}
 */
export async function suggestKeywords(context, keyword, { max = MAX } = {}) {
  const primary = (keyword || '').trim();
  if (!primary) return { suggestions: [], error: null };
  try {
    const json = await getCoworker(context).askJson(buildPrompt(primary, max));
    const suggestions = cleanSuggestions(json && json.suggestions, primary, max);
    const error = suggestions.length ? null : 'No keyword suggestions came back. Try again.';
    return { suggestions, error };
  } catch (e) {
    return { suggestions: [], error: e.message || 'Keyword suggestions failed.' };
  }
}
