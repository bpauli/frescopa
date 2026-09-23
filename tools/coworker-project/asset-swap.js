// Stage 5 page swap + re-preview (ticket #60).
//
// The seam that closes the generate-to-page loop: it takes the assets #59
// generated, puts them into the REAL page doc, and re-previews so the live
// aem.page site shows the pictures instead of the Stage 4 placeholders.
//   1. `readPageDoc`   - the doc from DA (#59 owns the read; the doc is truth).
//   2. `storeAssets`   - the bytes into DA, one permanent asset per slot.
//   3. `swapAssetSrc`  - the PURE rewrite: only the `<img src>` values change.
//   4. write the doc back to DA, then re-preview ONCE.
//   5. `saveAssets`    - the assets sheet learns each slot's `mediaUrl` (#58).
// Like the sibling contracts it never throws: every failure degrades to a soft
// error row a panel (#61) can render without a try/catch, and a slot that could
// not be swapped simply keeps its placeholder.
//
// --- Why the doc points at DA, not at Firefly (the option-C decision) ---
//
// The map originally settled "the Firefly output URL goes into the page doc, no
// DA binary upload". Gate #57 disproved that choice and the captain overrode it:
//   - A Firefly presigned URL lives exactly one hour (`X-Amz-Expires=3600`).
//   - The page SURVIVES the expiry, because the media bus already holds the
//     bytes - but the next re-preview does not. Stage 6 and every content edit
//     re-previews. The gate reproduced it on /drafts/stage5-gate-expiry: the
//     preview call still answers 200 and EVERY image silently becomes
//     `about:error`, with no warning anywhere in the API.
// So Stage 5 uploads the bytes to DA and the doc references a PERMANENT DA URL.
// Three gate-proven facts make that work with no proxy and no read-back:
//   - the presigned URL IS CORS-readable from the browser at https://da.live,
//   - `POST admin.da.live/source/...jpg` with a `FormData` blob answers 201 and
//     returns a `content.da.live` URL,
//   - the pipeline reads that auth-protected DA URL with the content-source
//     authorization and ingests it to `./media` under the SAME media hash as a
//     direct Firefly ingestion - the hash is a pure content hash.
//
// --- Two more gate-proven rules this file encodes ---
//
//   - RE-PREVIEW ONCE, AFTER ALL SLOTS (the map's "re-preview cost" fog item).
//     One `POST /preview/...` ingested two slots in one ~3 s call, and the cost
//     does not grow with the slot count. One call per slot buys nothing.
//   - KEEP THE `#width=&height=` FRAGMENT on the referenced URL. Without it the
//     pipeline drops the `width`/`height` attributes from the rendered `<img>`,
//     which is a CLS regression (gate probe /drafts/stage5-gate-rewrite).
//
// The write-back is surgical: the doc read from DA already carries the DA page
// envelope Stage 4 built with `replaceHtml`, so it is written back with that
// envelope intact and ONLY the `src` values changed. `replaceHtml` wraps INNER
// markup, so re-wrapping a whole doc would nest a second `<body>`; it is used
// here only for the degenerate case of a doc that carries no envelope at all.

import { fireflySize, readPageDoc } from './asset-generation.js';
import { derivePagePath, pageUrls } from './page-generation.js';
import { saveAssets } from './stage-state.js';

const DA_ADMIN = 'https://admin.da.live';
const DA_CONTENT = 'https://content.da.live';
const AEM_ADMIN = 'https://admin.hlx.page';
const DAFETCH_URL = 'https://da.live/nx/utils/daFetch.js';
const REF = 'main';

// Firefly returns JPEG today; the rest are here so a different content type is
// stored under an honest extension rather than a lie.
const EXTENSION_BY_TYPE = {
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'image/avif': 'avif',
};
const DEFAULT_EXTENSION = 'jpg';

const SWAPPED = 'Swapped';
const FAILED = 'Failed';

const str = (v) => (typeof v === 'string' ? v.trim() : '');

const num = (v) => (Number.isFinite(v) ? v : Number.parseInt(v, 10) || 0);

const isHttpUrl = (s) => /^https?:\/\//i.test(str(s));

const message = (e) => str(e?.message) || 'unknown error';

