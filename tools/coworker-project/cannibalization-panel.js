/* eslint-disable no-underscore-dangle */
// Stage 1 "Keyword Cannibalization Check" panel (ticket #17).
//
// The right half of Stage 1. Runs the cannibalization check (cannibalization.js
// #15) for the current Primary keyword against the site's pages, lists the
// competing pages under All / Flagged / Ignored tabs, and lets the producer move
// a page between Flagged and Ignored. High overlap defaults to Flagged, low to
// Ignored (keep-flagged is the default). Every change persists
// `cannibalization` to the project record and emits `cannibalization-changed`.

import { LitElement, html } from 'da-lit';
import { checkCannibalization, withInitialStatus } from './cannibalization.js';
import { saveCannibalization } from './stage-state.js';

const TABS = [['all', 'All'], ['flagged', 'Flagged'], ['ignored', 'Ignored']];

class DaCannibalizationPanel extends LitElement {
  static properties = {
    context: { attribute: false },
    daFetch: { attribute: false },
    slug: { attribute: false },
    keyword: { attribute: false },
    cannibalization: { attribute: false },
    _competitors: { state: true },
    _checkedAt: { state: true },
    _tab: { state: true },
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
    this.cannibalization = null;
    this._competitors = [];
    this._checkedAt = '';
    this._tab = 'all';
    this._loading = false;
    this._saving = false;
    this._error = null;
  }

  createRenderRoot() {
    return this;
  }

  firstUpdated() {
    const c = this.cannibalization || {};
    this._competitors = [...(c.competitors || [])];
    this._checkedAt = c.checkedAt || '';
  }

  get counts() {
    const flagged = this._competitors.filter((c) => c.status === 'flagged').length;
    return { all: this._competitors.length, flagged, ignored: this._competitors.length - flagged };
  }

  get filtered() {
    if (this._tab === 'all') return this._competitors;
    return this._competitors.filter((c) => c.status === this._tab);
  }

  // Re-run the check for the current Primary keyword, seeding overlap-based
  // status. Prior manual flag/ignore decisions are reset by a Refresh.
  async runCheck() {
    const kw = (this.keyword || '').trim();
    if (!kw) { this._error = 'Set a primary keyword first.'; return; }
    this._loading = true;
    this._error = null;
    try {
      const res = await checkCannibalization(this.context, this.daFetch, kw);
      this._competitors = withInitialStatus(res.competitors);
      this._checkedAt = res.checkedAt;
      this._error = res.error;
      await this.persist();
    } finally {
      this._loading = false;
    }
  }

  async persist() {
    this._saving = true;
    try {
      const value = { checkedAt: this._checkedAt, competitors: this._competitors };
      await saveCannibalization(this.context, this.daFetch, this.slug, value);
      this.dispatchEvent(new CustomEvent('cannibalization-changed', {
        detail: { cannibalization: value }, bubbles: true, composed: true,
      }));
    } catch (e) {
      this._error = e.message;
    } finally {
      this._saving = false;
    }
  }

  setStatus(url, status) {
    this._competitors = this._competitors.map((c) => (c.url === url ? { ...c, status } : c));
    this.persist();
  }

  viewUrl(url) {
    const { org, repo } = this.context || {};
    return `https://da.live/#/${org}/${repo}${url}`;
  }

  renderCard(c) {
    const flagged = c.status === 'flagged';
    return html`
      <div class="cw-cn-card">
        <div class="cw-cn-head">
          <div>
            <strong>${c.title || c.url}</strong>
            <div class="cw-cn-url">${c.url}</div>
          </div>
          <span class="cw-badge cw-cn-badge ${flagged ? 'is-flagged' : 'is-ignored'}">
            ${flagged ? 'Flagged' : 'Ignored'}
          </span>
        </div>
        ${c.reason ? html`<p class="cw-cn-reason">${c.reason}</p>` : ''}
        <div class="cw-cn-card-actions">
          <a class="nx-action-btn nx-btn-sm" href=${this.viewUrl(c.url)} target="_blank" rel="noopener">View page</a>
          ${flagged
    ? html`<button class="nx-action-btn nx-btn-sm" @click=${() => this.setStatus(c.url, 'ignored')}>Ignore</button>`
    : html`<button class="nx-action-btn nx-btn-sm" @click=${() => this.setStatus(c.url, 'flagged')}>Flag</button>`}
        </div>
      </div>`;
  }

  renderTabs() {
    const n = this.counts;
    return html`
      <div class="cw-cn-tabs">
        ${TABS.map(([id, label]) => html`
          <button class="cw-cn-tab ${this._tab === id ? 'is-active' : ''}"
            @click=${() => { this._tab = id; }}>${label} (${n[id]})</button>`)}
      </div>`;
  }

  renderBody() {
    if (this._loading) return html`<p class="cw-muted">Checking against site pages...</p>`;
    if (this._competitors.length) {
      return html`${this.renderTabs()}
        <div class="cw-cn-list">${this.filtered.map((c) => this.renderCard(c))}</div>`;
    }
    return html`<p class="cw-muted">
      ${this.keyword ? 'Run the check to find competing pages.' : 'Set a primary keyword, then run the check.'}
    </p>`;
  }

  render() {
    return html`
      <div class="cw-cn-header">
        <h3 class="cw-kw-title">Keyword Cannibalization Check</h3>
        <button class="nx-action-btn nx-btn-sm" ?disabled=${this._loading}
          @click=${() => this.runCheck()}>${this._competitors.length ? 'Refresh' : 'Run check'}</button>
      </div>
      <p class="cw-kw-label">Check for competing pages with similar keywords</p>
      ${this.renderBody()}
      ${this._saving ? html`<span class="cw-saving"><span class="nx-loading-spinner"></span>Saving...</span>` : ''}
      ${this._error ? html`<p class="cw-error">${this._error}</p>` : ''}`;
  }
}

customElements.define('da-cannibalization-panel', DaCannibalizationPanel);
