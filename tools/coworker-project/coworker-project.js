import DA_SDK from 'https://da.live/nx/utils/sdk.js';
import { LitElement, html } from 'da-lit';
import { fetchTemplates } from './templates.js';
import { createProject, slugify } from './project.js';

// Coworker Projects app. Round one: the Add Project wizard (name, description,
// pick a template, create + persist). The projects list landing and the
// read-only project view arrive in later tickets.
//
// NOTE: never name a method `update` - that is a reserved LitElement lifecycle
// method and shadows render(), so the component silently fails to paint.

const STEPS = ['Details', 'Template', 'Review'];

class DaCoworkerProject extends LitElement {
  static properties = {
    context: { attribute: false },
    token: { attribute: false },
    actions: { attribute: false },
    _step: { state: true },
    _values: { state: true },
    _templates: { state: true },
    _loadingTpls: { state: true },
    _creating: { state: true },
    _result: { state: true },
    _error: { state: true },
  };

  constructor() {
    super();
    this.context = null;
    this.token = null;
    this.actions = null;
    this._step = 0;
    this._values = { title: '', description: '', templateId: '', templatePath: '' };
    this._templates = [];
    this._loadingTpls = true;
    this._creating = false;
    this._result = null;
    this._error = null;
  }

  // Render without shadow DOM so page-level styles can reach the app later.
  createRenderRoot() {
    return this;
  }

  firstUpdated() {
    this.loadTemplates();
  }

  async loadTemplates() {
    this._loadingTpls = true;
    try {
      this._templates = await fetchTemplates(this.context, this.actions?.daFetch);
    } catch {
      this._templates = [];
    } finally {
      this._loadingTpls = false;
    }
  }

  get slug() {
    return slugify(this._values.title);
  }

  get stepValid() {
    if (this._step === 0) return this.slug.length > 0;
    if (this._step === 1) return !!this._values.templateId;
    return true;
  }

  // NOTE: not named `update` on purpose (see the top-of-file warning).
  setValues(patch) {
    this._values = { ...this._values, ...patch };
  }

  next() { if (this.stepValid && this._step < STEPS.length - 1) this._step += 1; }

  back() { if (this._step > 0) this._step -= 1; }

  stepClass(i) {
    if (i === this._step) return 'active';
    if (i < this._step) return 'done';
    return '';
  }

  async create() {
    this._creating = true;
    this._error = null;
    try {
      this._result = await createProject(this.context, this.actions.daFetch, this._values);
    } catch (e) {
      this._error = e.message;
    } finally {
      this._creating = false;
    }
  }

  reset() {
    this._step = 0;
    this._values = { title: '', description: '', templateId: '', templatePath: '' };
    this._result = null;
    this._error = null;
  }

  renderIndicator() {
    return html`
      <ol class="steps">
        ${STEPS.map((label, i) => html`<li class=${this.stepClass(i)}>${i + 1}. ${label}</li>`)}
      </ol>`;
  }

  renderTemplateStep() {
    if (this._loadingTpls) return html`<p>Loading templates...</p>`;
    if (!this._templates.length) return html`<p>No templates found for this site.</p>`;
    return html`
      <fieldset>
        <legend>Choose a template</legend>
        ${this._templates.map((t) => html`
          <label style="display:block; margin:.25rem 0;">
            <input type="radio" name="tpl"
              .checked=${this._values.templateId === t.name}
              @change=${() => this.setValues({ templateId: t.name, templatePath: t.url })} />
            ${t.name}
          </label>`)}
      </fieldset>`;
  }

  renderStep() {
    switch (this._step) {
      case 0:
        return html`
          <label style="display:block; margin:.5rem 0;">Project name
            <input type="text" .value=${this._values.title}
              @input=${(e) => this.setValues({ title: e.target.value })}
              placeholder="My SEO Page" style="display:block; width:100%;" />
          </label>
          <label style="display:block; margin:.5rem 0;">What is this project for?
            <textarea .value=${this._values.description}
              @input=${(e) => this.setValues({ description: e.target.value })}
              rows="3" style="display:block; width:100%;"></textarea>
          </label>
          <p>Path: <code>/${this.context?.org}/${this.context?.repo}/projects/${this.slug || '...'}</code></p>`;
      case 1:
        return this.renderTemplateStep();
      default:
        return html`
          <h2>Review</h2>
          <ul>
            <li>Name: <strong>${this._values.title}</strong></li>
            <li>Description: <strong>${this._values.description || '(none)'}</strong></li>
            <li>Template: <strong>${this._values.templateId}</strong></li>
            <li>Path: <code>projects/${this.slug}.json</code></li>
          </ul>`;
    }
  }

  renderSuccess() {
    const { slug, editUrl } = this._result;
    return html`
      <p>Created <code>projects/${slug}.json</code></p>
      ${editUrl ? html`<p><a href=${editUrl} target="_blank" rel="noopener">Open the record in DA</a></p>` : ''}
      <p><em>The read-only project view arrives in a later ticket.</em></p>
      <button @click=${() => this.reset()}>Create another</button>`;
  }

  renderActions() {
    const last = this._step === STEPS.length - 1;
    return html`
      <button ?disabled=${this._step === 0 || this._creating} @click=${() => this.back()}>Back</button>
      ${last
    ? html`<button ?disabled=${this._creating} @click=${() => this.create()}>${this._creating ? 'Creating...' : 'Create project'}</button>`
    : html`<button ?disabled=${!this.stepValid} @click=${() => this.next()}>Next</button>`}`;
  }

  render() {
    return html`
      <main style="font-family: system-ui, sans-serif; padding: 2rem; max-width: 40rem;">
        <h1>Add Project</h1>
        ${this._result ? '' : this.renderIndicator()}
        ${this._result ? this.renderSuccess() : this.renderStep()}
        ${this._result ? '' : html`
          <div style="margin-top:1.5rem; display:flex; gap:.5rem; flex-wrap:wrap;">
            ${this.renderActions()}
          </div>`}
        ${this._error ? html`<p style="color:#b5121b;">Error: ${this._error}</p>` : ''}
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
