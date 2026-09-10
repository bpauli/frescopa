/* eslint-disable no-underscore-dangle */
// Stage 2 "Base Page Template" picker (ticket #24).
//
// Lists the site's real base page templates (templates.js fetchTemplates) as
// cards, badges the one the Coworker (AO) recommends for the primary keyword
// (creative-direction.js recommendTemplate, best-effort - no badge if AO
// abstains or is down), and lets the producer pick one. The picker works even
// with no AO: the list comes from the template config. Every pick persists
// `creativeDirection.baseTemplate` (stage-state.js saveCreativeDirection, which
// merges so the style/palette selections are preserved) and emits
// `creative-direction-changed` so the shell keeps its cache.

import { LitElement, html } from 'da-lit';
import { fetchTemplates } from './templates.js';
import { recommendTemplate } from './creative-direction.js';
import { saveCreativeDirection } from './stage-state.js';
import { withRecommended } from './base-template-logic.js';

class DaBaseTemplatePanel extends LitElement {
  static properties = {
    context: { attribute: false },
    daFetch: { attribute: false },
    slug: { attribute: false },
    keyword: { attribute: false },
    creativeDirection: { attribute: false },
    _templates: { state: true },
    _selectedName: { state: true },
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
    this.creativeDirection = null;
    this._templates = [];
    this._selectedName = '';
    this._loading = false;
    this._saving = false;
    this._error = null;
  }

  // Light DOM so the app stylesheet reaches the panel.
  createRenderRoot() {
    return this;
  }

  firstUpdated() {
    this._selectedName = this.creativeDirection?.baseTemplate?.name || '';
    this.load();
  }

  // Load the template list, then layer the best-effort AO recommendation on top.
  async load() {
    this._loading = true;
    this._error = null;
    try {
      const templates = await fetchTemplates(this.context, this.daFetch);
      const names = templates.map((t) => t.name);
      let recommended = '';
      const kw = (this.keyword || '').trim();
      if (kw && names.length) {
        const res = await recommendTemplate(this.context, kw, names);
        recommended = res.recommended || '';
      }
      this._templates = withRecommended(templates, recommended);
      if (!this._templates.length) this._error = 'No base page templates found for this site.';
    } catch (e) {
      this._templates = [];
      this._error = e.message || 'Could not load templates.';
    } finally {
      this._loading = false;
    }
  }

  async selectTemplate(t) {
    this._selectedName = t.name;
    this._saving = true;
    this._error = null;
    try {
      const baseTemplate = { name: t.name, url: t.url, recommended: t.recommended };
      const creativeDirection = await saveCreativeDirection(
        this.context, this.daFetch, this.slug, { baseTemplate },
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

  renderCard(t) {
    const selected = t.name === this._selectedName;
    return html`
      <button class="cw-bt-card ${selected ? 'is-selected' : ''}" aria-pressed=${selected}
        @click=${() => this.selectTemplate(t)}>
        <span class="cw-bt-name">${t.name}</span>
        ${t.recommended ? html`<span class="cw-badge cw-bt-badge">Recommended</span>` : ''}
      </button>`;
  }

  renderBody() {
    if (this._loading) return html`<p class="cw-muted">Loading templates...</p>`;
    if (!this._templates.length) return html`<p class="cw-muted">No base page templates found.</p>`;
    return html`<div class="cw-bt-grid">${this._templates.map((t) => this.renderCard(t))}</div>`;
  }

  render() {
    return html`
      <h3 class="cw-kw-title">Base Page Template</h3>
      <p class="cw-kw-label">Choose the base page template for this page</p>
      ${this.renderBody()}
      ${this._saving ? html`<span class="cw-saving"><span class="nx-loading-spinner"></span>Saving...</span>` : ''}
      ${this._error ? html`<p class="cw-error">${this._error}</p>` : ''}`;
  }
}

customElements.define('da-base-template-panel', DaBaseTemplatePanel);
