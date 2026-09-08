import DA_SDK from 'https://da.live/nx/utils/sdk.js';
import { LitElement, html } from 'da-lit';
import { fetchTemplates } from './templates.js';
import { createProject, slugify } from './project.js';
import { listProjects } from './projects.js';

// Coworker Projects app. Round one routes between three views:
//   list    - the projects landing (the front door)
//   wizard  - the Add Project wizard (name, description, template, create)
//   project - the read-only project view (stub here; filled in ticket #9)
//
// NOTE: never name a method `update` - that is a reserved LitElement lifecycle
// method and shadows render(), so the component silently fails to paint.

const STEPS = ['Details', 'Template', 'Review'];

function fmtDate(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString();
}

class DaCoworkerProject extends LitElement {
  static properties = {
    context: { attribute: false },
    token: { attribute: false },
    actions: { attribute: false },
    _view: { state: true },
    _projects: { state: true },
    _loadingProjects: { state: true },
    _selectedSlug: { state: true },
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
    this._view = 'list';
    this._projects = [];
    this._loadingProjects = true;
    this._selectedSlug = null;
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
    this.loadProjects();
    this.loadTemplates();
  }

  async loadProjects() {
    this._loadingProjects = true;
    try {
      this._projects = await listProjects(this.context, this.actions?.daFetch);
    } catch {
      this._projects = [];
    } finally {
      this._loadingProjects = false;
    }
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

  // --- navigation ---
  showList() { this._view = 'list'; this.loadProjects(); }

  showWizard() { this.resetWizard(); this._view = 'wizard'; }

  showProject(slug) { this._selectedSlug = slug; this._view = 'project'; }

  resetWizard() {
    this._step = 0;
    this._values = { title: '', description: '', templateId: '', templatePath: '' };
    this._result = null;
    this._error = null;
  }

  // --- wizard ---
  get slug() { return slugify(this._values.title); }

  get stepValid() {
    if (this._step === 0) return this.slug.length > 0;
    if (this._step === 1) return !!this._values.templateId;
    return true;
  }

  // NOTE: not named `update` on purpose (see the top-of-file warning).
  setValues(patch) { this._values = { ...this._values, ...patch }; }

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

  // --- render: list ---
  renderList() {
    return html`
      <div style="display:flex; justify-content:space-between; align-items:center; gap:1rem;">
        <h1>Coworker Projects</h1>
        <button @click=${() => this.showWizard()}>Add Project</button>
      </div>
      ${this.renderProjects()}`;
  }

  renderProjects() {
    if (this._loadingProjects) return html`<p>Loading projects...</p>`;
    if (!this._projects.length) return html`<p>No projects yet. Add one to get started.</p>`;
    return html`
      <ul class="projects" style="list-style:none; padding:0;">
        ${this._projects.map((p) => html`
          <li style="border:1px solid #ddd; border-radius:.5rem; padding:.75rem 1rem; margin:.5rem 0;">
            <a href="#" @click=${(e) => { e.preventDefault(); this.showProject(p.slug); }}
              style="font-weight:600; text-decoration:none;">${p.title}</a>
            <div style="color:#666; font-size:.9rem;">
              ${p.templateId ? html`Template: <code>${p.templateId}</code>` : ''}
              ${p.createdAt ? html` &middot; ${fmtDate(p.createdAt)}` : ''}
              ${p.status ? html` &middot; ${p.status}` : ''}
            </div>
          </li>`)}
      </ul>`;
  }

  // --- render: wizard ---
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

  renderActions() {
    const last = this._step === STEPS.length - 1;
    return html`
      <button ?disabled=${this._step === 0 || this._creating} @click=${() => this.back()}>Back</button>
      ${last
    ? html`<button ?disabled=${this._creating} @click=${() => this.create()}>${this._creating ? 'Creating...' : 'Create project'}</button>`
    : html`<button ?disabled=${!this.stepValid} @click=${() => this.next()}>Next</button>`}`;
  }

  renderSuccess() {
    const { slug, editUrl } = this._result;
    return html`
      <p>Created <code>projects/${slug}.json</code></p>
      ${editUrl ? html`<p><a href=${editUrl} target="_blank" rel="noopener">Open the record in DA</a></p>` : ''}
      <div style="display:flex; gap:.5rem; flex-wrap:wrap;">
        <button @click=${() => this.showProject(slug)}>View project</button>
        <button @click=${() => this.showList()}>Back to projects</button>
        <button @click=${() => this.resetWizard()}>Create another</button>
      </div>`;
  }

  renderWizard() {
    return html`
      <div style="display:flex; justify-content:space-between; align-items:center; gap:1rem;">
        <h1>Add Project</h1>
        ${this._result ? '' : html`<button @click=${() => this.showList()}>Cancel</button>`}
      </div>
      ${this._result ? this.renderSuccess() : html`
        ${this.renderIndicator()}
        ${this.renderStep()}
        <div style="margin-top:1.5rem; display:flex; gap:.5rem; flex-wrap:wrap;">
          ${this.renderActions()}
        </div>`}
      ${this._error ? html`<p style="color:#b5121b;">Error: ${this._error}</p>` : ''}`;
  }

  // --- render: project (stub; ticket #9 fills this in) ---
  renderProject() {
    const p = this._projects.find((x) => x.slug === this._selectedSlug);
    return html`
      <div style="display:flex; justify-content:space-between; align-items:center; gap:1rem;">
        <h1>${p?.title ?? this._selectedSlug}</h1>
        <button @click=${() => this.showList()}>Back to projects</button>
      </div>
      <p><em>The read-only project view (stages and steps) arrives in the next ticket.</em></p>`;
  }

  render() {
    let body;
    if (this._view === 'wizard') body = this.renderWizard();
    else if (this._view === 'project') body = this.renderProject();
    else body = this.renderList();
    return html`
      <main style="font-family: system-ui, sans-serif; padding: 2rem; max-width: 40rem;">
        ${body}
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
