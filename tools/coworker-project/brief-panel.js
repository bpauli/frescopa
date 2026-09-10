/* eslint-disable no-underscore-dangle */
// Stage 3 "Brief" editor panel (ticket #33).
//
// The center editor for a page brief: a title <input> and a plain markdown
// <textarea> body (no rich-text toolbar). On first open it seeds from the brief
// prop and, when the body is empty, auto-generates one with the Coworker (AO)
// from the primary keyword + creative direction (brief-contracts.js
// generateBrief), with a Regenerate action. "Save changes" persists
// `brief.{title,body}` (stage-state.js saveBrief, which merges so the
// destinationUrl + links parts survive) and emits `brief-changed`. "Add to chat"
// emits `add-to-chat` with the brief as text for the shell to feed the chat rail.
// generateBrief never throws, so an AO failure leaves an empty editable brief
// plus a soft error - the panel never blocks.

import { LitElement, html } from 'da-lit';
import { generateBrief } from './brief-contracts.js';
import { saveBrief } from './stage-state.js';
import { composeChatText } from './brief-logic.js';

class DaBriefPanel extends LitElement {
  static properties = {
    context: { attribute: false },
    daFetch: { attribute: false },
    slug: { attribute: false },
    keyword: { attribute: false },
    brief: { attribute: false },
    creativeDirection: { attribute: false },
    _title: { state: true },
    _body: { state: true },
    _generating: { state: true },
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
    this.creativeDirection = null;
    this._title = '';
    this._body = '';
    this._generating = false;
    this._saving = false;
    this._error = null;
  }

  createRenderRoot() {
    return this;
  }

  firstUpdated() {
    const b = this.brief || {};
    this._title = b.title || '';
    this._body = b.body || '';
    // Auto-generate only when there is no body yet; an existing brief opens as-is.
    if (!this._body.trim()) this.generate();
  }

  // Auto-run on open when empty; Regenerate re-runs. generateBrief never throws:
  // on failure it returns an empty brief plus a soft error, so the editor stays
  // usable.
  async generate() {
    const kw = (this.keyword || '').trim();
    if (!kw) { this._error = 'Set a primary keyword first.'; return; }
    this._generating = true;
    this._error = null;
    try {
      const res = await generateBrief(this.context, this.keyword, this.creativeDirection);
      this._title = res.title;
      this._body = res.body;
      if (res.error) this._error = res.error;
    } finally {
      this._generating = false;
    }
  }

  async save() {
    this._saving = true;
    this._error = null;
    try {
      const brief = await saveBrief(this.context, this.daFetch, this.slug, {
        title: this._title, body: this._body,
      });
      this.brief = brief;
      this.dispatchEvent(new CustomEvent('brief-changed', {
        detail: { brief }, bubbles: true, composed: true,
      }));
    } catch (e) {
      this._error = e.message;
    } finally {
      this._saving = false;
    }
  }

  addToChat() {
    const text = composeChatText(this._title, this._body);
    this.dispatchEvent(new CustomEvent('add-to-chat', {
      detail: { text }, bubbles: true, composed: true,
    }));
  }

  render() {
    const busy = this._generating || this._saving;
    return html`
      <div class="cw-cn-header">
        <h3 class="cw-kw-title">Brief</h3>
        <button class="nx-action-btn nx-btn-sm" ?disabled=${busy}
          @click=${() => this.generate()}>Regenerate</button>
      </div>
      <p class="cw-kw-label">Edit the page brief. Title and markdown body are editable.</p>
      ${this._generating ? html`<p class="cw-muted">Generating brief...</p>` : ''}
      <div class="cw-brief-field">
        <input type="text" class="cw-brief-title-input" placeholder="Brief title"
          .value=${this._title} ?disabled=${this._generating}
          @input=${(e) => { this._title = e.target.value; }} />
      </div>
      <div class="cw-brief-field">
        <textarea class="cw-brief-body" placeholder="Brief body (markdown)"
          .value=${this._body} ?disabled=${this._generating}
          @input=${(e) => { this._body = e.target.value; }}></textarea>
      </div>
      <div class="cw-brief-controls">
        <button class="nx-action-btn" ?disabled=${busy} @click=${() => this.save()}>Save changes</button>
        <button class="nx-action-btn" ?disabled=${busy} @click=${() => this.addToChat()}>Add to chat</button>
        ${this._saving ? html`<span class="cw-saving"><span class="nx-loading-spinner"></span>Saving...</span>` : ''}
      </div>
      ${this._error ? html`<p class="cw-error">${this._error}</p>` : ''}`;
  }
}

customElements.define('da-brief-panel', DaBriefPanel);
