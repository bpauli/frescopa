// Pure helpers for the Stage 2 Color Palette panel (ticket #26).
//
// Custom-palette hex-entry UX (fog sharpened here): the producer builds a
// palette by adding hex colors one at a time (a native color picker assists, a
// hex text field is validated), shown as removable swatch chips, capped at
// MAX_CUSTOM_COLORS. A suggested palette carries the AO colors as-is.

export const MAX_CUSTOM_COLORS = 8;

/**
 * Validate + normalise one hex color to "#rrggbb"/"#rgb" lowercase, or null when
 * invalid. Accepts an optional leading "#" and any case. Pure.
 * @param {unknown} raw
 * @returns {string|null}
 */
export function normalizeHexColor(raw) {
  const s = (typeof raw === 'string' ? raw : '').trim().replace(/^#/, '');
  if (!/^[0-9a-f]{3}$|^[0-9a-f]{6}$/i.test(s)) return null;
  return `#${s.toLowerCase()}`;
}

/**
 * Append a color to a custom list: normalise, then add only when valid, not
 * already present, and under the cap. Returns the same array reference when
 * nothing changes, so callers can detect a no-op. Pure.
 * @param {string[]} colors
 * @param {string} raw
 * @param {number} [max]
 * @returns {string[]}
 */
export function addColor(colors, raw, max = MAX_CUSTOM_COLORS) {
  const list = colors || [];
  const hex = normalizeHexColor(raw);
  if (!hex || list.includes(hex) || list.length >= max) return list;
  return [...list, hex];
}

/**
 * Remove a color from a custom list (exact, after normalising the target). Pure.
 * @param {string[]} colors
 * @param {string} hex
 * @returns {string[]}
 */
export function removeColor(colors, hex) {
  const target = normalizeHexColor(hex);
  return (colors || []).filter((c) => c !== target);
}

/**
 * Build the persisted selection for a suggested palette. Pure.
 * @param {{name?: string, description?: string, colors?: string[]}} palette
 * @returns {{name: string, description: string, colors: string[], source: 'suggested'}}
 */
export function suggestedPalette(palette) {
  return {
    name: (palette?.name || '').trim(),
    description: (palette?.description || '').trim(),
    colors: [...(palette?.colors || [])],
    source: 'suggested',
  };
}

/**
 * Build the persisted selection for a custom palette, or null when it has no
 * colors. Name defaults to "Custom". Pure.
 * @param {string} name
 * @param {string[]} colors
 * @returns {{name: string, description: string, colors: string[], source: 'custom'}|null}
 */
export function customPalette(name, colors) {
  const list = colors || [];
  if (!list.length) return null;
  return {
    name: (name || '').trim() || 'Custom',
    description: '',
    colors: [...list],
    source: 'custom',
  };
}

/**
 * Whether the current selection is the given suggested palette (by name, when
 * the selection's source is "suggested"). Pure.
 * @param {{name?: string, source?: string}} selection
 * @param {{name?: string}} palette
 * @returns {boolean}
 */
export function isSuggestedSelected(selection, palette) {
  if (!selection || selection.source !== 'suggested') return false;
  return (selection.name || '').trim().toLowerCase() === (palette?.name || '').trim().toLowerCase();
}
