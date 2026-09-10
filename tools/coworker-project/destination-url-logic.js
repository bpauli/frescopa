// Pure helpers for the Stage 3 Destination URL panel (ticket #34).
//
// The destination URL is either a site-relative path (starts with "/") or an
// absolute http(s) URL. Only the FORMAT is checked here, never whether the
// target is reachable. Whitespace anywhere, an empty value, or any other scheme
// (ftp:, mailto:, a bare word) is rejected.

const ABSOLUTE_RE = /^https?:\/\/\S+$/i;
const OTHER_SCHEME_RE = /^[a-z][a-z0-9+.-]*:\/\//i;

/**
 * Whether a string is a well-formed destination URL: a site-relative path that
 * starts with "/", or an absolute http(s) URL. No reachability check. Pure.
 * @param {unknown} raw
 * @returns {boolean}
 */
export function isValidDestinationUrl(raw) {
  const s = (typeof raw === 'string' ? raw : '').trim();
  if (!s || /\s/.test(s)) return false;
  if (ABSOLUTE_RE.test(s)) return true;
  return s.startsWith('/');
}

/**
 * Normalise a destination URL: trim, keep a valid absolute http(s) URL as-is,
 * and ensure a leading "/" on a site-relative path. Returns null when the value
 * is not a well-formed destination URL. Pure.
 * @param {unknown} raw
 * @returns {string|null}
 */
export function normalizeDestinationUrl(raw) {
  const s = (typeof raw === 'string' ? raw : '').trim();
  if (!s || /\s/.test(s)) return null;
  if (ABSOLUTE_RE.test(s)) return s;
  if (OTHER_SCHEME_RE.test(s)) return null;
  return s.startsWith('/') ? s : `/${s}`;
}
