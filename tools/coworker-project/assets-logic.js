// Pure helpers for the Stage 5 "Generated Assets" panel (ticket #61).
//
// The panel keeps the AO work in asset-generation.js (#59), the page swap in
// asset-swap.js (#60) and the persistence in stage-state.js `saveAssets` (#58);
// everything here is plain data shaping, so it is unit tested without a DOM.
//
// The one idea worth naming: the grid is the UNION of the page's placeholder
// slots and the project's saved asset rows, keyed by `slot`. Neither side alone
// is the whole grid - once a slot is swapped its placeholder is gone from the
// doc, and before the first run there are no saved rows at all.

import { buildAssetPrompt } from './asset-generation.js';
import { derivePagePath } from './page-generation.js';

const str = (v) => (typeof v === 'string' ? v.trim() : '');

const isHttpUrl = (s) => /^https?:\/\//i.test(str(s));

const GENERATED = 'Generated';
const FAILED = 'Failed';

// Where "Go to Firefly" goes: the producer's own Firefly workspace, for the
// work Stage 5 deliberately does not do (variants, expand, fill).
export const FIREFLY_URL = 'https://firefly.adobe.com/generate/image';

/**
 * The extensionless DA path of the project's generated page - what the doc
 * read, the swap and the re-preview are all keyed by. A project with no page
 * yet answers '', which is the panel's neutral idle state. Pure.
 * @param {{path?: string, previewUrl?: string}} page
 * @returns {string}
 */
export function pagePath(page) {
  return derivePagePath(page?.path) || derivePagePath(page?.previewUrl);
}

/**
 * One assets-sheet row (#58) from one generation result and the slot it was
 * generated for.
 *
 * The result owns what Firefly reported, the slot owns what the page says the
 * picture shows (`alt`), and the Stage 2 creative direction is denormalized
 * onto the row so the detail view can show the look the asset was made for
 * without re-reading the project. `error` is transient UI state, kept on the
 * row for the soft-fail state and stripped again by `assetRecord`. Pure.
 * @param {object} result - a row from `generateAsset`/`generateAssets` (#59)
 * @param {{slot?: number, alt?: string, aspect?: string}} [slot]
 * @param {{visualStyle?: object, colorPalette?: object}} [creativeDirection]
 * @returns {object} an assets-sheet row plus `error`
 */
export function assetRow(result, slot, creativeDirection) {
  const r = result || {};
  const s = slot || {};
  const cd = creativeDirection || {};
  const index = Number.isFinite(Number(r.slot)) ? Number(r.slot) : Number(s.slot);
  const colors = Array.isArray(cd.colorPalette?.colors) ? cd.colorPalette.colors : [];
  return {
    id: Number.isFinite(index) ? `slot-${index}` : '',
    slot: index,
    alt: str(s.alt) || str(r.alt),
    prompt: str(r.prompt),
    status: str(r.status) || FAILED,
    sourceUrl: str(r.sourceUrl),
    mediaUrl: str(r.mediaUrl),
    model: str(r.model),
    aspect: str(r.aspect) || str(s.aspect),
    visualStyle: str(cd.visualStyle?.name),
    palette: str(cd.colorPalette?.name) || colors.map(str).filter(Boolean).join(', '),
    description: str(r.description),
    createdAt: str(r.createdAt),
    error: r.error ?? null,
  };
}

/**
 * The persisted shape of a row: the sheet columns without the transient soft
 * error, which is UI state and has no column (#58). Pure.
 * @param {object} row
 * @returns {object}
 */
export function assetRecord(row) {
  const clean = { ...row };
  delete clean.error;
  return clean;
}

/**
 * Merge freshly generated rows into the rows already held, keyed by `slot`, in
 * slot order.
 *
 * The same merge-by-slot rule `saveAssets` uses, so a Regenerate replaces
 * exactly one card and leaves every other one alone. Pure.
 * @param {Array<object>} existing
 * @param {Array<object>} incoming
 * @returns {Array<object>}
 */
export function mergeAssets(existing, incoming) {
  const bySlot = new Map();
  const add = (list) => (Array.isArray(list) ? list : []).forEach((row) => {
    const slot = Number(row?.slot);
    if (Number.isFinite(slot)) bySlot.set(slot, { ...row, slot });
  });
  add(existing);
  add(incoming);
  return [...bySlot.values()].sort((a, b) => a.slot - b.slot);
}

/**
 * The image URLs a card may show, best first.
 *
 * Both stored URLs can fail for their own reason - the Firefly `sourceUrl`
 * expires after an hour, and the DA `mediaUrl` is auth-protected - so the card
 * walks this list on an image error instead of betting on one of them, and
 * lands on the slot's own placeholder, which always renders. Pure.
 * @param {{sourceUrl?: string, mediaUrl?: string}} asset
 * @param {{src?: string}} [slot]
 * @returns {Array<string>}
 */
export function thumbnailCandidates(asset, slot) {
  const list = [asset?.sourceUrl, asset?.mediaUrl, slot?.src ?? asset?.placeholder]
    .map(str)
    .filter(isHttpUrl);
  return [...new Set(list)];
}

