// Pure helpers for the Stage 5 asset detail view (ticket #62).
//
// The detail view opens ONE row of the `assets` sheet (#58) and shows what the
// app actually knows about that image. Everything here is data shaping, so it
// is unit tested without a DOM; the fetching, the AO turn and the DA writes
// stay in asset-detail-panel.js, asset-generation.js (#59) and asset-swap.js
// (#60).
//
// Two rules this file encodes, both settled at this ticket:
//
//   - THE TITLE COMES FROM THE SLOT `alt`, never from AO and never from the
//     per-run `description`. The assets sheet has no title column and nothing
//     in the pipeline writes one. `alt` is the page's own words for this
//     picture: written once by AO in Stage 4, carried in the doc, and stable
//     across every Regenerate - so the card keeps its name when the image
//     changes. `description` is AO's account of the image it just drew, so it
//     moves on every run and is empty for a failed slot. A slot with no `alt`
//     falls back to its slot number, which always exists.
//   - NOTHING IS INVENTED. A field the row does not carry is shown as an empty
//     state, not as a plausible-looking value. `model` is the sharpest case:
//     the Firefly tool reports no model (gate #57), so the recorded id is only
//     the `x-model-version` the app asked for. It is labelled best-effort
//     rather than presented as tool fact - and never as the demo's hardcoded
//     "Gemini 3 / Nano Banana 2".
//
// `alt` is NOT rewritten here or anywhere on the swap: see
// docs/adr/0003-stage5-alt-text-survives-the-swap.md.

import { buildAssetPrompt } from './asset-generation.js';
import { assetExtension } from './asset-swap.js';

const str = (v) => (typeof v === 'string' ? v.trim() : '');

const isHttpUrl = (s) => /^https?:\/\//i.test(str(s));

// How long a title may get before it is cut at a word boundary.
const TITLE_MAX = 72;

// What an empty field says. "Not recorded" is the honest answer for a value the
// row simply does not carry; the model line says "Not reported" because the
// tool is the one that never reported it.
const MISSING = 'Not recorded';
const MODEL_MISSING = 'Not reported';

// The model is the one field that is never tool fact (gate #57): the Firefly
// tool reports no model, so the row can only hold the `x-model-version` the app
// pinned on the request.
export const MODEL_NOTE = 'Best-effort: the Firefly tool reports no model, so this is the '
  + 'model version the app asked for.';

/**
 * The display title of one asset: the slot's `alt` text, shortened to a title.
 *
 * The sheet has no title column, and the two candidates that are not `alt` both
 * fail the producer: AO writes no title, and the per-run `description` changes
 * under the card on every Regenerate. `alt` is the page's own description of
 * this picture and survives regeneration, so it names the slot. A slot without
 * `alt` is named by its position, which always exists. Pure.
 * @param {{alt?: string, slot?: number}} asset
 * @returns {string}
 */
export function assetTitle(asset) {
  const slot = Number(asset?.slot);
  const fallback = Number.isFinite(slot) ? `Image ${Math.round(slot) + 1}` : 'Image';
  const alt = str(asset?.alt);
  if (!alt) return fallback;

  // The first sentence of the alt is the subject; the rest is detail.
  const first = str((alt.match(/^[^.!?]+/) || [alt])[0]) || alt;
  const title = first.length <= TITLE_MAX
    ? first
    : `${str(first.slice(0, TITLE_MAX).replace(/\s+\S*$/, ''))}...`;
  return title.charAt(0).toUpperCase() + title.slice(1);
}

/**
 * The `createdAt` stamp as a date the producer reads, or '' when the row
 * carries no usable timestamp. Pure.
 * @param {string} iso
 * @returns {string}
 */
