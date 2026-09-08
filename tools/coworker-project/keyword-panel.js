/* eslint-disable no-underscore-dangle */
// Stage 1 "Keyword Input and Selection" panel (ticket #16).
//
// A self-contained element mounted into the stage-runner's Stage 1 slot. The
// producer enters keywords; the first becomes Primary, later ones Secondary, and
// starring an alternate promotes it (exactly one Primary). "Other suggestions"
// come from the keyword-suggestion call (keywords.js #14) and add as Secondary.
// Every change persists `keywords` to the project record (stage-state.js
// saveKeywords) and emits `keywords-changed` so the shell keeps its cache.

import { LitElement, html } from 'da-lit';
import { suggestKeywords } from './keywords.js';
import { saveKeywords } from './stage-state.js';
import {
  primaryOf, addKeyword, setPrimary, removeKeyword,
} from './keyword-logic.js';

const same = (a, b) => a.trim().toLowerCase() === b.trim().toLowerCase();

class DaKeywordPanel extends LitElement {
  static properties = {
    context: { attribute: false },
    daFetch: { attribute: false },
    slug: { attribute: false },
    keywords: { attribute: false },
    _keywords: { state: true },
    _input: { state: true },
    _suggestions: { state: true },
    _loadingSuggestions: { state: true },
    _saving: { state: true },
    _error: { state: true },
  };

  constructor() {
    super();
    this.context = null;
    this.daFetch = null;
    this.slug = null;
    this.keywords = [];
    this._keywords = [];
    this._input = '';
    this._suggestions = [];
    this._loadingSuggestions = false;
    this._saving = false;
    this._error = null;
  }

  // Light DOM so the app stylesheet reaches the panel.
  createRenderRoot() {
    return this;
  }

  firstUpdated() {
    this._keywords = [...(this.keywords || [])];
    this.loadSuggestions();
  }

  get primaryText() {
    const p = primaryOf(this._keywords);
    return p ? p.text : '';
  }

  // Persist the current list and tell the shell.
  async persist() {
    this._saving = true;
    this._error = null;
    try {
      await saveKeywords(this.context, this.daFetch, this.slug, this._keywords);
      this.dispatchEvent(new CustomEvent('keywords-changed', {
        detail: { keywords: this._keywords }, bubbles: true, composed: true,
      }));
    } catch (e) {
      this._error = e.message;
    } finally {
      this._saving = false;
    }
  }

  // Suggestions hang off the Primary keyword; refresh when it changes.
  async loadSuggestions() {
    const primary = this.primaryText;
    if (!primary) { this._suggestions = []; return; }
    this._loadingSuggestions = true;
    try {
      const { suggestions } = await suggestKeywords(this.context, primary);
      const selected = new Set(this._keywords.map((k) => k.text.toLowerCase()));
      this._suggestions = suggestions.filter((s) => !selected.has(s.toLowerCase()));
    } catch {
      this._suggestions = [];
    } finally {
      this._loadingSuggestions = false;
    }
  }

  // --- mutations (each persists; primary changes refresh suggestions) ---
  commit(next, primaryChanged) {
    this._keywords = next;
    this.persist();
    if (primaryChanged) this.loadSuggestions();
  }

  addFromInput() {
    const wasEmpty = this._keywords.length === 0;
    const next = addKeyword(this._keywords, this._input);
    if (next === this._keywords) return;
    this._input = '';
    this.commit(next, wasEmpty);
  }

  addSuggestion(text) {
    this._suggestions = this._suggestions.filter((s) => s !== text);
    this.commit(addKeyword(this._keywords, text), false);
  }

  promote(text) {
    this.commit(setPrimary(this._keywords, text), true);
  }

  remove(text) {
    const wasPrimary = same(this.primaryText, text);
    this.commit(removeKeyword(this._keywords, text), wasPrimary);
  }

  onKeydown(e) {
    if (e.key === 'Enter') { e.preventDefault(); this.addFromInput(); }
  }

  renderChip(k) {
    const isPrimary = k.role === 'primary';
    return html`
      <span class="cw-kw-chip ${isPrimary ? 'is-primary' : ''}">
        <button class="cw-kw-star" title=${isPrimary ? 'Primary keyword' : 'Set as primary'}
          @click=${() => this.promote(k.text)}>${isPrimary ? '★' : '☆'}</button>
        <span class="cw-kw-text">${k.text}</span>
        <button class="cw-kw-x" title="Remove" @click=${() => this.remove(k.text)}>&times;</button>
      </span>`;
  }

  renderSuggestions() {
    if (!this.primaryText) return '';
    return html`
      <p class="cw-kw-sub">Other suggestions based on primary keyword</p>
      ${this._loadingSuggestions
    ? html`<p class="cw-muted">Loading suggestions...</p>`
    : html`<div class="cw-kw-suggestions">
            ${this._suggestions.length
    ? this._suggestions.map((s) => html`
                <button class="cw-kw-suggestion" @click=${() => this.addSuggestion(s)}>+ ${s}</button>`)
    : html`<span class="cw-muted">No suggestions.</span>`}
          </div>`}`;
  }

  render() {
    return html`
      <h3 class="cw-kw-title">Keyword Input and Selection</h3>
      <label class="cw-kw-label" for="cw-kw-input">Input primary and secondary keywords for the page</label>
      <div class="cw-kw-entry">
        <input id="cw-kw-input" type="text" placeholder="Keyword" .value=${this._input}
          @input=${(e) => { this._input = e.target.value; }} @keydown=${(e) => this.onKeydown(e)} />
        <button class="nx-action-btn" ?disabled=${!this._input.trim()} @click=${() => this.addFromInput()}>Add</button>
      </div>
      <div class="cw-kw-chips">
        ${this._keywords.length
    ? this._keywords.map((k) => this.renderChip(k))
    : html`<span class="cw-muted">No keywords yet. Add one to start.</span>`}
      </div>
      <p class="cw-kw-hint">A single keyword defaults to Primary. Star an alternate to make it Primary.</p>
      ${this.renderSuggestions()}
      ${this._saving ? html`<span class="cw-saving"><span class="nx-loading-spinner"></span>Saving...</span>` : ''}
      ${this._error ? html`<p class="cw-error">${this._error}</p>` : ''}`;
  }
}

customElements.define('da-keyword-panel', DaKeywordPanel);
