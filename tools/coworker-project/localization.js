// Stage 6 localization contract (ticket #77).
//
// The seam that produces ONE localized page: the sibling of
// `page-generation.js` (#41) and `asset-generation.js` (#59), and like them it
// never throws - every failure degrades to a soft error the panel (#79) can
// render, and the locale row keeps its `error`.
//
//   1. `readPageDoc`        - the English doc from DA. The DOC is the source of
//                             truth, exactly as it is for Stage 5's slots.
//   2. `translateDoc`       - ONE AO turn under the structure-preserving
//                             contract: text nodes and `alt` only.
//   3. `verifyTranslation`  - the shape check, BEFORE anything is written.
//   4. `writePageDoc`       - to `localePath(locale, page.path)`, envelope
//                             intact, then `previewPage` ONCE.
//   5. `buildLocaleRow`     - the `locales` sheet row (#76) the panel renders.
//
// Everything below is gate-proven, not guessed: gate #74 ran nine real AO turns
// on this site and its report settles the facts this file encodes.
//
// --- What the gate proved ---
//
//   - AO PRESERVES the markup. On every real doc the ordered list of
//     `(tag, attributes-except-alt)` came back identical - 606 tag events on
//     the site's own 13.5 KB `/index`, every class string, every block-config
//     value, and every `#width=&height=` fragment character for character.
//     The map's "AO might reflow the blocks" risk is not the real risk.
//   - The reply is a BARE `<body>` envelope: no prose, no code fence, on all
//     nine turns. So this uses `ask`, not `askJson`, and the reply is posted
//     as-is - `replaceHtml` wraps INNER markup and would nest a second
//     `<body>`. `writePageDoc`'s `ensurePageEnvelope` already leaves it alone.
//   - A turn costs ~25 s fixed plus ~4.5 s per KB, so the real `/index` took
//     80 s. The 60 s `ask` default is NOT survivable (the #57 lesson again):
//     `LOCALIZE_TIMEOUT_MS` is pinned at 300 000 ms.
//   - The REAL risk is silent corruption on a long doc: at 27 KB one run put a
//     space inside a media hash (one bad URL out of 130, everything else
//     identical) and at 54 KB a well-formed reply had quietly dropped a quarter
//     of the content. Both were written and previewed with `201`/`200` and no
//     warning anywhere. Hence VERIFY, DO NOT TRUST: `verifyTranslation` runs
//     before the write, the turn is retried once on a mismatch, and a doc that
//     fails the check is a failure, never a page.
//   - Images are free. The localized doc keeps Stage 5's `content.da.live`
//     URLs and ingests to the SAME media hashes - no re-ingestion, no second
//     Firefly spend - which is precisely why the `src` list must survive.
//   - DA needs no folder pre-creation: a write into a never-seen `/fr/...`
//     chain answers 201 and its preview answers 200.
//
// --- Site chrome: applied here, not deferred (the gate's open captain call) ---
//
// `blocks/header/header.js` and `blocks/footer/footer.js` prefix the nav/footer
// fragment path with the locale root for `es|fr|jp|de`, so a page at `/fr/...`
// loads `/fr/nav` and `/fr/footer`. Before the gate created them, neither
// existed and the localized page rendered its `<main>` perfectly and its chrome
// not at all. `ensureLocaleChrome` closes that hole: the first page of such a
// locale translates `/nav` and `/footer` through the SAME contract, once, and
// every later page in that locale finds them already there. A locale outside
// those four is served the site's root (English) chrome by that same site code,
// so there is nothing to create for it.
//
// Two residual chrome facts are deliberately NOT this ticket's:
//   - the `lang` attribute stays `en` (`scripts/scripts.js` hardcodes it) -
//     that is ticket #81, a site-code change, not a per-page write;
//   - the authored `/nav` uses hrefs WITHOUT a leading slash, so a localized
//     nav inherits locale-blind links. AO reproduces them faithfully; the
//     defect is in the source nav. Rewriting them is an authoring concern of
//     the locale's own nav doc, one write per locale, not per page - deferred
//     to ticket #83.
//
// See `docs/adr/0004-stage6-creates-locale-chrome.md` for the whole decision.

