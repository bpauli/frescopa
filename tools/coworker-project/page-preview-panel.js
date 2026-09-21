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
// of the record's `previewUrl` - and a Desktop/Mobile breakpoint selector picks
// the viewport it is rendered at; "Content" shows the generated page markdown
// READ-ONLY, read from the preview origin. "Open in AEM" links to the record's
// `editUrl`.
//
// The embed is a plain cross-origin iframe because the preview origin allows
// framing (it sends neither X-Frame-Options nor a CSP `frame-ancestors`). The
// frame is sized to the breakpoint's REAL viewport (1280px desktop, 390px
// mobile) and then CSS-scaled down to the measured panel width, so Desktop
// shows the WHOLE desktop layout as a thumbnail instead of the desktop page
// squeezed into a narrow panel. The scaled render is a picture of the page, so
// it takes no pointer events. The origin sends no CORS headers, so the app
// cannot read the render back to check it: instead a watchdog waits for the
// frame `load` event and, if it never arrives, offers the preview in a new tab.
//
// The panel never blocks: `generatePage` never throws, a failed run keeps the
// previous record and degrades to a soft error, a failed content read only
// costs the Content tab, and a preview that will not load degrades to that
// note - exactly how brief-panel.js treats a failed brief.
//
// VIEWER MODE (ticket #63): Stage 5's Assets Rendering panel
// (assets-rendering-panel.js) composes THIS component with `viewer` set rather
// than building a second preview. The viewer keeps the render - the scaled
// iframe, the breakpoint selector, Open in AEM, the Draft status pill - and
// drops the Stage 4 authoring machinery: no auto-generate, no Regenerate (a
// page re-roll would wipe the assets Stage 5 swapped in), no Content tab, and
// no Locale selector (that arrives with Stage 6 Localization). The header
// action is Refresh, which re-loads the embed after the Generated Assets
// panel (#61) swaps the real images into the page doc and re-previews it
// (#60); the same reload is exposed as the public `refresh()` method so the
// shell (#64) can drive it from the grid's `assets-changed` event.

