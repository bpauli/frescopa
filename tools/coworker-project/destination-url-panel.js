/* eslint-disable no-underscore-dangle */
// Stage 3 "Destination URL" panel (ticket #34).
//
// A single text field for the page's destination URL, seeded from the current
// brief, saved via stage-state.js saveBrief (which merges so the title/body and
// links parts survive) and emitting `brief-changed` so the shell keeps its
// cache. Coworker (AO) suggested URL slugs (brief-contracts.js suggestUrls) are
// auto-run on open with a Refresh, each offered as a "Select" chip that fills
// the field. The value is format-validated (a site-relative path or an absolute
// http(s) URL, not reachability) before a save.

import { LitElement, html } from 'da-lit';
import { suggestUrls } from './brief-contracts.js';
import { saveBrief } from './stage-state.js';
import { isValidDestinationUrl, normalizeDestinationUrl } from './destination-url-logic.js';

class DaDestinationUrlPanel extends LitElement {
  static properties = {
    context: { attribute: false },
    daFetch: { attribute: false },
    slug: { attribute: false },
    keyword: { attribute: false },
    brief: { attribute: false },
    _value: { state: true },
    _urls: { state: true },
    _hint: { state: true },
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
    this.brief = null;
    this._value = '';
    this._urls = [];
    this._hint = '';
    this._loading = false;
    this._saving = false;
    this._error = null;
  }

  createRenderRoot() {
    return this;
  }

  firstUpdated() {
    this._value = this.brief?.destinationUrl || '';
    // Auto-run on open; Refresh re-runs. Suggestions are not persisted.
    this.loadSuggestions();
  }

  async loadSuggestions() {
    const kw = (this.keyword || '').trim();
    if (!kw) { this._error = 'Set a primary keyword first.'; return; }
    this._loading = true;
    this._error = null;
    try {
      const res = await suggestUrls(this.context, kw);
      this._urls = res.urls;
      if (!this._urls.length) this._error = res.error || 'No URL suggestions came back.';
    } finally {
      this._loading = false;
    }
  }

  select(url) {
    this._value = url;
    this._hint = '';
  }

  async save() {
    if (!isValidDestinationUrl(this._value)) {
      this._hint = 'Enter a site path starting with "/" or a full http(s) URL.';
      return;
    }
    this._hint = '';
    const destinationUrl = normalizeDestinationUrl(this._value);
    this._value = destinationUrl;
    this._saving = true;
    this._error = null;
    try {
      const brief = await saveBrief(this.context, this.daFetch, this.slug, { destinationUrl });
      this.dispatchEvent(new CustomEvent('brief-changed', {
        detail: { brief }, bubbles: true, composed: true,
      }));
    } catch (e) {
      this._error = e.message;
    } finally {
      this._saving = false;
    }
  }

  renderSuggestions() {
    if (this._loading) return html`<p class="cw-muted">Loading URL suggestions...</p>`;
    if (!this._urls.length) return html`<p class="cw-muted">No suggestions yet.</p>`;
    return html`<div class="cw-durl-suggestions">
      ${this._urls.map((u) => html`
        <span class="cw-durl-suggestion">
          <code>${u}</code>
          <button class="nx-action-btn nx-btn-sm" @click=${() => this.select(u)}>Select</button>
        </span>`)}
    </div>`;
  }

  render() {
    return html`
      <div class="cw-cn-header">
        <h3 class="cw-kw-title">Destination URL</h3>
        <button class="nx-action-btn nx-btn-sm" ?disabled=${this._loading}
          @click=${() => this.loadSuggestions()}>${this._urls.length ? 'Refresh' : 'Suggest'}</button>
      </div>
      <p class="cw-kw-label">Select or input the destination URL for the page</p>
      <div class="cw-durl-entry">
        <input type="text" placeholder="/example-path or https://example.com/path"
          .value=${this._value}
          @input=${(e) => { this._value = e.target.value; this._hint = ''; }}
          @keydown=${(e) => { if (e.key === 'Enter') { e.preventDefault(); this.save(); } }} />
        <button class="nx-action-btn" ?disabled=${this._saving} @click=${() => this.save()}>Save</button>
      </div>
      ${this._hint ? html`<p class="cw-durl-hint">${this._hint}</p>` : ''}
      ${this.renderSuggestions()}
      ${this._saving ? html`<span class="cw-saving"><span class="nx-loading-spinner"></span>Saving...</span>` : ''}
      ${this._error ? html`<p class="cw-error">${this._error}</p>` : ''}`;
  }
}

customElements.define('da-destination-url-panel', DaDestinationUrlPanel);
