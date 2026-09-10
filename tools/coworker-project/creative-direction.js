// Creative-direction contracts for Stage 2 (ticket #23).
//
// Two seams over the structured Coworker (AO) client (coworker.js `askJson`),
// kept separate so a failure in one does not blank the other:
//   suggestCreativeDirection - visual styles + color palettes for the assets.
//   recommendTemplate        - a best-effort "which base template fits" badge.
// Both own the JSON contract, clean the response, and degrade to an empty
// result plus a soft error, so the Stage 2 panels (#24/#25/#26) never try/catch.

import { getCoworker } from './coworker.js';

// Caps to keep the prompt + UI bounded. The demo showed four of each.
const MAX_STYLES = 6;
const MAX_PALETTES = 6;
const MAX_COLORS = 6;

// --- visual styles + color palettes ---

function buildSuggestPrompt(keyword, maxStyles, maxPalettes) {
  return 'You are a creative director choosing the look and feel for a new SEO landing page '
    + `targeting the keyword "${keyword}". Propose up to ${maxStyles} distinct visual styles `
    + `(each a short name and a one-sentence description) and up to ${maxPalettes} color palettes `
    + '(each a short name, a one-sentence description, and 3 to 5 hex color codes). '
    + 'Return ONLY JSON of the form {"visualStyles":[{"name":"...","description":"..."}],'
    + '"colorPalettes":[{"name":"...","description":"...","colors":["#RRGGBB"]}]} '
    + 'with no prose or markdown.';
}

// Normalise one hex color to "#rrggbb"/"#rgb" lowercase, or null when invalid.
function normalizeHex(raw) {
  const s = (typeof raw === 'string' ? raw : '').trim().replace(/^#/, '');
  if (!/^[0-9a-f]{3}$|^[0-9a-f]{6}$/i.test(s)) return null;
  return `#${s.toLowerCase()}`;
}

/**
 * Clean a raw colors array: keep valid hex codes, normalise, de-dupe, cap.
 * Pure - safe to unit test.
 * @param {unknown} raw
 * @param {number} [max]
 * @returns {string[]}
 */
export function cleanHexColors(raw, max = MAX_COLORS) {
  const list = Array.isArray(raw) ? raw : [];
  const seen = new Set();
  const out = [];
  for (let i = 0; i < list.length && out.length < max; i += 1) {
    const hex = normalizeHex(list[i]);
    if (hex && !seen.has(hex)) {
      seen.add(hex);
      out.push(hex);
    }
  }
  return out;
}

// Keep rows with a non-empty string name, trim, de-dupe by name (case-insensitive),
// cap. `mapRow` shapes each surviving row.
function cleanNamed(raw, max, mapRow) {
  const list = Array.isArray(raw) ? raw : [];
  const seen = new Set();
  const out = [];
  for (let i = 0; i < list.length && out.length < max; i += 1) {
    const item = list[i] || {};
    const name = (typeof item.name === 'string' ? item.name : '').trim();
    const key = name.toLowerCase();
    if (name && !seen.has(key)) {
      const row = mapRow(item, name);
      if (row) {
        seen.add(key);
        out.push(row);
      }
    }
  }
  return out;
}

/**
 * Clean a raw visualStyles array to [{name, description}]. Pure.
 * @param {unknown} raw
 * @param {number} [max]
 * @returns {Array<{name: string, description: string}>}
 */
export function cleanStyles(raw, max = MAX_STYLES) {
  return cleanNamed(raw, max, (item, name) => ({
    name,
    description: (typeof item.description === 'string' ? item.description : '').trim(),
  }));
}

/**
 * Clean a raw colorPalettes array to [{name, description, colors}], dropping any
 * palette left with no valid colors. Pure.
 * @param {unknown} raw
 * @param {number} [max]
 * @returns {Array<{name: string, description: string, colors: string[]}>}
 */
export function cleanPalettes(raw, max = MAX_PALETTES) {
  return cleanNamed(raw, max, (item, name) => {
    const colors = cleanHexColors(item.colors);
    if (!colors.length) return null;
    return {
      name,
      description: (typeof item.description === 'string' ? item.description : '').trim(),
      colors,
    };
  });
}

/**
 * Suggest visual styles and color palettes for a keyword via the Coworker (AO)
 * agent. Never throws: an empty/malformed response or an AO error degrades to
 * empty lists plus a soft error.
 * @param {{org: string, repo: string}} context
 * @param {string} keyword - the Stage 1 primary keyword
 * @returns {Promise<{visualStyles: Array, colorPalettes: Array, error: string|null}>}
 */
export async function suggestCreativeDirection(context, keyword) {
  const primary = (keyword || '').trim();
  if (!primary) return { visualStyles: [], colorPalettes: [], error: null };
  try {
    const prompt = buildSuggestPrompt(primary, MAX_STYLES, MAX_PALETTES);
    const json = await getCoworker(context).askJson(prompt);
    const visualStyles = cleanStyles(json && json.visualStyles);
    const colorPalettes = cleanPalettes(json && json.colorPalettes);
    const error = (visualStyles.length || colorPalettes.length)
      ? null : 'No creative direction came back. Try again.';
    return { visualStyles, colorPalettes, error };
  } catch (e) {
    return {
      visualStyles: [], colorPalettes: [], error: e.message || 'Creative direction failed.',
    };
  }
}

// --- base template recommendation (best-effort badge) ---

function buildRecommendPrompt(keyword, names) {
  const list = names.map((n, i) => `${i + 1}. ${n}`).join('\n');
  return 'You are choosing the best base page template for a new SEO landing page '
    + `targeting the keyword "${keyword}". Available templates:\n${list}\n\n`
    + 'Pick the single best fit by its exact name. Return ONLY JSON of the form '
    + '{"recommended":"<exact template name>"} with no prose or markdown.';
}

/**
 * Resolve the agent's raw pick to one of the provided template names
 * (case-insensitive exact match), or null when it matches none. Pure.
 * @param {unknown} raw - the agent's "recommended" value
 * @param {string[]} names
 * @returns {string|null}
 */
export function pickRecommended(raw, names) {
  const pick = (typeof raw === 'string' ? raw : '').trim().toLowerCase();
  if (!pick) return null;
  return (names || []).find((n) => (n || '').trim().toLowerCase() === pick) || null;
}

/**
 * Ask the Coworker (AO) agent which of the site's base templates best fits the
 * keyword. Best-effort: never throws, and returns null when there is nothing to
 * pick from, the response is unusable, or AO errors - so the picker (#24) still
 * works with no badge.
 * @param {{org: string, repo: string}} context
 * @param {string} keyword
 * @param {string[]} templateNames - the real template names (from fetchTemplates)
 * @returns {Promise<{recommended: string|null, error: string|null}>}
 */
export async function recommendTemplate(context, keyword, templateNames) {
  const primary = (keyword || '').trim();
  const names = (templateNames || []).filter((n) => typeof n === 'string' && n.trim());
  if (!primary || !names.length) return { recommended: null, error: null };
  try {
    const json = await getCoworker(context).askJson(buildRecommendPrompt(primary, names));
    return { recommended: pickRecommended(json && json.recommended, names), error: null };
  } catch (e) {
    return { recommended: null, error: e.message || 'Template recommendation failed.' };
  }
}