import { getCoworker } from './coworker.js';
import { readPageDoc } from './asset-generation.js';
import { derivePagePath, pageUrls } from './page-generation.js';
// The write + preview pair Stage 5 proved. Stage 4 has its own private copies
// that THROW; these two are the exported, never-throws versions, which is what
// a soft-error contract needs - so they are imported, not reimplemented.
import { previewPage, writePageDoc } from './asset-swap.js';
import { findLocale, isDefaultLocale, localePath } from './locales.js';

/**
 * The AO timeout for one localization turn. A turn costs ~25 s + ~4.5 s per KB
 * and the site's real `/index` took 80 s, so the 60 s `ask` default would abort
 * a healthy turn (gate #74, the #57 lesson).
 */
export const LOCALIZE_TIMEOUT_MS = 300000;

const GENERATED = 'Generated';
const FAILED = 'Failed';

/**
 * The locale roots `blocks/header/header.js` and `blocks/footer/footer.js`
 * prefix the nav/footer fragment path with. A page under one of these needs the
 * locale's own chrome docs to exist; a page under any other prefix is served
 * the site's root chrome. KEEP IN STEP with those two blocks: a locale added
 * there needs adding here, or its pages render with an empty header and footer.
 */
export const CHROME_LOCALE_ROOTS = ['es', 'fr', 'jp', 'de'];

/** The site chrome fragments a locale root needs, at their root paths. */
export const CHROME_DOCS = ['/nav', '/footer'];

const str = (v) => (typeof v === 'string' ? v.trim() : '');

const message = (e) => str(e?.message) || 'unknown error';

// --- the locale ---

/**
 * The locale record to work with: a catalog entry for a code or a partial
 * record, falling back to the fields the caller supplied for a locale the
 * catalog does not carry. Answers `null` when there is no code at all. Pure.
 * @param {string|{code?: string, label?: string, prefix?: string}} locale
 * @returns {{code: string, label: string, prefix: string}|null}
 */
export function resolveLocale(locale) {
  const code = str(typeof locale === 'string' ? locale : locale?.code);
  if (!code) return null;
  const known = findLocale(code);
  if (known) return { ...known };
  const given = typeof locale === 'string' ? {} : (locale || {});
  return { code, label: str(given.label) || code, prefix: str(given.prefix) };
}

/**
 * One `locales` sheet row (#76) - the shape the Selection panel (#78) and the
 * Locale View (#79) read. The row shape belongs to `locales.js`'s sheet
 * contract; this only fills it in. Pure.
 * @param {{code: string, label: string, prefix: string}} locale
 * @param {{status?: string, path?: string, previewUrl?: string,
 *   editUrl?: string, generatedAt?: string, error?: string|null}} [fields]
 * @returns {{code: string, label: string, prefix: string, isDefault: boolean,
 *   status: string, path: string, previewUrl: string, editUrl: string,
 *   generatedAt: string, error: string|null}}
 */
export function buildLocaleRow(locale, fields = {}) {
  const l = locale || {};
  return {
    code: str(l.code),
    label: str(l.label),
    prefix: str(l.prefix),
    isDefault: isDefaultLocale(l.code),
    status: str(fields.status) || FAILED,
    path: str(fields.path),
    previewUrl: str(fields.previewUrl),
    editUrl: str(fields.editUrl),
    generatedAt: str(fields.generatedAt) || new Date().toISOString(),
    error: fields.error ?? null,
  };
}

// --- the AO contract ---

/**
 * The structure-preserving translation prompt - the exact instruction gate #74
 * ran, with the target language filled in. It worked first time on every one of
 * nine docs, so the wording is treated as proven rather than restyled. Pure.
 * @param {string} html - the whole source doc, verbatim
 * @param {{code: string, label: string}} locale
 * @returns {string}
 */