// The assets sheet (#58) has no column for a soft error; strip it before saving.
const sheetRow = (row) => {
  const clean = { ...row };
  delete clean.error;
  return clean;
};

// `&` FIRST, so an escaped entity is not double-escaped. The DA-hosted URL and
// the `#width=&height=` fragment both carry `&`, and an unescaped one would be
// read as an entity boundary inside the attribute (gate #57).
const escapeAttr = (s) => String(s)
  .replaceAll('&', '&amp;')
  .replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;');

// --- asset naming ---

/**
 * The file extension for an image content type, defaulting to `jpg` (what
 * Firefly returns). Pure.
 * @param {string} contentType - a MIME type, with or without parameters
 * @returns {string}
 */
export function assetExtension(contentType) {
  const type = str(contentType).split(';')[0].toLowerCase();
  return EXTENSION_BY_TYPE[type] || DEFAULT_EXTENSION;
}

/**
 * Where one slot's asset lives in DA: under the project's own folder, one file
 * per slot, named from the slot index.
 *
 * The path is DETERMINISTIC, so a Regenerate of a slot overwrites that slot's
 * asset instead of littering DA, and the page doc keeps pointing at the same
 * URL. That is safe because a re-preview always re-fetches the source (the
 * gate's expiry probe proved the fetch is live, not cached). Pure.
 * @param {string} slug - the project slug
 * @param {number} slot - the slot index
 * @param {string} [contentType] - the blob's MIME type
 * @returns {string} a DA path, or '' when the inputs are unusable
 */
export function assetDaPath(slug, slot, contentType) {
  const project = str(slug).toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-|-$/g, '');
  const index = Number(slot);
  if (!project || !Number.isFinite(index) || index < 0) return '';
  return `/projects/${project}/slot-${Math.round(index)}.${assetExtension(contentType)}`;
}

/**
 * The public DA content URL for a DA source path. Used as the fallback when the
 * upload response does not carry a `contentUrl`. Pure.
 * @param {string} org
 * @param {string} site
 * @param {string} path - a DA path with a leading slash and an extension
 * @returns {string}
 */
export function daContentUrl(org, site, path) {
  return `${DA_CONTENT}/${org}/${site}${path}`;
}

/**
 * The pixel geometry to pin on a slot's reference. The generated image's own
 * width/height when the row carries them, otherwise the Firefly size the slot's
 * aspect ratio resolves to - which IS the size that was requested, so it is the
 * size that came back. Pure.
 * @param {{width?: number, height?: number, aspect?: string}} asset
 * @returns {{width: number, height: number}}
 */
export function assetGeometry(asset) {
  const width = num(asset?.width);
  const height = num(asset?.height);
  if (width > 0 && height > 0) return { width, height };
  return fireflySize(str(asset?.aspect));
}

/**
 * The URL the page doc references for an asset: the image URL with the
 * `#width=&height=` fragment the pipeline needs to keep the rendered `<img>`
 * dimensions (omitting it is a CLS regression - gate #57). A URL that already
 * carries a fragment is left as the caller pinned it. Pure.
 * @param {string} url
 * @param {number} [width]
 * @param {number} [height]
 * @returns {string} the reference, or '' when the URL is not usable
 */
export function mediaRef(url, width, height) {
  const target = str(url);
  if (!isHttpUrl(target)) return '';
  if (target.includes('#')) return target;
  const w = Math.round(num(width));
  const h = Math.round(num(height));
  return w > 0 && h > 0 ? `${target}#width=${w}&height=${h}` : target;
}

// --- the pure swap ---

const IMG_TAG_RE = /<img\b[^>]*>/gi;
const SRC_ATTR_RE = /(\bsrc\s*=\s*)(?:"[^"]*"|'[^']*')/i;

// Rewrite ONE `<img>` tag's `src`, touching nothing else on the tag - `alt`,
// `loading`, ordering and quoting of every other attribute survive verbatim.
function setSrc(tag, url) {
  const value = `"${escapeAttr(url)}"`;
  if (SRC_ATTR_RE.test(tag)) return tag.replace(SRC_ATTR_RE, (m, head) => `${head}${value}`);
  return tag.replace(/^<img\b/i, `<img src=${value}`);
}

