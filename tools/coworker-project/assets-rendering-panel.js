// Stage 5 "Assets Rendering" panel (ticket #63, FR-44) - the right-hand view
// of the Asset Generation stage: the generated page rendered with its REAL
// assets.
//
// This is NOT a second preview implementation. The whole render - the real
// aem.page iframe scaled into the panel, the Desktop/Mobile breakpoint
// selector, Open in AEM, the Draft status pill - is the Stage 4 Page Preview
// panel (#42, #45) running in its viewer mode; this element only composes it
// under the Stage 5 name and keeps Stage 4's authoring machinery out of the
// rendering view: no Regenerate (a page re-roll would wipe the swapped
// assets), no Content tab, and no Locale selector (that is Stage 6
// Localization).
//
// Refresh: after the Generated Assets panel (#61) swaps the real images into
// the page doc and re-previews it (#60), the producer re-loads this embed with
// the Refresh action in the header. The same re-load is drivable from the
// shell through the public `refresh()` method, so the wiring ticket (#64) can
// refresh this view when the grid emits `assets-changed`. The panel
// deliberately does NOT listen for that event itself: sibling panels never
// see each other's events, and a mid-generation `assets-changed` would reload
// a page whose swap is still in flight.

import { LitElement, html } from 'da-lit';
import './page-preview-panel.js';

class DaAssetsRenderingPanel extends LitElement {
  static properties = {
    context: { attribute: false },
    daFetch: { attribute: false },
    slug: { attribute: false },
    brief: { attribute: false },
    page: { attribute: false },
  };

  constructor() {
    super();
    this.context = null;
    this.daFetch = null;
    this.slug = null;
    this.brief = null;
    this.page = null;
  }

  createRenderRoot() {
    return this;
  }

  /**
   * Re-load the embedded page render, e.g. after the Generated Assets panel
   * swapped real images into the page doc and re-previewed it. Public on
   * purpose: the shell (#64) calls it when the grid emits `assets-changed`.
   * Safe in any state - the preview ignores it while there is no page.
   */
  refresh() {
    this.querySelector('da-page-preview-panel')?.refresh();
  }

  render() {
    return html`
      <da-page-preview-panel
        .viewer=${true}
        .heading=${'Assets Rendering'}
        .context=${this.context}
        .daFetch=${this.daFetch}
        .slug=${this.slug}
        .brief=${this.brief}
        .page=${this.page}></da-page-preview-panel>`;
  }
}

customElements.define('da-assets-rendering-panel', DaAssetsRenderingPanel);