export function buildLocalizePrompt(html, locale) {
  const l = locale || {};
  const target = `${str(l.label) || str(l.code)} (${str(l.code)})`;
  return 'You are localizing an Adobe Edge Delivery Services (Document Authoring) page '
    + `document from English to ${target}.\n\n`
    + 'Return the COMPLETE localized HTML document and NOTHING else: no prose, no '
    + 'explanation, no markdown code fence.\n\n'
    + 'Rules - follow them exactly:\n'
    + '1. Translate ONLY human-readable text nodes and the value of `alt` attributes.\n'
    + '2. Every tag must come back byte-identical, in the same order and the same nesting: '
    + 'body, header, main, div, picture, source, img, p, h1-h6, table, tr, td, a, footer.\n'
    + '3. Every attribute other than `alt` must come back byte-identical: class, src, srcset, '
    + 'href, media, loading, colspan, width, height. Do NOT re-encode, re-order, shorten or '
    + '"fix" any URL. The `#width=...&height=...` fragment on every image URL must survive '
    + 'character for character.\n'
    + '4. Do NOT translate: class names, block names (the first row of a block table), the '
    + 'keys of a metadata or section-metadata table (Title, Description, Style, Template, '
    + 'Image, ...), style tokens, URLs or file names. Inside a metadata or section-metadata '
    + 'table translate ONLY the values of the rows whose key is Title, Description or '
    + 'Keywords; leave every other row byte-identical.\n'
    + '5. Do not add, remove, merge or reorder any element. Do not add or remove whitespace, '
    + 'newlines or indentation. Do not add a DOCTYPE, an <html> or a <head> element.\n'
    + '6. Keep the leading and trailing whitespace of the document exactly as it is.\n\n'
    + `Here is the document:\n\n${html}`;
}

/**
 * The document out of an AO reply. The gate saw a bare `<body>` envelope on
 * every turn, so this only has to survive the day one does not: a markdown
 * fence is unwrapped and anything outside the outermost `<body>` is dropped,
 * because a reply that carries an apology in front of the doc would otherwise
 * be written to DA as page content. Answers '' when there is no document. Pure.
 * @param {string} text - the raw assistant reply
 * @returns {string}
 */
export function extractDoc(text) {
  const raw = typeof text === 'string' ? text : '';
  const fence = raw.match(/```(?:html)?\s*([\s\S]*?)```/i);
  const body = (fence ? fence[1] : raw).trim();
  const open = body.search(/<body[\s>]/i);
  if (open === -1) return '';
  const close = body.toLowerCase().lastIndexOf('</body>');
  if (close === -1 || close < open) return '';
  return body.slice(open, close + '</body>'.length);
}

// --- verify before write ---

const DIV_TAG_RE = /<div\b[^>]*>/gi;
const SRC_ATTR_RE = /\bsrc(?:set)?\s*=\s*(?:"([^"]*)"|'([^']*)')/gi;

/**
 * How many blocks a doc carries: every `<div>` in it. An EDS doc is `<div>`s -
 * one per section, one per block, one per block row and cell - so this number
 * moves the moment content is dropped, merged or invented, and it does not move
 * when text is translated. Pure.
 * @param {string} html
 * @returns {number}
 */
export function countBlocks(html) {
  return (String(html ?? '').match(DIV_TAG_RE) || []).length;
}

/**
 * Every `src` and `srcset` value in a doc, in document order. These are the
 * opaque strings a translation must not touch: the Stage 5 `content.da.live`
 * asset URLs whose media hash decides whether the image resolves at all, plus
 * the `#width=&height=` fragment that carries the rendered `width`/`height`
 * (dropping it is the CLS regression #60 fixed). Pure.
 * @param {string} html
 * @returns {string[]}
 */
export function extractSrcs(html) {
  const doc = String(html ?? '');
  const out = [];
  let m = SRC_ATTR_RE.exec(doc);
  while (m) {
    out.push(m[1] ?? m[2] ?? '');
    m = SRC_ATTR_RE.exec(doc);
  }
  SRC_ATTR_RE.lastIndex = 0;
  return out;
}

/**
 * THE check that stands between AO and a locale path: a translated doc must
 * carry the same block count and the same `src` values, in the same order, as
 * the doc it came from. `alt` and text content are expected to differ; nothing
 * else may.
 *
 * It is deliberately two signals rather than the gate's full tag skeleton,
 * because those two are the ones that caught the real corruption: the 54 KB doc
 * that quietly lost a quarter of its content moves the block count, and the
 * 27 KB doc with a space inside a media hash moves the `src` list. A doc that
 * fails this is a failure, not a page. Pure.
 * @param {string} source - the doc read from DA
 * @param {string} translated - the doc AO returned
 * @returns {{ok: boolean, error: string|null}}
 */
