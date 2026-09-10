/* eslint-disable no-underscore-dangle */
// Stage 2 "Visual Style" panel (ticket #25).
//
// Shows the Coworker (AO) suggested visual styles for the primary keyword
// (creative-direction.js suggestCreativeDirection) as name + description cards,
// auto-run on first open with a Refresh, plus an "Input visual style" free-text
// field for a custom style. One active selection across suggested and custom.
// Every pick persists `creativeDirection.visualStyle` (stage-state.js
// saveCreativeDirection, which merges so the template + palette parts survive)
// and emits `creative-direction-changed` so the shell keeps its cache.

import { LitElement, html } from 'da-lit';
import { suggestCreativeDirection } from './creative-direction.js';
import { saveCreativeDirection } from './stage-state.js';
import { suggestedStyle, customStyle, isSuggestedSelected } from './visual-style-logic.js';

class DaVisualStylePanel extends LitElement {
  static properties = {
    context: { attribute: false },
    daFetch: { attribute: false },
    slug: { attribute: false },
    keyword: { attribute: false },
    visualStyle: { attribute: false },
    styles: { attribute: false },
    _styles: { state: true },
    _selection: { state: true },
    _custom: { state: true },
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
    this.visualStyle = null;
    this.styles = null;
    this._styles = [];
    this._selection = null;
    this._custom = '';
    this._loading = false;
    this._saving = false;
    this._error = null;
  }

  createRenderRoot() {
    return this;
  }

  firstUpdated() {
    const v = this.visualStyle;
    if (v && (v.name || v.description)) {
      this._selection = v;
      if (v.source === 'custom') this._custom = v.name;
    }
    // Use the shell-provided suggestions when injected (one shared AO call);
    // otherwise self-fetch (standalone use). Refresh always self-fetches.
    if (this.styles != null) this._styles = this.styles;
    else this.loadSuggestions();
  }

  // Auto-run on open; Refresh re-runs. Suggestions are not persisted, so each
  // fresh mount re-asks (mirrors the demo where styles appear automatically).
  async loadSuggestions() {
    const kw = (this.keyword || '').trim();
    if (!kw) { this._error = 'Set a primary keyword first.'; return; }
    this._loading = true;
    this._error = null;
    try {
      const res = await suggestCreativeDirection(this.context, kw);
      this._styles = res.visualStyles;
      if (!this._styles.length) this._error = res.error || 'No visual styles came back.';
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
        this.context, this.daFetch, this.slug, { visualStyle: selection },
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

  selectSuggested(style) {
    this.persist(suggestedStyle(style));
  }

  applyCustom() {
    const selection = customStyle(this._custom);
    if (selection) this.persist(selection);
  }

  renderCard(style) {
    const selected = isSuggestedSelected(this._selection, style);
    return html`
      <button class="cw-vs-card ${selected ? 'is-selected' : ''}" aria-pressed=${selected}
        @click=${() => this.selectSuggested(style)}>
        <span class="cw-vs-name">${style.name}</span>
        ${style.description ? html`<span class="cw-vs-desc">${style.description}</span>` : ''}
      </button>`;
  }

  renderSuggestions() {
    if (this._loading) return html`<p class="cw-muted">Loading visual styles...</p>`;
    if (!this._styles.length) return html`<p class="cw-muted">No suggestions. Input a visual style below.</p>`;
    return html`<div class="cw-vs-grid">${this._styles.map((s) => this.renderCard(s))}</div>`;
  }

  render() {
    const customActive = this._selection?.source === 'custom';
    return html`
      <div class="cw-cn-header">
        <h3 class="cw-kw-title">Visual Style</h3>
        <button class="nx-action-btn nx-btn-sm" ?disabled=${this._loading}
          @click=${() => this.loadSuggestions()}>${this._styles.length ? 'Refresh' : 'Suggest'}</button>
      </div>
      <p class="cw-kw-label">Select or input the desired asset visual style</p>
      ${this.renderSuggestions()}
      <div class="cw-vs-custom">
        <input type="text" placeholder="Input visual style" .value=${this._custom}
          @input=${(e) => { this._custom = e.target.value; }}
          @keydown=${(e) => { if (e.key === 'Enter') { e.preventDefault(); this.applyCustom(); } }} />
        <button class="nx-action-btn ${customActive ? 'is-selected' : ''}"
          ?disabled=${!this._custom.trim()} @click=${() => this.applyCustom()}>Use</button>
      </div>
      ${this._saving ? html`<span class="cw-saving"><span class="nx-loading-spinner"></span>Saving...</span>` : ''}
      ${this._error ? html`<p class="cw-error">${this._error}</p>` : ''}`;
  }
}

customElements.define('da-visual-style-panel', DaVisualStylePanel);