import { LitElement, html } from 'da-lit';
import { generatePage } from './page-generation.js';
import { savePage } from './stage-state.js';
import {
  BREAKPOINTS, previewFrame, hasGeneratedPage, pageStatusLabel, pageTitle, contentUrl,
  pageChanges, embedUrl, refreshStamp,
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
    heading: { attribute: false },
    viewer: { attribute: false },
    _page: { state: true },
    _tab: { state: true },
    _breakpoint: { state: true },
    _content: { state: true },
    _loadingContent: { state: true },
    _generating: { state: true },
    _embedState: { state: true },
    _frameArea: { state: true },
    _refreshTick: { state: true },
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
    this.heading = '';
    this.viewer = false;
    this._page = null;
    this._tab = 'layout';
    this._breakpoint = 'desktop';
    this._content = '';
    this._loadingContent = false;
    this._generating = false;
    this._embedState = 'idle';
    this._embedSrc = '';
    this._embedTimer = 0;
    this._frameArea = 0;
    this._frameObserver = null;
    this._refreshTick = 0;
    this._error = null;
  }

  createRenderRoot() {
    return this;
  }

  firstUpdated() {
    this._page = this.page || null;
    // Auto-generate only when there is no page yet; an existing page opens
    // as-is. A viewer never generates: it renders the page Stage 4 made.
    if (!this.viewer && !hasGeneratedPage(this._page)) this.generate();
  }

  updated() {
    if (this._tab !== 'layout') return;
    this.watchEmbed(this.embedSrc());
    this.measureFrameArea();
  }

  disconnectedCallback() {
    clearTimeout(this._embedTimer);
    this._frameObserver?.disconnect();
    this._frameObserver = null;
    super.disconnectedCallback();
  }

  // Measure the width the scaled preview may occupy - the frame wrapper's
  // content box - and keep watching it, because the panel width follows the
  // shell layout and the browser window. The scale is derived from this width,
  // so without it the preview could only guess how much it has to shrink.
  measureFrameArea() {
    const wrap = this.querySelector('.cw-pp-frame-wrap');
    if (!wrap) return;
    if (!this._frameObserver && typeof ResizeObserver === 'function') {
      this._frameObserver = new ResizeObserver(() => this.measureFrameArea());
      this._frameObserver.observe(wrap);
    }
    const style = getComputedStyle(wrap);
    const pad = (parseFloat(style.paddingLeft) || 0) + (parseFloat(style.paddingRight) || 0);
    const width = Math.max(0, Math.round(wrap.clientWidth - pad));
    if (width !== this._frameArea) this._frameArea = width;
  }

  // The URL the Layout tab embeds right now: the page's preview render stamped
  // with the generation time AND the refresh tick, so a Regenerate and a
  // Refresh each produce a URL the frame has not loaded yet - and a changed
  // `src` is the only thing that makes an iframe reload.
  embedSrc() {
    const stamp = refreshStamp(this._page?.generatedAt, this._refreshTick);
    return embedUrl(this._page?.previewUrl, stamp);
  }

  // Re-load the embedded preview without touching the page record. The Stage 5
  // Assets Rendering view drives this after an asset swap (#60): the swap
  // already re-previewed the page, so a fresh embed URL is all it takes to
  // show the real images. Public on purpose: the shell (#64) can call it when
  // the Generated Assets grid (#61) emits `assets-changed`. A no-op while
  // there is no generated page.
  refresh() {
    if (!hasGeneratedPage(this._page)) return;
    this._refreshTick += 1;
  }

  // Start (or restart, after a Regenerate or Refresh changed the URL) the
  // watchdog for the embedded preview. The frame itself stays put either way:
  // the watchdog only decides whether the panel offers the "open in a new tab"
  // fallback, since a cross-origin frame cannot be inspected from here.
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
        ${this.viewer ? '' : html`
        <label class="cw-pp-control">
          <span class="cw-muted">Locale</span>
          <select disabled title="Localization arrives in Stage 6">
            <option>English (United States)</option>
          </select>
        </label>`}
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
    const src = this.embedSrc();
    if (!src) {
      return html`<div class="cw-pp-frame-wrap">
        <p class="cw-muted">No page preview to show yet.</p></div>`;
    }
    const box = previewFrame(this._frameArea, this._breakpoint);
    // The box width is capped at 100% of the panel: a fixed px width would widen
    // the Stage 4 grid track that the measurement reads, and the scale would
    // chase its own measurement instead of settling.
    return html`
      <div class="cw-pp-frame-wrap">
        <div class="cw-pp-frame-box"
          style="width:min(100%,${box.boxWidth}px);height:${box.boxHeight}px;">
          <iframe class="cw-pp-frame" title="Preview of the generated page"
            style="width:${box.width}px;height:${box.height}px;transform:scale(${box.scale});"
            src=${src}
            @load=${() => { this._embedState = 'ready'; clearTimeout(this._embedTimer); }}></iframe>
        </div>
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
      if (this.viewer) {
        return html`<p class="cw-muted">No generated page to render yet.</p>`;
      }
      return html`<p class="cw-muted">
        No page yet. Use Regenerate once the brief and destination URL are set.</p>`;
    }
    // A viewer has one job: the rendered page. No tabs, no Content view.
    if (this.viewer) {
      return html`${this.renderControls()}${this.renderLayout()}`;
    }
    return html`
      ${this.renderTabs()}
      ${this._tab === 'layout' ? this.renderControls() : ''}
      ${this._tab === 'layout' ? this.renderLayout() : this.renderContent()}`;
  }

  render() {
    const editUrl = this._page?.editUrl || '';
    const canRefresh = hasGeneratedPage(this._page);
    return html`
      <div class="cw-cn-header">
        <h3 class="cw-kw-title">${this.heading || 'Page Preview'}</h3>
        <div class="cw-pp-actions">
          ${editUrl ? html`<a class="nx-action-btn nx-btn-sm" href=${editUrl}
            target="_blank" rel="noopener">Open in AEM</a>` : ''}
          ${this.viewer
    ? html`<button class="nx-action-btn nx-btn-sm" ?disabled=${!canRefresh}
            @click=${() => this.refresh()}>Refresh</button>`
    : html`<button class="nx-action-btn nx-btn-sm" ?disabled=${this._generating}
            @click=${() => this.generate()}>Regenerate</button>`}
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
