/* eslint-disable no-underscore-dangle */
// Stage 3 "Links & Call-to-actions" panel (ticket #35).
//
// Shows the Coworker (AO) suggested CTAs for the primary keyword (grounded in the
// current brief) via brief-contracts.js suggestLinks, auto-run on first open with
// a Refresh. Below the suggestions is an editable CTA list seeded from
// `brief.links`: each row is a label + target URL + optional description, with add
// row, add-a-suggestion, edit, and remove. Each target URL is format-validated
// (brief-links-logic.js isValidLinkUrl); invalid rows are flagged and never
// persisted. Save persists only the clean rows via stage-state.js saveBrief
// (which merges so the title/body/destinationUrl survive) and emits
// `brief-changed` with the merged brief so the shell keeps its cache.

import { LitElement, html } from 'da-lit';
import { suggestLinks } from './brief-contracts.js';
import { saveBrief } from './stage-state.js';
import {
  addLink, removeLink, updateLink, isValidLinkUrl, cleanLinks,
} from './brief-links-logic.js';

class DaBriefLinksPanel extends LitElement {
  static properties = {
    context: { attribute: false },
    daFetch: { attribute: false },
    slug: { attribute: false },
    keyword: { attribute: false },
    brief: { attribute: false },
    _rows: { state: true },
    _suggestions: { state: true },
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
    this._rows = [];
    this._suggestions = [];
    this._loading = false;
    this._saving = false;
    this._error = null;
  }

  createRenderRoot() {
    return this;
  }

  firstUpdated() {
    // Seed the editable list from the current brief (a copy - never mutate props).
    this._rows = (this.brief?.links || []).map((l) => ({
      label: l.label || '',
      url: l.url || '',
      description: l.description || '',
    }));
    this.loadSuggestions();
  }

  // Auto-run on open; Refresh re-runs. Suggestions are not persisted, so each
  // fresh mount re-asks the Coworker.
  async loadSuggestions() {
    const kw = (this.keyword || '').trim();
    if (!kw) { this._error = 'Set a primary keyword first.'; return; }
    this._loading = true;
    this._error = null;
    try {
      const res = await suggestLinks(this.context, kw, this.brief);
      this._suggestions = res.links;
      if (!this._suggestions.length) this._error = res.error || 'No CTA suggestions came back.';
    } finally {
      this._loading = false;
    }
  }

  // --- editable list ---
  addSuggested(link) {
    this._rows = [...this._rows, {
      label: link.label || '',
      url: link.url || '',
      description: link.description || '',
    }];
  }

  addRow() {
    this._rows = addLink(this._rows);
  }

  removeRow(index) {
    this._rows = removeLink(this._rows, index);
  }

  editRow(index, patch) {
    this._rows = updateLink(this._rows, index, patch);
  }

  async save() {
    const links = cleanLinks(this._rows);
    this._saving = true;
    this._error = null;
    try {
      const brief = await saveBrief(this.context, this.daFetch, this.slug, { links });
      this.brief = brief;
      // Reseed from the cleaned, persisted list so the view matches what was saved.
      this._rows = links.map((l) => ({ ...l }));
      this.dispatchEvent(new CustomEvent('brief-changed', {
        detail: { brief }, bubbles: true, composed: true,
      }));
    } catch (e) {
      this._error = e.message;
    } finally {
      this._saving = false;
    }
  }

  renderSuggestion(link) {
    return html`
      <div class="cw-links-card">
        <span class="cw-vs-name">${link.label}</span>
        <span class="cw-links-url">${link.url}</span>
        ${link.description ? html`<span class="cw-vs-desc">${link.description}</span>` : ''}
        <button class="nx-action-btn nx-btn-sm" @click=${() => this.addSuggested(link)}>Add to list</button>
      </div>`;
  }

  renderSuggestions() {
    if (this._loading) return html`<p class="cw-muted">Loading CTA suggestions...</p>`;
    if (!this._suggestions.length) return html`<p class="cw-muted">No suggestions. Add rows below.</p>`;
    return html`<div class="cw-links-grid">${this._suggestions.map((s) => this.renderSuggestion(s))}</div>`;
  }

  renderRow(row, index) {
    const invalid = !!(row.url || '').trim() && !isValidLinkUrl(row.url);
    return html`
      <div class="cw-links-row ${invalid ? 'is-invalid' : ''}">
        <input type="text" class="cw-links-label" placeholder="Label" .value=${row.label || ''}
          @input=${(e) => this.editRow(index, { label: e.target.value })} />
        <input type="text" class="cw-links-target" placeholder="/path or https://..." .value=${row.url || ''}
          @input=${(e) => this.editRow(index, { url: e.target.value })} />
        <input type="text" class="cw-links-desc" placeholder="Description (optional)"
          .value=${row.description || ''}
          @input=${(e) => this.editRow(index, { description: e.target.value })} />
        <button class="cw-kw-x" title="Remove" @click=${() => this.removeRow(index)}>&times;</button>
      </div>`;
  }

  renderList() {
    if (!this._rows.length) {
      return html`<p class="cw-muted">No links yet. Add a suggestion above or a blank row.</p>`;
    }
    return html`<div class="cw-links-list">
      ${this._rows.map((row, i) => this.renderRow(row, i))}
    </div>`;
  }

  render() {
    return html`
      <div class="cw-cn-header">
        <h3 class="cw-kw-title">Links &amp; Call-to-actions</h3>
        <button class="nx-action-btn nx-btn-sm" ?disabled=${this._loading}
          @click=${() => this.loadSuggestions()}>${this._suggestions.length ? 'Refresh' : 'Suggest'}</button>
      </div>
      <p class="cw-kw-label">Add the links and calls-to-action for the page</p>
      ${this.renderSuggestions()}
      ${this.renderList()}
      <div class="cw-links-actions">
        <button class="nx-action-btn nx-btn-sm" @click=${() => this.addRow()}>Add row</button>
        <button class="nx-action-btn" ?disabled=${this._saving} @click=${() => this.save()}>Save links</button>
      </div>
      ${this._saving ? html`<span class="cw-saving"><span class="nx-loading-spinner"></span>Saving...</span>` : ''}
      ${this._error ? html`<p class="cw-error">${this._error}</p>` : ''}`;
  }
}

customElements.define('da-brief-links-panel', DaBriefLinksPanel);
