/* eslint-disable no-underscore-dangle */
// Stage 4 "Page Preview" panel (ticket #42).
//
// The center card of Stage 4: it shows the generated page. On open, when the
// project has no page yet, it generates one with page-generation.js
// `generatePage` from the Stage 3 brief, the Stage 2 creative direction and the
// Stage 3 destination URL, then persists the record with stage-state.js
// `savePage` (which merges, so a concurrent write is not clobbered) and emits
// `page-changed` so the shell keeps its cache. An existing page opens as-is;
// "Regenerate" re-runs the generation.
//
// Two tabs: "Layout" embeds the REAL generated page (#45) - the aem.page render
// of the record's `previewUrl` - in a frame the Desktop/Mobile breakpoint
// selector resizes; "Content" shows the generated page markdown READ-ONLY, read
// from the preview origin. "Open in AEM" links to the record's `editUrl`.
//
// The embed is a plain cross-origin iframe because the preview origin allows
// framing (it sends neither X-Frame-Options nor a CSP `frame-ancestors`), and
// the frame width drives the page's own media queries, so Mobile shows the
// mobile layout. The origin sends no CORS headers, so the app cannot read the
// render back to check it: instead a watchdog waits for the frame `load` event
// and, if it never arrives, offers the preview in a new tab.
//
// The panel never blocks: `generatePage` never throws, a failed run keeps the
// previous record and degrades to a soft error, a failed content read only
// costs the Content tab, and a preview that will not load degrades to that
// note - exactly how brief-panel.js treats a failed brief.

import { LitElement, html } from 'da-lit';
import { generatePage } from './page-generation.js';
import { savePage } from './stage-state.js';
import {
  BREAKPOINTS, frameWidth, hasGeneratedPage, pageStatusLabel, pageTitle, contentUrl,
  pageChanges, embedUrl,
} from './page-preview-logic.js';

// How long the embedded preview may take before the panel offers the fallback.
const EMBED_TIMEOUT_MS = 12000;

class DaPagePreviewPanel extends LitElement {
  static properties = {
    context: { attribute: false },
    daFetch: { attribute: false },
    slug: { attribute: false },
    brief: { attribute: false },
    creativeDirection: { attribute: false },
    page: { attribute: false },
    _page: { state: true },
    _tab: { state: true },
    _breakpoint: { state: true },
    _content: { state: true },
    _loadingContent: { state: true },
    _generating: { state: true },
    _embedState: { state: true },
    _error: { state: true },
  };

  constructor() {
    super();
    this.context = null;
    this.daFetch = null;
    this.slug = null;
    this.brief = null;
    this.creativeDirection = null;
    this.page = null;
    this._page = null;
    this._tab = 'layout';
    this._breakpoint = 'desktop';
    this._content = '';
    this._loadingContent = false;
    this._generating = false;
    this._embedState = 'idle';
    this._embedSrc = '';
    this._embedTimer = 0;
    this._error = null;
  }

  createRenderRoot() {
    return this;
  }

  firstUpdated() {
    this._page = this.page || null;
    // Auto-generate only when there is no page yet; an existing page opens as-is.
    if (!hasGeneratedPage(this._page)) this.generate();
  }

  updated() {
    if (this._tab !== 'layout') return;
    this.watchEmbed(embedUrl(this._page?.previewUrl, this._page?.generatedAt));
  }

  disconnectedCallback() {
    clearTimeout(this._embedTimer);
    super.disconnectedCallback();
  }

  // Start (or restart, after a Regenerate changed the URL) the watchdog for the
  // embedded preview. The frame itself stays put either way: the watchdog only
  // decides whether the panel offers the "open in a new tab" fallback, since a
  // cross-origin frame cannot be inspected from here.
  watchEmbed(src) {
    if (src === this._embedSrc) return;
    this._embedSrc = src;
    clearTimeout(this._embedTimer);
    if (!src) {
      this._embedState = 'idle';
      return;
    }
    this._embedState = 'loading';
    this._embedTimer = setTimeout(() => {
      if (this._embedState === 'loading') this._embedState = 'slow';
    }, EMBED_TIMEOUT_MS);
  }

  // Auto-run on open when empty; Regenerate re-runs. `generatePage` never
  // throws: on failure it returns a Failed result plus a soft error, and the
  // previous record is kept so a bad run cannot lose a good page.
  async generate() {
    this._generating = true;
    this._error = null;
    try {
      const result = await generatePage(this.context, this.daFetch, {
        brief: this.brief,
        creativeDirection: this.creativeDirection,
        path: this.brief?.destinationUrl,
      });
      if (result.error) this._error = result.error;
      if (!hasGeneratedPage(result)) return;
      this._page = pageChanges(result);
      this._content = '';
      await this.persist();
      if (this._tab === 'content') this.loadContent();
    } finally {
      this._generating = false;
    }
  }

