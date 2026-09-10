/* eslint-disable no-underscore-dangle */
// Stage 2 "Color Palette" panel (ticket #26).
//
// Shows the Coworker (AO) suggested color palettes for the primary keyword
// (creative-direction.js suggestCreativeDirection) as name + description +
// swatch cards, auto-run on first open with a Refresh, plus a Custom Palette
// builder: add hex colors (a native picker assists, a hex field is validated)
// as removable swatch chips, name it, and use it. One active selection across
// suggested and custom. Every pick persists `creativeDirection.colorPalette`
// (stage-state.js saveCreativeDirection, which merges so the template + style
// parts survive) and emits `creative-direction-changed`.

import { LitElement, html } from 'da-lit';
import { suggestCreativeDirection } from './creative-direction.js';
import { saveCreativeDirection } from './stage-state.js';
import {
  addColor, removeColor, suggestedPalette, customPalette, isSuggestedSelected,
} from './color-palette-logic.js';

class DaColorPalettePanel extends LitElement {
  static properties = {
    context: { attribute: false },
    daFetch: { attribute: false },
    slug: { attribute: false },
    keyword: { attribute: false },
    colorPalette: { attribute: false },
    _palettes: { state: true },
    _selection: { state: true },
    _customColors: { state: true },
    _customName: { state: true },
    _pending: { state: true },
    _hexError: { state: true },
    _loading: { state: true },
    _saving: { state: true },
    _error: { state: true },
  };

  constructor() {
    super();
    this.context = null;
    this.daFetch = null;
    this.slug = null;
    this.keyword = '';
    this.colorPalette = null;
    this._palettes = [];
    this._selection = null;
    this._customColors = [];
    this._customName = '';
    this._pending = '#888888';
    this._hexError = '';
    this._loading = false;
    this._saving = false;
    this._error = null;
  }

  createRenderRoot() {
    return this;
  }

  firstUpdated() {
    const p = this.colorPalette;
    if (p && (p.name || p.colors?.length)) {
      this._selection = p;
      if (p.source === 'custom') {
        this._customColors = [...(p.colors || [])];
        this._customName = p.name === 'Custom' ? '' : (p.name || '');
      }
    }
    this.loadSuggestions();
  }

  async loadSuggestions() {
    const kw = (this.keyword || '').trim();
    if (!kw) { this._error = 'Set a primary keyword first.'; return; }
    this._loading = true;
    this._error = null;
    try {
      const res = await suggestCreativeDirection(this.context, kw);
      this._palettes = res.colorPalettes;
      if (!this._palettes.length) this._error = res.error || 'No color palettes came back.';
    } finally {
      this._loading = false;
    }
  }

  async persist(selection) {
    this._selection = selection;
    this._saving = true;
    this._error = null;
    try {
      const creativeDirection = await saveCreativeDirection(
        this.context, this.daFetch, this.slug, { colorPalette: selection },
      );
      this.dispatchEvent(new CustomEvent('creative-direction-changed', {
        detail: { creativeDirection }, bubbles: true, composed: true,
      }));
    } catch (e) {
      this._error = e.message;
    } finally {
      this._saving = false;
    }
  }

  selectSuggested(palette) {
    this.persist(suggestedPalette(palette));
  }

  // --- custom palette builder ---
  addPending() {
    const next = addColor(this._customColors, this._pending);
    if (next === this._customColors) {
      this._hexError = 'Enter a valid hex color (up to 8, no duplicates).';
      return;
    }
    this._hexError = '';
    this._customColors = next;
  }

  removeCustom(hex) {
    this._customColors = removeColor(this._customColors, hex);
  }

  applyCustom() {
    const selection = customPalette(this._customName, this._customColors);
    if (selection) this.persist(selection);
  }

  renderSwatches(colors) {
    return html`<span class="cw-cp-swatches">
      ${colors.map((c) => html`<span class="cw-cp-swatch" style="background:${c}" title=${c}></span>`)}
    </span>`;
  }

  renderCard(palette) {
    const selected = isSuggestedSelected(this._selection, palette);
    return html`
      <button class="cw-cp-card ${selected ? 'is-selected' : ''}" aria-pressed=${selected}
        @click=${() => this.selectSuggested(palette)}>
        <span class="cw-vs-name">${palette.name}</span>
        ${palette.description ? html`<span class="cw-vs-desc">${palette.description}</span>` : ''}
        ${this.renderSwatches(palette.colors)}
      </button>`;
  }

  renderSuggestions() {
    if (this._loading) return html`<p class="cw-muted">Loading color palettes...</p>`;
    if (!this._palettes.length) return html`<p class="cw-muted">No suggestions. Build a custom palette below.</p>`;
    return html`<div class="cw-cp-grid">${this._palettes.map((p) => this.renderCard(p))}</div>`;
  }

  renderCustom() {
    const customActive = this._selection?.source === 'custom';
    return html`
      <div class="cw-cp-custom ${customActive ? 'is-selected' : ''}">
        <p class="cw-kw-sub">Custom Palette</p>
        <div class="cw-cp-chips">
          ${this._customColors.length
    ? this._customColors.map((c) => html`
              <span class="cw-cp-chip">
                <span class="cw-cp-swatch" style="background:${c}"></span>${c}
                <button class="cw-kw-x" title="Remove" @click=${() => this.removeCustom(c)}>&times;</button>
              </span>`)
    : html`<span class="cw-muted">No colors yet. Add hex colors below.</span>`}
        </div>
        <div class="cw-cp-add">
          <input type="color" .value=${this._pending} @input=${(e) => { this._pending = e.target.value; }} />
          <input type="text" class="cw-cp-hex" placeholder="#rrggbb" .value=${this._pending}
            @input=${(e) => { this._pending = e.target.value; }}
            @keydown=${(e) => { if (e.key === 'Enter') { e.preventDefault(); this.addPending(); } }} />
          <button class="nx-action-btn nx-btn-sm" @click=${() => this.addPending()}>Add color</button>
        </div>
        <div class="cw-cp-use">
          <input type="text" placeholder="Palette name (optional)" .value=${this._customName}
            @input=${(e) => { this._customName = e.target.value; }} />
          <button class="nx-action-btn ${customActive ? 'is-selected' : ''}"
            ?disabled=${!this._customColors.length} @click=${() => this.applyCustom()}>Use custom palette</button>
        </div>
        ${this._hexError ? html`<p class="cw-error">${this._hexError}</p>` : ''}
      </div>`;
  }

  render() {
    return html`
      <div class="cw-cn-header">
        <h3 class="cw-kw-title">Color Palette</h3>
        <button class="nx-action-btn nx-btn-sm" ?disabled=${this._loading}
          @click=${() => this.loadSuggestions()}>${this._palettes.length ? 'Refresh' : 'Suggest'}</button>
      </div>
      <p class="cw-kw-label">Select or input the desired asset color palette</p>
      ${this.renderSuggestions()}
      ${this.renderCustom()}
      ${this._saving ? html`<span class="cw-saving"><span class="nx-loading-spinner"></span>Saving...</span>` : ''}
      ${this._error ? html`<p class="cw-error">${this._error}</p>` : ''}`;
  }
}

customElements.define('da-color-palette-panel', DaColorPalettePanel);