/**
 * THE swap: replace the `src` of the `<img>` at each given slot, and change
 * nothing else in the document.
 *
 * `slot` is the image's index among ALL `<img>` elements in the doc - the same
 * key `extractSlots` (#59) hands out - so the key stays stable once some slots
 * hold real assets and a Regenerate rewrites exactly one image. Document order
 * is preserved, a slot with no replacement (or an unusable URL) keeps its
 * placeholder, a replacement for a slot the doc does not have is ignored, and
 * every other attribute and every other byte of markup is untouched. Pure.
 * @param {string} html - the page doc
 * @param {Array<{slot: number, url: string, width?: number, height?: number}>} replacements
 * @returns {string} the rewritten doc
 */
export function swapAssetSrc(html, replacements) {
  const doc = typeof html === 'string' ? html : '';
  const bySlot = new Map();
  (Array.isArray(replacements) ? replacements : []).forEach((item) => {
    const slot = Number(item?.slot);
    const ref = mediaRef(item?.url, item?.width, item?.height);
    if (Number.isFinite(slot) && ref) bySlot.set(slot, ref);
  });
  if (!bySlot.size) return doc;

  let index = 0;
  return doc.replace(IMG_TAG_RE, (tag) => {
    const ref = bySlot.get(index);
    index += 1;
    return ref ? setSrc(tag, ref) : tag;
  });
}

// --- DA asset storage ---

/**
 * Read one generated image's bytes. The Firefly presigned URL is CORS-readable
 * straight from the browser (gate #57), so this is a plain `fetch` with no
 * proxy and no authorization. Never throws.
 * @param {string} sourceUrl
 * @param {(url: string, opts?: object) => Promise<Response>} [fetchImpl]
 * @returns {Promise<{blob: Blob|null, error: string|null}>}
 */
export async function fetchAssetBytes(sourceUrl, fetchImpl = fetch) {
  if (!isHttpUrl(sourceUrl)) return { blob: null, error: 'This slot has no generated image.' };
  if (typeof fetchImpl !== 'function') return { blob: null, error: 'No fetch available.' };
  try {
    const resp = await fetchImpl(str(sourceUrl));
    if (!resp.ok) {
      // The most likely 403 here is the one-hour presigned expiry.
      return { blob: null, error: `Could not read the image: ${resp.status} ${resp.statusText}` };
    }
    return { blob: await resp.blob(), error: null };
  } catch (e) {
    return { blob: null, error: `Could not read the image: ${message(e)}` };
  }
}

/**
 * Upload image bytes to DA at a path, and answer with the permanent URL the
 * page doc can reference for ever. Same `FormData`/`Blob` mechanism as every
 * other DA write in this app. Never throws.
 * @param {(url: string, opts?: object) => Promise<Response>} daFetch
 * @param {string} org
 * @param {string} site
 * @param {string} path - the DA path, with an extension
 * @param {Blob} blob
 * @returns {Promise<{url: string, error: string|null}>}
 */
export async function uploadAsset(daFetch, org, site, path, blob) {
  if (!org || !site || typeof daFetch !== 'function') return { url: '', error: 'Missing DA context.' };
  if (!path) return { url: '', error: 'The asset has nowhere to go in DA.' };
  if (!blob) return { url: '', error: 'This slot has no image bytes.' };
  try {
    const body = new FormData();
    body.set('data', blob);
    const resp = await daFetch(`${DA_ADMIN}/source/${org}/${site}${path}`, { method: 'POST', body });
    if (!resp.ok) {
      return { url: '', error: `Could not store the image: ${resp.status} ${resp.statusText}` };
    }
    const json = await resp.json().catch(() => ({}));
    const url = str(json?.contentUrl) || str(json?.source?.contentUrl);
    return { url: url || daContentUrl(org, site, path), error: null };
  } catch (e) {
    return { url: '', error: `Could not store the image: ${message(e)}` };
  }
}