export function verifyTranslation(source, translated) {
  if (!str(translated)) return { ok: false, error: 'The translation came back empty.' };

  const before = countBlocks(source);
  const after = countBlocks(translated);
  if (before !== after) {
    return {
      ok: false,
      error: `The translation changed the page structure: ${after} blocks instead of ${before}.`,
    };
  }

  const srcBefore = extractSrcs(source);
  const srcAfter = extractSrcs(translated);
  if (srcBefore.length !== srcAfter.length) {
    return {
      ok: false,
      error: `The translation changed the images: ${srcAfter.length} instead of ${srcBefore.length}.`,
    };
  }
  const changed = srcBefore.findIndex((src, i) => src !== srcAfter[i]);
  if (changed !== -1) {
    return { ok: false, error: `The translation altered an image URL: "${srcAfter[changed]}".` };
  }
  return { ok: true, error: null };
}

// --- one translated document ---

/**
 * Translate one doc in ONE AO turn and verify it before handing it back. On a
 * verification mismatch the turn is retried once - the gate's 27 KB corruption
 * was non-deterministic and the rerun of the very same doc was perfect - and a
 * second mismatch is a soft error, never a written page. Never throws.
 * @param {{org: string, repo: string}} context
 * @param {string} html - the source doc
 * @param {{code: string, label: string}} locale
 * @returns {Promise<{html: string, error: string|null}>}
 */
export async function translateDoc(context, html, locale) {
  const source = typeof html === 'string' ? html : '';
  if (!str(source)) return { html: '', error: 'There is no page to localize.' };
  if (!context?.org || !context?.repo) return { html: '', error: 'Missing Coworker context.' };

  const prompt = buildLocalizePrompt(source, locale);
  let last = 'The translation could not be verified.';
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      // eslint-disable-next-line no-await-in-loop
      const reply = await getCoworker(context).ask(prompt, { timeoutMs: LOCALIZE_TIMEOUT_MS });
      const doc = extractDoc(reply);
      const { ok, error } = verifyTranslation(source, doc);
      if (ok) return { html: doc, error: null };
      last = error;
    } catch (e) {
      return { html: '', error: `The translation failed: ${message(e)}` };
    }
  }
  return { html: '', error: last };
}

/**
 * Read a doc from DA, translate it, and write the result to the locale's path,
 * then preview it once. The one step both a page and a chrome fragment take.
 * Never throws.
 * @param {{org: string, repo: string}} context
 * @param {(url: string, opts?: object) => Promise<Response>} daFetch
 * @param {{sourcePath: string, targetPath: string,
 *   locale: {code: string, label: string, prefix: string}}} options
 * @returns {Promise<{ok: boolean, error: string|null}>}
 */
export async function localizeDoc(context, daFetch, { sourcePath, targetPath, locale } = {}) {
  const { org, repo: site } = context || {};
  if (!org || !site || typeof daFetch !== 'function') return { ok: false, error: 'Missing DA context.' };
  if (!str(sourcePath) || !str(targetPath)) return { ok: false, error: 'Missing page path.' };

  const { html, error: readError } = await readPageDoc(daFetch, org, site, sourcePath);
  if (!str(html)) return { ok: false, error: readError || 'The page could not be read.' };

  const { html: translated, error: turnError } = await translateDoc(context, html, locale);
  if (!str(translated)) return { ok: false, error: turnError };

  // Verified, so it may be written - with the envelope AO returned, untouched.
  const { ok, error: writeError } = await writePageDoc(daFetch, org, site, targetPath, translated);
  if (!ok) return { ok: false, error: writeError };

  // One preview for the doc, exactly as Stages 4 and 5 do. A preview failure
  // keeps the written page, so it is a soft error, not a lost translation.
  const previewError = await previewPage(daFetch, org, site, targetPath, 'The page was saved');
  return { ok: true, error: previewError };
}

/**
 * Make sure a locale's site chrome exists: `/{prefix}/nav` and
 * `/{prefix}/footer`, translated from the site's root ones.
 *
 * Only the locale roots the site's header/footer blocks know about need this
 * (`CHROME_LOCALE_ROOTS`); every other prefix is served the root chrome by that
 * same block code. A fragment that is already there is left alone, so this
 * costs one DA read per fragment for every page after the locale's first.
 *
 * Never throws, and the result is advisory: the localized PAGE is fine without
 * its chrome, it just renders with an empty header and footer, so the caller
 * surfaces this as a soft error rather than failing the locale.
 * @param {{org: string, repo: string}} context
 * @param {(url: string, opts?: object) => Promise<Response>} daFetch
 * @param {{code: string, label: string, prefix: string}} locale
 * @returns {Promise<{created: string[], error: string|null}>}
 */
