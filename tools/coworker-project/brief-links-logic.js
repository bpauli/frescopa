// Pure helpers for the Stage 3 Links & Call-to-actions panel (ticket #35).
//
// The panel keeps an editable list of CTA rows ({label, url, description}). These
// helpers are the pure list + validation core so the panel stays a thin view:
// add a blank row, remove a row, patch a row, validate one target URL, and clean
// the whole list down to the rows worth persisting.

/**
 * Validate one CTA target: a site path starting with "/" or an absolute http(s)
 * URL. Blank is invalid. Pure.
 * @param {unknown} s
 * @returns {boolean}
 */
export function isValidLinkUrl(s) {
  const v = (typeof s === 'string' ? s : '').trim();
  if (!v) return false;
  if (/^https?:\/\/\S+$/i.test(v)) return true;
  return v.startsWith('/');
}

/**
 * Append a blank editable row. Returns a new array. Pure.
 * @param {Array<{label: string, url: string, description: string}>} list
 * @returns {Array<{label: string, url: string, description: string}>}
 */
export function addLink(list) {
  return [...(list || []), { label: '', url: '', description: '' }];
}

/**
 * Remove the row at `index`. Returns a new array; out-of-range leaves it
 * unchanged (a fresh copy). Pure.
 * @param {Array} list
 * @param {number} index
 * @returns {Array}
 */
export function removeLink(list, index) {
  return (list || []).filter((_, i) => i !== index);
}

/**
 * Merge `patch` onto the row at `index`. Returns a new array; other rows keep
 * their reference. Pure.
 * @param {Array} list
 * @param {number} index
 * @param {{label?: string, url?: string, description?: string}} patch
 * @returns {Array}
 */
export function updateLink(list, index, patch) {
  return (list || []).map((row, i) => (i === index ? { ...row, ...(patch || {}) } : row));
}

/**
 * Reduce the editable list to the rows worth persisting: trim every field, then
 * keep only rows with a non-empty label AND a valid target URL. Returns a new
 * array of new row objects. Pure.
 * @param {Array} list
 * @returns {Array<{label: string, url: string, description: string}>}
 */
export function cleanLinks(list) {
  return (list || [])
    .map((row) => {
      const r = row || {};
      return {
        label: (typeof r.label === 'string' ? r.label : '').trim(),
        url: (typeof r.url === 'string' ? r.url : '').trim(),
        description: (typeof r.description === 'string' ? r.description : '').trim(),
      };
    })
    .filter((r) => r.label && isValidLinkUrl(r.url));
}
