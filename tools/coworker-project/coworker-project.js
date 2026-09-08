import DA_SDK from 'https://da.live/nx/utils/sdk.js';
import { LitElement, html } from 'da-lit';

// Empty shell for the Coworker Projects app. It boots, wires up the DA SDK,
// and shows the connected DA context so we can confirm the plumbing works.
// Features (projects list, Add Project wizard, project view) land in later tickets.
//
// NOTE: never name a method `update` - that is a reserved LitElement lifecycle
// method and shadows render(), so the component silently fails to paint.

class DaCoworkerProject extends LitElement {
  static properties = {
    context: { attribute: false },
    token: { attribute: false },
    actions: { attribute: false },
  };

  constructor() {
    super();
    this.context = null;
    this.token = null;
    this.actions = null;
  }

  // Render without shadow DOM so page-level styles can reach the app later.
  createRenderRoot() {
    return this;
  }

  renderContext() {
    if (!this.context) return html`<p>Connecting to DA…</p>`;
    const { org, repo, path } = this.context;
    return html`
      <dl class="context">
        <dt>Org</dt><dd><code>${org ?? '-'}</code></dd>
        <dt>Site</dt><dd><code>${repo ?? '-'}</code></dd>
        <dt>Path</dt><dd><code>${path ?? '-'}</code></dd>
      </dl>`;
  }

  render() {
    return html`
      <main style="font-family: system-ui, sans-serif; padding: 2rem; max-width: 40rem;">
        <h1>Coworker Projects</h1>
        <p>Empty shell. The projects list and the Add Project wizard come next.</p>
        ${this.renderContext()}
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