export async function ensureLocaleChrome(context, daFetch, locale) {
  const { org, repo: site } = context || {};
  const prefix = str(locale?.prefix).replace(/^\/+|\/+$/g, '');
  const created = [];
  if (!org || !site || typeof daFetch !== 'function') return { created, error: 'Missing DA context.' };
  if (!prefix || !CHROME_LOCALE_ROOTS.includes(prefix.toLowerCase())) {
    return { created, error: null };
  }

  const problems = [];
  // Sequential on purpose: two AO turns cannot run at once anyway (the client
  // serializes them), and a locale's first page is the only time this costs.
  for (let i = 0; i < CHROME_DOCS.length; i += 1) {
    const source = CHROME_DOCS[i];
    const target = localePath(locale, source);
    // eslint-disable-next-line no-await-in-loop
    const { html } = await readPageDoc(daFetch, org, site, target);
    if (!str(html)) {
      // eslint-disable-next-line no-await-in-loop
      const { ok, error } = await localizeDoc(context, daFetch, {
        sourcePath: source, targetPath: target, locale,
      });
      if (ok) created.push(target);
      else problems.push(`${target}: ${error || 'unknown error'}`);
    }
  }
  return {
    created,
    error: problems.length
      ? `The page is localized, but its ${locale.label || locale.code} header and footer are not: ${problems.join('; ')}`
      : null,
  };
}

// --- the whole contract ---

/**
 * Localize ONE page: read the English doc from DA, translate it in one AO turn,
 * verify its shape, write it to the locale's path, preview it once, and make
 * sure the locale's site chrome is there. Answers the `locales` sheet row (#76)
 * for that locale.
 *
 * Never throws: any failure is a `status: 'Failed'` row carrying the message a
 * panel can render, and a doc that fails verification is never written over the
 * locale path.
 *
 * The DEFAULT locale is not translated at all - the site root IS English, so
 * its "localized page" is the Stage 4 page itself and its row simply points at
 * it (`localePath` returns the source path unchanged for it).
 * @param {{org: string, repo: string}} context
 * @param {(url: string, opts?: object) => Promise<Response>} daFetch
 * @param {{page?: {path?: string}|string,
 *   locale?: string|{code: string, label?: string, prefix?: string},
 *   chrome?: boolean}} options - `chrome: false` skips the nav/footer check
 * @returns {Promise<{code: string, label: string, prefix: string,
 *   isDefault: boolean, status: string, path: string, previewUrl: string,
 *   editUrl: string, generatedAt: string, error: string|null}>}
 */
export async function localizePage(context, daFetch, { page, locale, chrome = true } = {}) {
  const { org, repo: site } = context || {};
  const generatedAt = new Date().toISOString();
  const target = resolveLocale(locale);
  const sourcePath = derivePagePath(typeof page === 'string' ? page : page?.path);
  const row = (fields) => buildLocaleRow(target, { generatedAt, ...fields });
  const fail = (error, path = '') => row({ status: FAILED, path, error });

  if (!target) return buildLocaleRow(null, { generatedAt, status: FAILED, error: 'Pick a locale first.' });
  if (!org || !site || typeof daFetch !== 'function') return fail('Missing DA context.');
  if (!sourcePath) return fail('Generate the page first.');

  const path = localePath(target, sourcePath);
  const { previewUrl, editUrl } = pageUrls(org, site, path);

  // The Stage 4 page IS the default locale's page; translating it would
  // overwrite the English source with a copy of itself.
  if (isDefaultLocale(target.code)) {
    return row({
      status: GENERATED, path, previewUrl, editUrl, error: null,
    });
  }
  // A non-default locale whose path is the source path has no site folder to
  // write into, and writing there would destroy the English page.
  if (path === sourcePath) return fail(`${target.label} has no site path to publish to.`, path);

  const { ok, error } = await localizeDoc(context, daFetch, {
    sourcePath, targetPath: path, locale: target,
  });
  if (!ok) return fail(error, path);

  let chromeError = null;
  if (chrome) ({ error: chromeError } = await ensureLocaleChrome(context, daFetch, target));

  return row({
    status: GENERATED,
    path,
    previewUrl,
    editUrl,
    error: error || chromeError,
  });
}
