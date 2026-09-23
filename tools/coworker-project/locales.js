// Stage 6's locale catalog (ticket #76).
//
// A locale is NOT a string. The demo names locales the way a producer reads
// them - "French (France)", "Spanish (Mexico)", "Japanese (Japan)" - which are
// the BCP-47 tags `fr-FR` / `es-MX` / `ja-JP`, while the SITE serves them from
// the folders `/fr`, `/es`, `/jp` (see `paths.json`, which maps
// `/content/frescopa/fr/` -> `/fr/`). Three names for one thing, so a locale
// carries all three: `{code, label, prefix}`.
//
// The catalog is static on purpose. It is the vocabulary of the Page
// Localization Selection panel's Search box, and a static module is one import
// with no network, no AO turn and no failure mode. The site's own three come
// first so the locales this site can actually serve are the first things the
// producer sees.
//
// The default locale is `en-US` with an EMPTY prefix: the site's root IS
// English (`/content/frescopa/en/` -> `/`), and the Stage 4 page is written in
// English at the root path. So the default locale's "localized page" is the
// Stage 4 page itself - Stage 6 never translates it, and `localePath` returns
// the source path unchanged for it.
//
// Everything here is pure: no DOM, no fetch, no state.

/**
 * The default locale's code: the language the Stage 4 page is generated in, and
 * the one the star renders in the selection panel. Re-basing the default (e.g.
 * translating everything from French) is out of scope for Stage 6 - see map #73.
 */
export const DEFAULT_LOCALE_CODE = 'en-US';

/**
 * The catalog. `prefix` is the site path segment the locale is served from,
 * WITHOUT a trailing slash; `''` means the site root.
 *
 * The first four are this site's own, from `paths.json`. Note `ja-JP` -> `/jp`:
 * the folder is the country, not the language, which is exactly why the prefix
 * cannot be derived from the code.
 */
export const LOCALES = [
  { code: 'en-US', label: 'English (United States)', prefix: '' },
  { code: 'fr-FR', label: 'French (France)', prefix: '/fr' },
  { code: 'es-MX', label: 'Spanish (Mexico)', prefix: '/es' },
  { code: 'ja-JP', label: 'Japanese (Japan)', prefix: '/jp' },
  { code: 'de-DE', label: 'German (Germany)', prefix: '/de' },
  { code: 'it-IT', label: 'Italian (Italy)', prefix: '/it' },
  { code: 'pt-BR', label: 'Portuguese (Brazil)', prefix: '/br' },
  { code: 'nl-NL', label: 'Dutch (Netherlands)', prefix: '/nl' },
  { code: 'sv-SE', label: 'Swedish (Sweden)', prefix: '/se' },
  { code: 'da-DK', label: 'Danish (Denmark)', prefix: '/dk' },
  { code: 'fi-FI', label: 'Finnish (Finland)', prefix: '/fi' },
  { code: 'nb-NO', label: 'Norwegian (Norway)', prefix: '/no' },
  { code: 'pl-PL', label: 'Polish (Poland)', prefix: '/pl' },
  { code: 'cs-CZ', label: 'Czech (Czechia)', prefix: '/cz' },
  { code: 'tr-TR', label: 'Turkish (Turkey)', prefix: '/tr' },
  { code: 'ru-RU', label: 'Russian (Russia)', prefix: '/ru' },
  { code: 'ar-AE', label: 'Arabic (United Arab Emirates)', prefix: '/ae' },
  { code: 'he-IL', label: 'Hebrew (Israel)', prefix: '/il' },
  { code: 'hi-IN', label: 'Hindi (India)', prefix: '/in' },
  { code: 'ko-KR', label: 'Korean (South Korea)', prefix: '/kr' },
  { code: 'zh-CN', label: 'Chinese (China)', prefix: '/cn' },
  { code: 'zh-TW', label: 'Chinese (Taiwan)', prefix: '/tw' },
];

const str = (v) => (typeof v === 'string' ? v.trim() : '');

/**
 * Whether a locale is the default one - the language the Stage 4 page is
 * already written in. Takes a code or a locale record. Pure.
 * @param {string|{code?: string}} locale
 * @returns {boolean}
 */
export function isDefaultLocale(locale) {
  const code = typeof locale === 'string' ? locale : locale?.code;
  return str(code).toLowerCase() === DEFAULT_LOCALE_CODE.toLowerCase();
}

/**
 * The catalog entry for a code, or `null`. Case-insensitive, because a stored
 * record and a hand-typed code do not have to agree on case. Pure.
 * @param {string} code e.g. "ja-JP"
 * @returns {{code: string, label: string, prefix: string}|null}
 */
export function findLocale(code) {
  const wanted = str(code).toLowerCase();
  if (!wanted) return null;
  return LOCALES.find((l) => l.code.toLowerCase() === wanted) ?? null;
}

/**
 * The default locale record. Pure.
 * @returns {{code: string, label: string, prefix: string}}
 */
export function defaultLocale() {
  return findLocale(DEFAULT_LOCALE_CODE);
}

/**
 * The Search box's rule: match a query against a locale's label OR its code, in
 * catalog order (so the site's own locales lead), with the locales already
 * selected filtered out - a producer cannot add the same locale twice.
 *
 * An empty query returns everything still addable, which is what an
 * unfocused/empty search field should list. Matching is a case-insensitive
 * substring, so "fr" finds both "French (France)" and "fr-FR", and "japan"
 * finds "Japanese (Japan)". Pure.
 *
 * @param {string} query
 * @param {Array<string|{code?: string}>} [selected] codes or rows already chosen
 * @returns {Array<{code: string, label: string, prefix: string}>}
 */
export function searchLocales(query, selected = []) {
  const taken = new Set(
    (Array.isArray(selected) ? selected : [])
      .map((s) => (typeof s === 'string' ? s : s?.code))
      .map((c) => str(c).toLowerCase())
      .filter(Boolean),
  );
  const q = str(query).toLowerCase();
  return LOCALES.filter((l) => {
    if (taken.has(l.code.toLowerCase())) return false;
    if (!q) return true;
    return l.label.toLowerCase().includes(q) || l.code.toLowerCase().includes(q);
  });
}

/**
 * Where a locale's page lives: the site's locale prefix in front of the Stage 4
 * page path. `/drafts/x` under `/fr` is `/fr/drafts/x`.
 *
 * The default locale has an empty prefix, so it returns the source path
 * unchanged - the default locale's page IS the Stage 4 page, never a copy.
 *
 * Takes a prefix or a whole locale record, so a caller holding a row does not
 * have to unpack it. A path that is already under the prefix is returned
 * unchanged rather than doubled (`/fr/fr/drafts/x` is nobody's intent). Pure.
 *
 * @param {string|{prefix?: string}} locale the prefix, or a locale record
 * @param {string} pagePath extensionless, leading-slash page path
 * @returns {string} the localized path, or '' when there is no page path
 */
export function localePath(locale, pagePath) {
  const raw = typeof locale === 'string' ? locale : locale?.prefix;
  const path = str(pagePath);
  if (!path) return '';
  const base = path.startsWith('/') ? path : `/${path}`;
  let prefix = str(raw);
  if (!prefix) return base;
  if (!prefix.startsWith('/')) prefix = `/${prefix}`;
  prefix = prefix.replace(/\/+$/, '');
  if (base === prefix || base.startsWith(`${prefix}/`)) return base;
  return `${prefix}${base}`;
}
