// Pure helpers for the Stage 2 Visual Style panel (ticket #25).

/**
 * Build the persisted selection for a suggested style. Pure.
 * @param {{name: string, description?: string}} style
 * @returns {{name: string, description: string, source: 'suggested'}}
 */
export function suggestedStyle(style) {
  return {
    name: (style?.name || '').trim(),
    description: (style?.description || '').trim(),
    source: 'suggested',
  };
}

/**
 * Build the persisted selection for a free-text custom style, or null when the
 * text is blank. The text is the style's identity (name); description stays
 * empty. Pure.
 * @param {string} text
 * @returns {{name: string, description: string, source: 'custom'}|null}
 */
export function customStyle(text) {
  const name = (text || '').trim();
  if (!name) return null;
  return { name, description: '', source: 'custom' };
}

/**
 * Whether the current selection is the given suggested style (by name, when the
 * selection's source is "suggested"). Drives the active-card highlight. Pure.
 * @param {{name?: string, source?: string}} selection
 * @param {{name?: string}} style
 * @returns {boolean}
 */
export function isSuggestedSelected(selection, style) {
  if (!selection || selection.source !== 'suggested') return false;
  return (selection.name || '').trim().toLowerCase() === (style?.name || '').trim().toLowerCase();
}