/**
 * Give ONE asset row a permanent home: fetch the Firefly bytes and upload them
 * to the slot's DA path. An asset that already has a `mediaUrl` keeps it when
 * the upload cannot be redone (the presigned source has usually expired by
 * then), so re-running a swap over an old project still works. Never throws:
 * the returned row always carries the input row plus `mediaUrl` and `error`.
 * @param {(url: string, opts?: object) => Promise<Response>} daFetch
 * @param {{org: string, site: string, slug: string}} target
 * @param {object} asset - an assets-sheet row (#58)
 * @param {(url: string, opts?: object) => Promise<Response>} [fetchImpl]
 * @returns {Promise<object>} `{...asset, mediaUrl, error}`
 */
export async function storeAsset(daFetch, target, asset, fetchImpl) {
  const { org, site, slug } = target || {};
  const stored = str(asset?.mediaUrl);
  const keep = (error) => ({ ...asset, mediaUrl: stored, error: stored ? null : error });

  if (!isHttpUrl(asset?.sourceUrl)) return keep('This slot has no generated image.');

  const { blob, error: readError } = await fetchAssetBytes(asset.sourceUrl, fetchImpl);
  if (!blob) return keep(readError);

  const path = assetDaPath(slug, asset?.slot, blob.type);
  const { url, error: writeError } = await uploadAsset(daFetch, org, site, path, blob);
  if (!url) return keep(writeError);
  return { ...asset, mediaUrl: url, error: null };
}

/**
 * Store every generated asset of a page, in slot order. The uploads run
 * together because they touch different DA paths and each one is a ~1 MB round
 * trip through the producer's browser. Never throws.
 * @param {(url: string, opts?: object) => Promise<Response>} daFetch
 * @param {{org: string, site: string, slug: string}} target
 * @param {Array<object>} assets - assets-sheet rows (#58)
 * @param {(url: string, opts?: object) => Promise<Response>} [fetchImpl]
 * @returns {Promise<Array<object>>} one `{...asset, mediaUrl, error}` per input row
 */
export async function storeAssets(daFetch, target, assets, fetchImpl) {
  const rows = (Array.isArray(assets) ? assets : [])
    .filter((r) => r && Number.isFinite(Number(r.slot)))
    .sort((a, b) => Number(a.slot) - Number(b.slot));
  return Promise.all(rows.map((row) => storeAsset(daFetch, target, row, fetchImpl)));
}

// --- DA write-back + re-preview ---

// The doc read from DA already carries the page envelope Stage 4 built. Only a
// doc that somehow lost it gets wrapped, because `replaceHtml` wraps INNER
// markup and would otherwise nest a second `<body>`.
async function ensurePageEnvelope(html, org, site) {
  if (/<body[\s>]/i.test(html)) return html;
  const { replaceHtml } = await import(DAFETCH_URL);
  return replaceHtml(html, org, site);
}

/**
 * Write a page doc back to DA at `{path}.html`. Never throws.
 * @param {(url: string, opts?: object) => Promise<Response>} daFetch
 * @param {string} org
 * @param {string} site
 * @param {string} path - the extensionless page path
 * @param {string} html - the whole doc
 * @returns {Promise<{ok: boolean, error: string|null}>}
 */
export async function writePageDoc(daFetch, org, site, path, html) {
  if (!org || !site || typeof daFetch !== 'function') return { ok: false, error: 'Missing DA context.' };
  try {
    const doc = await ensurePageEnvelope(html, org, site);
    const body = new FormData();
    body.set('data', new Blob([doc], { type: 'text/html' }));
    const resp = await daFetch(`${DA_ADMIN}/source/${org}/${site}${path}.html`, { method: 'POST', body });
    if (!resp.ok) {
      return { ok: false, error: `Could not save the page: ${resp.status} ${resp.statusText}` };
    }
    return { ok: true, error: null };
  } catch (e) {
    return { ok: false, error: `Could not save the page: ${message(e)}` };
  }
}

