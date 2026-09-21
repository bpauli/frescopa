/* eslint-disable no-underscore-dangle */
// The Stage 5 asset detail view (ticket #62).
//
// ONE asset from the Generated Assets grid, opened big: the image plus the real
// metadata of its `assets` row (#58) - Created on, Model, ALT Text, Aspect,
// Visual style, Palette, Description - and the three actions of FR-46:
// Regenerate, Download, Add to chat.
//
// STANDALONE BY DESIGN. It owns no list and no layout: the grid (#61) or the
// shell wiring (#64) hands it a row, either declaratively (`.asset=${row}`) or
// by calling `open(row)`, and `close()` (or Escape, or the scrim) puts it away.
// A regenerated row leaves by `asset-changed`, so the owner's cache stays true
// without this component reaching into it.
//
// Facts that shape the code:
//   - NO VALUE IS INVENTED. Every line comes off the row; an absent field shows
//     an empty state (asset-detail-logic.js `detailFields`). `Model` is
//     labelled best-effort because the Firefly tool reports none (gate #57).
//   - THE IMAGE IS FETCHED, NOT LINKED. The durable copy lives on the
//     auth-protected `content.da.live` (a plain `<img src>` there answers 401),
//     so the bytes are read with `daFetch` and shown from an object URL. The
//     same blob is what Download saves, so opening the view costs one fetch and
//     the save costs none. The Firefly `sourceUrl` is the fallback: CORS-
//     readable from the browser, but expired an hour after generation.
//   - REGENERATE TAKES THE GRID'S PATH: `generateAsset` (#59) for the new
//     image, then `swapAssetsIntoPage` (#60), which stores the bytes in DA,
//     rewrites that one `<img src>`, re-previews and saves the row through
//     `saveAssets` - merge-by-slot, so exactly one row changes. An owner that
//     already has its own path passes it as `.regenerate` and that one is used
//     instead, so the app never grows two generation policies.
//   - IT NEVER BLOCKS. `generateAsset` and `swapAssetsIntoPage` never throw; a
//     failed run keeps the row that is on screen and degrades to a soft error,
//     exactly like its Stage 4 siblings.

import { LitElement, html } from 'da-lit';
import { generateAsset } from './asset-generation.js';
import { fetchAssetBytes, swapAssetsIntoPage } from './asset-swap.js';
import { saveAssets } from './stage-state.js';
import { ASSET_CHAT_LEAD, composeAssetMessage } from './chat-context.js';
import {
  assetTitle, detailFields, imageCandidates, downloadName, regenerationJob, assetRow,
} from './asset-detail-logic.js';

const FAILED = 'Failed';

// Read the asset's bytes from the first source that answers: the durable DA
// copy with `daFetch` (it is auth-protected), then the Firefly presigned URL
// with a plain `fetch`. Recursive rather than a loop so each candidate is tried
// in order without racing the next one. Never throws.
async function readBytes(candidates, daFetch, index = 0) {
  if (index >= candidates.length) {
    return { blob: null, error: 'This slot has no image yet.' };
  }
  const { url, durable } = candidates[index];
  const impl = durable && typeof daFetch === 'function' ? daFetch : fetch;
  const result = await fetchAssetBytes(url, impl);
  if (result.blob) return result;
  const next = await readBytes(candidates, daFetch, index + 1);
  return next.blob ? next : result;
}

class DaAssetDetail extends LitElement {
  static properties = {
    context: { attribute: false },
    daFetch: { attribute: false },
    slug: { attribute: false },
    page: { attribute: false },
    creativeDirection: { attribute: false },
    asset: { attribute: false },
    regenerate: { attribute: false },
    _imageUrl: { state: true },
    _imageError: { state: true },
    _loadingImage: { state: true },
    _regenerating: { state: true },
    _error: { state: true },
  };

  constructor() {
    super();
    this.context = null;
    this.daFetch = null;
    this.slug = null;
    this.page = null;
    this.creativeDirection = null;
    this.asset = null;
    this.regenerate = null;
    this._imageUrl = '';
    this._imageError = null;
    this._loadingImage = false;
    this._regenerating = false;
    this._error = null;
    this._blob = null;
    this._imageKey = '';
  }

