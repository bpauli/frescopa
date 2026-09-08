import DA_SDK from 'https://da.live/nx/utils/sdk.js';
import { LitElement, html } from 'da-lit';
import { fetchTemplates } from './templates.js';

// Coworker Projects app. Round one: templates panel picker, then (later
// tickets) the projects list, the Add Project wizard, and the project view.
//
// NOTE: never name a method `update` - that is a reserved LitElement lifecycle
// method and shadows render(), so the component silently fails to paint.

class DaCoworkerProject extends LitElement {
  static properties = {
    context: { attribute: false },
    token: { attribute: false },
    actions: { attribute: false },
    _templates: { state: true },
    _loading: { state: true },
    _error: { state: true },
    _selected: { state: true },
  };

  constructor() {
    super();
    this.context = null;
    this.token = null;
    this.actions = null;
    this._templates = [];
    this._loading = true;
    this._error = null;
    this._selected = null;
  }

  // Render without shadow DOM so page-level styles can reach the app later.
  createRenderRoot() {
    return this;
  }

  firstUpdated() {
    this.loadTemplates();
  }

  async loadTemplates() {
    this._loading = true;
    this._error = null;
    try {
      this._templates = await fetchTemplates(this.context, this.actions?.daFetch);
    } catch (e) {
      this._error = e.message;
      this._templates = [];
    } finally {
      this._loading = false;
    }
  }

  renderTemplates() {
    if (this._loading) return html`<p>Loading templates...</p>`;
    if (this._error) {
      return html`<p style="color:#b5121b;">Could not load templates: ${this._error}</p>`;
    }
    if (!this._templates.length) {
      return html`<p>No templates found for this site.</p>`;
    }
    return html`
      <fieldset>
        <legend>Choose a template</legend>
        ${this._templates.map((t) => html`
          <label style="display:block; margin:.25rem 0;">
            <input type="radio" name="tpl" .value=${t.url}
              .checked=${this._selected === t.url}
              @change=${() => { this._selected = t.url; }} />
            ${t.name}
          </label>`)}
      </fieldset>
      <p>Selected: <code>${this._selected ?? 'none'}</code></p>`;
  }

  render() {
    return html`
      <main style="font-family: system-ui, sans-serif; padding: 2rem; max-width: 40rem;">
        <h1>Coworker Projects</h1>
        <p>Pick a template to base a project on.</p>
        ${this.renderTemplates()}
      </main>`;
  }
}

customElements.define('da-coworker-project', DaCoworkerProject);

(async function init() {
  const { context, token, actions } = await DA_SDK;
  const app = document.createElement('da-coworker-project');
  app.context = context;
  app.token = token;
  app.actions = actions;
  document.body.append(app);
}());
