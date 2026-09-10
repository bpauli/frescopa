// Pure helpers for the Stage 2 Base Template picker (ticket #24).

/**
 * Shape the raw template list (from fetchTemplates: {name, url}) into the
 * persisted selection form {name, url, recommended}, tagging the AO-recommended
 * one by a case-insensitive name match. Drops nameless rows. Pure.
 * @param {Array<{name: string, url: string}>} templates
 * @param {string} [recommendedName]
 * @returns {Array<{name: string, url: string, recommended: boolean}>}
 */
export function withRecommended(templates, recommendedName) {
  const rec = (recommendedName || '').trim().toLowerCase();
  return (templates || [])
    .filter((t) => t && typeof t.name === 'string' && t.name.trim())
    .map((t) => ({
      name: t.name,
      url: t.url || '',
      recommended: !!rec && t.name.trim().toLowerCase() === rec,
    }));
}