/**
 * How one card reads: `generating` while its turn is in flight, `ready` once an
 * image is showable, `failed` for a slot that came back without one, and
 * `empty` for a slot that has not been asked for yet. A failed slot is a soft
 * state - it still shows its placeholder and never blocks the panel. Pure.
 * @param {{status?: string, error?: string|null}} row
 * @param {boolean} [busy]
 * @returns {'generating'|'ready'|'failed'|'empty'}
 */
export function assetState(row, busy) {
  if (busy) return 'generating';
  const status = str(row?.status);
  if (status === GENERATED && (isHttpUrl(row?.sourceUrl) || isHttpUrl(row?.mediaUrl))) return 'ready';
  if (status === FAILED || str(row?.error)) return 'failed';
  return 'empty';
}

/**
 * The card caption. The demo's "Image title" has no source yet (the map leaves
 * it to the detail view), so the caption is what the page says the picture
 * shows, then what Firefly says it made, then the slot's own number. Pure.
 * @param {{alt?: string, description?: string, slot?: number}} row
 * @returns {string}
 */
export function assetLabel(row) {
  const slot = Number(row?.slot);
  return str(row?.alt) || str(row?.description)
    || `Image ${Number.isFinite(slot) ? slot + 1 : 1}`;
}

/**
 * THE grid: one card per image slot of the page, merging the placeholder slots
 * read out of the doc (#59 `extractSlots`) with the project's saved asset rows
 * (#58), keyed by `slot` and in document order.
 *
 * A slot with no row yet is an empty card, a row whose placeholder is already
 * swapped keeps its card, and a slot currently generating is marked so the card
 * can show progress. Pure.
 * @param {Array<{slot: number, alt?: string, src?: string, aspect?: string}>} slots
 * @param {Array<object>} assets - assets-sheet rows
 * @param {Array<number>|Set<number>} [busy] - slots whose generation is in flight
 * @returns {Array<object>} one card row per slot, each with `state`,
 *   `label`, `placeholder` and `thumbnails`
 */
export function gridRows(slots, assets, busy) {
  const running = new Set([...(busy || [])].map(Number));
  const placeholders = new Map();
  (Array.isArray(slots) ? slots : []).forEach((s) => {
    const slot = Number(s?.slot);
    if (Number.isFinite(slot)) placeholders.set(slot, s);
  });

  const cards = new Map();
  placeholders.forEach((s, slot) => cards.set(slot, {
    slot, alt: str(s.alt), aspect: str(s.aspect), placeholder: str(s.src),
  }));
  (Array.isArray(assets) ? assets : []).forEach((row) => {
    const slot = Number(row?.slot);
    if (!Number.isFinite(slot)) return;
    const card = cards.get(slot) || { slot, placeholder: '' };
    cards.set(slot, {
      ...card,
      ...row,
      slot,
      alt: str(row.alt) || card.alt,
      aspect: str(row.aspect) || card.aspect,
      placeholder: card.placeholder,
    });
  });

  return [...cards.values()]
    .sort((a, b) => a.slot - b.slot)
    .map((card) => ({
      ...card,
      state: assetState(card, running.has(card.slot)),
      label: assetLabel(card),
      thumbnails: thumbnailCandidates(card, card),
    }));
}

/**
 * The "N of N assets" count: how many cards carry a usable image, out of how
 * many slots the page has. Pure.
 * @param {Array<{state?: string}>} cards - the rows `gridRows` returned
 * @returns {{ready: number, total: number, label: string}}
 */
export function assetCount(cards) {
  const rows = Array.isArray(cards) ? cards : [];
  const ready = rows.filter((c) => c.state === 'ready').length;
  const total = rows.length;
  return { ready, total, label: `${ready} of ${total} asset${total === 1 ? '' : 's'}` };
}

/**
 * The generation jobs for a set of cards or slots: one prompt per slot, built
 * from what the page says the picture shows and the Stage 2 creative direction,
 * so a Regenerate picks up a creative direction that changed since the first
 * run instead of replaying the stored prompt. Pure.
 * @param {Array<{slot: number, alt?: string, aspect?: string}>} slots
 * @param {{visualStyle?: object, colorPalette?: object}} [creativeDirection]
 * @returns {Array<{slot: number, prompt: string, aspect: string}>}
 */
export function slotJobs(slots, creativeDirection) {
  return (Array.isArray(slots) ? slots : [])
    .filter((s) => Number.isFinite(Number(s?.slot)))
    .map((s) => ({
      slot: Number(s.slot),
      prompt: buildAssetPrompt(s, creativeDirection),
      aspect: str(s.aspect),
    }));
}

/**
 * The rows worth swapping into the page: the ones that actually came back with
 * a Firefly image, or that already hold a DA copy. A failed slot is left out so
 * it keeps its placeholder. Pure.
 * @param {Array<object>} rows
 * @returns {Array<object>}
 */
export function swappableAssets(rows) {
  return (Array.isArray(rows) ? rows : [])
    .filter((r) => isHttpUrl(r?.sourceUrl) || isHttpUrl(r?.mediaUrl));
}