  // Persist through savePage so the page record merges into the project record
  // rather than clobbering it, then tell the shell what changed.
  async persist() {
    try {
      const page = await savePage(this.context, this.daFetch, this.slug, this._page);
      this._page = page;
      this.dispatchEvent(new CustomEvent('page-changed', {
        detail: { page }, bubbles: true, composed: true,
      }));
    } catch (e) {
      this._error = e.message;
    }
  }

  // The Content tab reads the generated page markdown from the preview origin.
  // Read-only: nothing here writes back. A failed read is a soft error.
  async loadContent() {
    const url = contentUrl(this._page?.previewUrl);
    if (!url || this._loadingContent) return;
    this._loadingContent = true;
    try {
      const fetcher = typeof this.daFetch === 'function' ? this.daFetch : ((u) => fetch(u));
      const resp = await fetcher(url);
      if (!resp.ok) throw new Error(`${resp.status} ${resp.statusText}`);
      this._content = await resp.text();
    } catch (e) {
      this._error = `Could not load the page content: ${e.message || 'unknown error'}`;
    } finally {
      this._loadingContent = false;
    }
  }

  selectTab(tab) {
    this._tab = tab;
    if (tab === 'content' && !this._content) this.loadContent();
  }

  renderTabs() {
    const tabs = [['layout', 'Layout'], ['content', 'Content']];
    return html`
      <div class="cw-cn-tabs">
        ${tabs.map(([id, label]) => html`
          <button class="cw-cn-tab ${this._tab === id ? 'is-active' : ''}"
            aria-pressed=${this._tab === id}
            @click=${() => this.selectTab(id)}>${label}</button>`)}
      </div>`;
  }

  renderControls() {
    return html`
      <div class="cw-pp-controls">
        <label class="cw-pp-control">
          <span class="cw-muted">Locale</span>
          <select disabled title="Localization arrives in Stage 6">
            <option>English (United States)</option>
          </select>
        </label>
        <label class="cw-pp-control">
          <span class="cw-muted">Breakpoint</span>
          <select .value=${this._breakpoint}
            @change=${(e) => { this._breakpoint = e.target.value; }}>
            ${BREAKPOINTS.map((b) => html`<option value=${b.id}>${b.label}</option>`)}
          </select>
        </label>
      </div>`;
  }

  renderLayout() {
    const width = frameWidth(this._breakpoint);
    const src = embedUrl(this._page?.previewUrl, this._page?.generatedAt);
    if (!src) {
      return html`<div class="cw-pp-frame-wrap">
        <p class="cw-muted">No page preview to show yet.</p></div>`;
    }
    return html`
      <div class="cw-pp-frame-wrap">
        <iframe class="cw-pp-frame" title="Preview of the generated page"
          style="width:${width};" src=${src}
          @load=${() => { this._embedState = 'ready'; clearTimeout(this._embedTimer); }}></iframe>
      </div>
      ${this._embedState === 'slow' ? html`<p class="cw-muted cw-pp-embed-note">
        The preview is not showing here. <a href=${this._page?.previewUrl}
          target="_blank" rel="noopener">Open the preview in a new tab</a>.</p>` : ''}`;
  }

  renderContent() {
    if (this._loadingContent) return html`<p class="cw-muted">Loading page content...</p>`;
    if (!this._content) return html`<p class="cw-muted">No page content yet.</p>`;
    return html`<pre class="cw-pp-content" tabindex="0" aria-readonly="true">${this._content}</pre>`;
  }

  renderBody() {
    if (!hasGeneratedPage(this._page)) {
      if (this._generating) return '';
      return html`<p class="cw-muted">
        No page yet. Use Regenerate once the brief and destination URL are set.</p>`;
    }
    return html`
      ${this.renderTabs()}
      ${this._tab === 'layout' ? this.renderControls() : ''}
      ${this._tab === 'layout' ? this.renderLayout() : this.renderContent()}`;
  }

  render() {
    const editUrl = this._page?.editUrl || '';
    return html`
      <div class="cw-cn-header">
        <h3 class="cw-kw-title">Page Preview</h3>
        <div class="cw-pp-actions">
          ${editUrl ? html`<a class="nx-action-btn nx-btn-sm" href=${editUrl}
            target="_blank" rel="noopener">Open in AEM</a>` : ''}
          <button class="nx-action-btn nx-btn-sm" ?disabled=${this._generating}
            @click=${() => this.generate()}>Regenerate</button>
        </div>
      </div>
      <div class="cw-pp-title-row">
        <span class="cw-pp-title">${pageTitle(this._page, this.brief)}</span>
        <span class="cw-pp-status">${pageStatusLabel(this._page)}</span>
      </div>
      ${this._generating ? html`<p class="cw-muted">Generating the page...</p>` : ''}
      ${this.renderBody()}
      ${this._error ? html`<p class="cw-error">${this._error}</p>` : ''}`;
  }
}

customElements.define('da-page-preview-panel', DaPagePreviewPanel);