  createRenderRoot() {
    return this;
  }

  // --- open / close: the interface the grid (#61) and the wiring (#64) drive ---

  /**
   * Show an asset. The owner may also just set `.asset`; this is the imperative
   * door for a grid that opens the view on a click.
   * @param {object} asset - an assets-sheet row (#58)
   */
  open(asset) {
    this.asset = asset || null;
    this._error = null;
  }

  /** Put the view away and tell the owner, so it can drop its selection. */
  close() {
    this.asset = null;
    this._error = null;
    this.dispatchEvent(new CustomEvent('detail-close', { bubbles: true, composed: true }));
  }

  updated(changed) {
    // A freshly opened dialog takes focus, so Escape closes it and a screen
    // reader lands on the asset rather than on the page behind it.
    if (changed.has('asset') && this.asset) this.querySelector('.cw-ad-card')?.focus();
    this.loadImage();
  }

  disconnectedCallback() {
    this.releaseImage();
    super.disconnectedCallback();
  }

  releaseImage() {
    if (this._imageUrl) URL.revokeObjectURL(this._imageUrl);
    this._imageUrl = '';
    this._blob = null;
  }

  // Read the bytes once per address: the object URL is both what the view shows
  // and what Download saves. It re-runs only when the addresses change, so a
  // re-render does not re-fetch a megabyte - and a Regenerate does, because the
  // durable address carries the row's timestamp (`imageCandidates`). A read the
  // producer outran is dropped by the key check rather than shown late.
  async loadImage() {
    const candidates = imageCandidates(this.asset);
    const key = candidates.map((c) => c.url).join('|');
    if (key === this._imageKey) return;
    this._imageKey = key;
    this.releaseImage();
    this._imageError = null;
    if (!candidates.length) return;
    this._loadingImage = true;
    try {
      const { blob, error } = await readBytes(candidates, this.daFetch);
      if (key !== this._imageKey) return;
      if (!blob) {
        this._imageError = error;
        return;
      }
      this._blob = blob;
      this._imageUrl = URL.createObjectURL(blob);
    } finally {
      // A newer read owns the flag once it has started.
      if (key === this._imageKey) this._loadingImage = false;
    }
  }

  // --- actions ---

  // Regenerate exactly this slot. The owner's own path wins when it passes one;
  // otherwise the default is the grid's: one AO turn for the new image, then
  // the swap, which stores the bytes in DA, rewrites that `<img>`, re-previews
  // and saves the row by slot.
  async runRegenerate() {
    if (this._regenerating || !this.asset) return;
    this._regenerating = true;
    this._error = null;
    try {
      const next = typeof this.regenerate === 'function'
        ? await this.regenerate(this.asset)
        : await this.generateAndSwap();
      if (next) {
        this.asset = next;
        this.dispatchEvent(new CustomEvent('asset-changed', {
          detail: { asset: next }, bubbles: true, composed: true,
        }));
      }
    } finally {
      this._regenerating = false;
    }
  }

  // The default Regenerate. Never throws: a failed generation keeps the row on
  // screen untouched, and a failed swap still records the new image so the
  // producer does not lose it.
  async generateAndSwap() {
    const result = await generateAsset(this.context, regenerationJob(
      this.asset,
      this.creativeDirection,
    ));
    if (result.status === FAILED || !result.sourceUrl) {
      this._error = result.error || 'The image could not be generated.';
      return null;
    }
    const row = assetRow(this.asset, result, this.creativeDirection);

    const swap = await swapAssetsIntoPage(this.context, this.daFetch, {
      slug: this.slug,
      path: this.page?.path,
      assets: [row],
    });
    const swapped = swap.assets?.find((r) => Number(r.slot) === row.slot);
    if (swap.status === FAILED) {
      this._error = swap.error || 'The new image was not put on the page.';
      // The swap saves nothing when it fails, so the new image is recorded here
      // instead: without it the producer would pay for a generation twice.
      return this.persist(row);
    }
    this._error = swap.error || null;
    return swapped ? { ...row, mediaUrl: swapped.mediaUrl || '' } : row;
  }