export function formatCreatedAt(iso) {
  const s = str(iso);
  if (!s) return '';
  const date = new Date(s);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

/**
 * The metadata rows of the detail view, in the order the PRD lists them
 * (FR-45): Created on, Model, ALT Text, Aspect, Visual style, Palette,
 * Description.
 *
 * Every row comes off the `assets` row. A value the row does not carry comes
 * back as `missing: true` with an empty `value` and the `placeholder` the panel
 * shows instead, so no field is ever filled with a plausible-looking guess. The
 * model row carries `note`, because that value is the only one that is not tool
 * fact. Pure.
 * @param {object} asset - an assets-sheet row (#58)
 * @returns {Array<{key: string, label: string, value: string, missing: boolean,
 *   placeholder: string, note: string}>}
 */
export function detailFields(asset) {
  const row = asset || {};
  const fields = [
    { key: 'createdAt', label: 'Created on', value: formatCreatedAt(row.createdAt) },
    {
      key: 'model', label: 'Model', value: str(row.model), placeholder: MODEL_MISSING, note: MODEL_NOTE,
    },
    { key: 'alt', label: 'ALT Text', value: str(row.alt) },
    { key: 'aspect', label: 'Aspect', value: str(row.aspect) },
    { key: 'visualStyle', label: 'Visual style', value: str(row.visualStyle) },
    { key: 'palette', label: 'Palette', value: str(row.palette) },
    { key: 'description', label: 'Description', value: str(row.description) },
  ];
  return fields.map((f) => ({
    key: f.key,
    label: f.label,
    value: f.value,
    missing: !f.value,
    placeholder: f.placeholder || MISSING,
    note: f.value ? (f.note || '') : '',
  }));
}

/**
 * Where the asset's bytes can be read from, best first.
 *
 * `mediaUrl` is the permanent DA copy the page doc references (#60) and is
 * preferred, but it is served from the auth-protected `content.da.live`, so it
 * has to be read with `daFetch` - that is what `durable` says. `sourceUrl` is
 * the Firefly presigned URL: CORS-readable from the browser with a plain
 * `fetch` (gate #57), but it expires an hour after generation, so it is only
 * the fallback. Any `#width=&height=` fragment is dropped: it is a pipeline
 * instruction, not part of the address.
 *
 * The durable address carries the row's `createdAt` as a `v` parameter, because
 * the DA path is DETERMINISTIC (`/projects/<slug>/slot-<n>.<ext>`): a Regenerate
 * overwrites the same file, so without the stamp the address of the new image
 * equals the address of the old one and a viewer shows the cached previous
 * picture. The stamp is never added to the Firefly URL, whose signature covers
 * its query string. Pure.
 * @param {{mediaUrl?: string, sourceUrl?: string, createdAt?: string}} asset
 * @returns {Array<{url: string, durable: boolean}>}
 */
export function imageCandidates(asset) {
  const out = [];
  const media = str(asset?.mediaUrl).split('#')[0];
  const stamp = str(asset?.createdAt);
  if (isHttpUrl(media)) {
    const sep = media.includes('?') ? '&' : '?';
    out.push({ url: stamp ? `${media}${sep}v=${encodeURIComponent(stamp)}` : media, durable: true });
  }
  const source = str(asset?.sourceUrl).split('#')[0];
  if (isHttpUrl(source)) out.push({ url: source, durable: false });
  return out;
}

/**
 * The file name a downloaded asset lands under: the project and the slot, so
 * two downloads from two projects do not collide in the producer's Downloads
 * folder. The extension follows the bytes' own content type. Pure.
 * @param {{slot?: number}} asset
 * @param {string} [slug] - the project slug
 * @param {string} [contentType] - the blob's MIME type
 * @returns {string}
 */
export function downloadName(asset, slug, contentType) {
  const project = str(slug).toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-|-$/g, '');
  const slot = Number(asset?.slot);
  const where = Number.isFinite(slot) ? `slot-${Math.round(slot)}` : 'asset';
  return `${[project, where].filter(Boolean).join('-')}.${assetExtension(contentType)}`;
}

// The creative direction a row remembers. The sheet keeps only the names, which
// is enough to keep a regenerated image in the same look when the caller hands
// over no creative direction of its own.
function directionFromRow(asset) {
  const visualStyle = str(asset?.visualStyle);
  const palette = str(asset?.palette);
  if (!visualStyle && !palette) return null;
  return {
    visualStyle: visualStyle ? { name: visualStyle } : undefined,
    colorPalette: palette ? { name: palette } : undefined,
  };
}

/**
 * The generation job that re-runs ONE slot - the same `{slot, prompt, aspect}`
 * shape the grid (#61) hands `generateAsset`, so Regenerate here and Regenerate
 * there take the same path and land in the same row.
 *
 * The prompt is rebuilt from the slot's `alt` plus the current creative
 * direction, so a Stage 2 change reaches the new image; when the caller passes
 * no direction, the row's own style and palette names stand in, and a row
 * without `alt` falls back to the prompt that was used last time. Pure.
 * @param {object} asset - an assets-sheet row (#58)
 * @param {{visualStyle?: object, colorPalette?: object}} [creativeDirection]
 * @returns {{slot: number, prompt: string, aspect: string}}
 */
export function regenerationJob(asset, creativeDirection) {
  const slot = Number(asset?.slot);
  const aspect = str(asset?.aspect);
  const direction = creativeDirection || directionFromRow(asset);
  const alt = str(asset?.alt);
  const previous = str(asset?.prompt);
  const prompt = alt || !previous
    ? buildAssetPrompt({ alt, aspect }, direction)
    : previous;
  return { slot: Number.isFinite(slot) ? Math.round(slot) : 0, prompt, aspect };
}

/**
 * The assets-sheet row a regenerated slot saves: the new image's own facts over
 * the parts of the old row that describe the SLOT rather than the image.
 *
 * `alt` survives, because it belongs to the page and is what the next prompt is
 * built from; `description` does not, because it described the previous image.
 * `mediaUrl` is cleared: the durable DA copy of the new bytes does not exist
 * until the swap (#60) uploads it, and claiming the old URL would point the
 * sheet at the previous image. The row carries no soft error, so it is
 * `saveAssets`-ready as it stands. Pure.
 * @param {object} previous - the row being replaced
 * @param {object} result - a `generateAsset` result row (#59)
 * @param {{visualStyle?: object, colorPalette?: object}} [creativeDirection]
 * @returns {object} an assets-sheet row
 */
export function assetRow(previous, result, creativeDirection) {
  const prev = previous || {};
  const r = result || {};
  const raw = Number.isFinite(Number(r.slot)) ? Number(r.slot) : Number(prev.slot);
  const slot = Number.isFinite(raw) ? Math.round(raw) : 0;
  const cd = creativeDirection || {};
  return {
    id: str(prev.id) || `slot-${slot}`,
    slot,
    alt: str(prev.alt),
    prompt: str(r.prompt) || str(prev.prompt),
    status: str(r.status) || str(prev.status),
    sourceUrl: str(r.sourceUrl),
    mediaUrl: '',
    model: str(r.model) || str(prev.model),
    aspect: str(r.aspect) || str(prev.aspect),
    visualStyle: str(cd.visualStyle?.name) || str(prev.visualStyle),
    palette: str(cd.colorPalette?.name) || str(prev.palette),
    description: str(r.description),
    createdAt: str(r.createdAt) || str(prev.createdAt),
  };
}