/**
 * Re-trigger the aem.page preview so the pipeline ingests the swapped images
 * into the site's own `./media`.
 *
 * Called ONCE, after every slot is swapped - not once per slot. Gate #57 proved
 * one call ingests every image on the page in ~3 s whatever the slot count.
 * Returns a soft error message, or null: the doc is already saved, so a preview
 * failure must not lose the swap.
 *
 * Stage 6 previews a localized doc through this same call (#77), where nothing
 * was swapped, so `saved` names what DID land - the message has to be true for
 * the reader of the row it ends up in.
 * @param {(url: string, opts?: object) => Promise<Response>} daFetch
 * @param {string} org
 * @param {string} site
 * @param {string} path - the extensionless page path
 * @param {string} [saved] - what was saved, for the soft error message
 * @returns {Promise<string|null>}
 */
export async function previewPage(daFetch, org, site, path, saved = 'Images saved') {
  if (!org || !site || typeof daFetch !== 'function') return 'Missing DA context.';
  try {
    const resp = await daFetch(`${AEM_ADMIN}/preview/${org}/${site}/${REF}${path}`, { method: 'POST' });
    if (resp.ok) return null;
    return `${saved}, but the preview failed: ${resp.status} ${resp.statusText}`;
  } catch (e) {
    return `${saved}, but the preview failed: ${message(e)}`;
  }
}

// --- the whole loop ---

/**
 * Swap the generated assets into the project's page and re-preview it.
 *
 * Read the doc from DA, give every generated asset a permanent DA home, rewrite
 * only the `<img src>` values, write the doc back, re-preview ONCE, and record
 * each slot's `mediaUrl` in the assets sheet. Never throws: a slot that could
 * not be stored keeps its placeholder and carries its own error, and the page
 * still lands with the slots that worked.
 * @param {{org: string, repo: string}} context
 * @param {(url: string, opts?: object) => Promise<Response>} daFetch
 * @param {{slug: string, path: string, assets: Array<object>}} options
 * @param {(url: string, opts?: object) => Promise<Response>} [fetchImpl]
 * @returns {Promise<{path: string, previewUrl: string, assets: Array<object>,
 *   swapped: number, swappedAt: string, status: string, error: string|null}>}
 */
export async function swapAssetsIntoPage(context, daFetch, options, fetchImpl) {
  const { slug, path, assets } = options || {};
  const { org, repo: site } = context || {};
  const swappedAt = new Date().toISOString();
  const target = derivePagePath(path);
  const rows = (Array.isArray(assets) ? assets : [])
    .filter((r) => r && Number.isFinite(Number(r.slot)));
  const fail = (error, list = rows) => ({
    path: target,
    previewUrl: '',
    assets: list,
    swapped: 0,
    swappedAt,
    status: FAILED,
    error,
  });

  if (!org || !site || typeof daFetch !== 'function') return fail('Missing DA context.');
  if (!target) return fail('The project has no generated page yet.');
  if (!str(slug)) return fail('Missing project.');
  if (!rows.length) return fail('Generate the images first.');

  const { html, error: readError } = await readPageDoc(daFetch, org, site, target);
  if (!html) return fail(readError || 'The page could not be read.');

  const storedRows = await storeAssets(daFetch, { org, site, slug }, rows, fetchImpl);
  const replacements = storedRows
    .filter((r) => isHttpUrl(r.mediaUrl))
    .map((r) => ({ slot: Number(r.slot), url: r.mediaUrl, ...assetGeometry(r) }));
  if (!replacements.length) {
    return fail(storedRows.find((r) => r.error)?.error || 'No image could be stored.', storedRows);
  }

  const swappedHtml = swapAssetSrc(html, replacements);
  const { ok, error: writeError } = await writePageDoc(daFetch, org, site, target, swappedHtml);
  if (!ok) return fail(writeError, storedRows);

  // ONE preview for the whole page, after every slot (gate #57).
  const previewError = await previewPage(daFetch, org, site, target);

  // The sheet must hold the durable URL, not just the expiring `sourceUrl`.
  let saveError = null;
  try {
    await saveAssets(context, daFetch, slug, { assets: storedRows.map(sheetRow) });
  } catch (e) {
    saveError = `Images swapped, but the project record was not updated: ${message(e)}`;
  }

  return {
    path: target,
    previewUrl: pageUrls(org, site, target).previewUrl,
    assets: storedRows,
    swapped: replacements.length,
    swappedAt,
    status: SWAPPED,
    error: previewError || saveError || storedRows.find((r) => r.error)?.error || null,
  };
}