  // Store one row on its own, for the swap-failed path. A failed save is a soft
  // error too: the row still goes back to the view so the image is on screen.
  async persist(row) {
    try {
      await saveAssets(this.context, this.daFetch, this.slug, { assets: [row] });
    } catch (e) {
      this._error = `${this._error ? `${this._error} ` : ''}The project record was not updated: ${e.message}`;
    }
    return row;
  }

  // Save the bytes the view already holds. No proxy and no second fetch: the
  // object URL is same-origin, so the `download` attribute is honoured.
  download() {
    if (!this._blob || !this._imageUrl) {
      this._error = this._imageError || 'There are no image bytes to download yet.';
      return;
    }
    const link = document.createElement('a');
    link.href = this._imageUrl;
    link.download = downloadName(this.asset, this.slug, this._blob.type);
    document.body.append(link);
    link.click();
    link.remove();
  }

  // Hand the asset to the "Ask anything" rail, framed as a change request; the
  // shell routes `add-to-chat` to the rail (#36).
  addToChat() {
    const text = composeAssetMessage(this.asset, assetTitle(this.asset));
    if (!text) return;
    this.dispatchEvent(new CustomEvent('add-to-chat', {
      detail: { text, lead: ASSET_CHAT_LEAD }, bubbles: true, composed: true,
    }));
  }

  onKeydown(e) {
    if (e.key === 'Escape') this.close();
  }

  // --- render ---

  renderImage() {
    if (this._imageUrl) {
      return html`<img class="cw-ad-image" src=${this._imageUrl} alt=${this.asset?.alt || ''}>`;
    }
    if (this._loadingImage) return html`<p class="cw-muted">Loading the image...</p>`;
    return html`<p class="cw-muted">${this._imageError || 'This slot has no image yet.'}</p>`;
  }

  renderFields() {
    return html`
      <dl class="cw-ad-fields">
        ${detailFields(this.asset).map((f) => html`
          <div class="cw-ad-field">
            <dt class="cw-ad-label">${f.label}</dt>
            <dd class="cw-ad-value ${f.missing ? 'is-missing' : ''}">
              ${f.missing ? f.placeholder : f.value}
              ${f.note ? html`<span class="cw-muted cw-ad-note">${f.note}</span>` : ''}
            </dd>
          </div>`)}
      </dl>`;
  }

  render() {
    if (!this.asset) return '';
    const title = assetTitle(this.asset);
    return html`
      <div class="cw-ad-scrim" @click=${() => this.close()}></div>
      <div class="cw-ad-card" role="dialog" aria-modal="true" aria-label=${title}
        tabindex="-1" @keydown=${(e) => this.onKeydown(e)}>
        <div class="cw-cn-header">
          <h3 class="cw-kw-title">${title}</h3>
          <button class="nx-action-btn nx-btn-sm" aria-label="Close the asset details"
            @click=${() => this.close()}>Close</button>
        </div>
        <div class="cw-ad-body">
          <div class="cw-ad-figure">${this.renderImage()}</div>
          ${this.renderFields()}
        </div>
        ${this._regenerating ? html`<p class="cw-muted">Generating a new image...</p>` : ''}
        ${this._error ? html`<p class="cw-error">${this._error}</p>` : ''}
        <div class="cw-ad-actions">
          <button class="nx-action-btn" ?disabled=${this._regenerating}
            @click=${() => this.runRegenerate()}>Regenerate</button>
          <button class="nx-action-btn" ?disabled=${!this._imageUrl}
            @click=${() => this.download()}>Download</button>
          <button class="nx-action-btn" @click=${() => this.addToChat()}>Add to chat</button>
        </div>
      </div>`;
  }
}

customElements.define('da-asset-detail', DaAssetDetail);
