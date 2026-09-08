/* eslint-disable no-underscore-dangle */
import DA_SDK from 'https://da.live/nx/utils/sdk.js';
import { LitElement, html } from 'da-lit';
import { fetchTemplates } from './templates.js';
import { createProject, slugify } from './project.js';
import { listProjects, readProject, parseProject } from './projects.js';
import { saveStageState, recomputeGating } from './stage-state.js';

// Coworker Projects app. Round one routes between three views:
//   list    - the projects landing (the front door)
//   wizard  - the Add Project wizard (name, description, template, create)
//   project - the interactive stage-execution shell (ticket #12)
//
// NOTE: never name a method `update` - that is a reserved LitElement lifecycle
// method and shadows render(), so the component silently fails to paint.

const STEPS = ['Details', 'Template', 'Review'];

function fmtDate(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString();
}

// A small pill for an overall/meta status.
function statusBadge(status) {
  if (!status) return '';
  return html`<span class="cw-badge">${status}</span>`;
}

// Per-status glyph + disc modifier class for the stage bar.
const STAGE_ICON = {
  'Not Started': '○',
  'In Progress': '◐',
  Complete: '✓',
  Approved: '★',
  Locked: '🔒',
};
const DISC_MOD = {
  'Not Started': 'is-not-started',
  'In Progress': 'is-in-progress',
  Complete: 'is-complete',
  Approved: 'is-approved',
  Locked: 'is-locked',
};

// Where to land when a project opens: the furthest unlocked stage.
function defaultActiveStage(stages) {
  const open = stages.filter((s) => s.status !== 'Locked');
  return open.length ? open[open.length - 1].stageIndex : 1;
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
    _project: { state: true },
    _loadingProject: { state: true },
    _activeStage: { state: true },
    _savingStage: { state: true },
    _stageError: { state: true },
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
    this._project = null;
    this._loadingProject = false;
    this._activeStage = 1;
    this._savingStage = false;
    this._stageError = null;
    this._step = 0;
    this._values = {
      title: '', description: '', templateId: '', templatePath: '',
    };
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

  showProject(slug) {
    this._selectedSlug = slug;
    this._view = 'project';
    this.loadProject(slug);
  }

  async loadProject(slug) {
    this._loadingProject = true;
    this._project = null;
    this._stageError = null;
    try {
      const parsed = parseProject(await readProject(this.context, this.actions?.daFetch, slug));
      if (parsed) {
        // Re-gate on read so a hand-edited or older record stays consistent.
        parsed.stages = recomputeGating(parsed.stages);
        this._activeStage = defaultActiveStage(parsed.stages);
      }
      this._project = parsed;
    } catch {
      this._project = null;
    } finally {
      this._loadingProject = false;
    }
  }

  // Open an unlocked stage's panel.
  openStage(stageIndex) {
    const stage = this._project?.stages.find((s) => s.stageIndex === stageIndex);
    if (stage && stage.status !== 'Locked') this._activeStage = stageIndex;
  }

  // Persist a stage status change, re-gate, and refresh the view model.
  async changeStage(stageIndex, status) {
    this._savingStage = true;
    this._stageError = null;
    try {
      const updated = await saveStageState(
        this.context,
        this.actions.daFetch,
        this._selectedSlug,
        this._project,
        { stageIndex, status },
      );
      this._project = { ...this._project, meta: updated.meta, stages: updated.stages };
      const active = updated.stages.find((s) => s.stageIndex === this._activeStage);
      if (!active || active.status === 'Locked') {
        this._activeStage = defaultActiveStage(updated.stages);
      }
    } catch (e) {
      this._stageError = e.message;
    } finally {
      this._savingStage = false;
    }
  }

  resetWizard() {
    this._step = 0;
    this._values = {
      title: '', description: '', templateId: '', templatePath: '',
    };
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
      <div class="cw-header">
        <h1>Coworker Projects</h1>
        <button class="nx-btn-accent" @click=${() => this.showWizard()}>Add Project</button>
      </div>
      ${this.renderProjects()}`;
  }

  renderProjects() {
    if (this._loadingProjects) return html`<p class="cw-muted">Loading projects...</p>`;
    if (!this._projects.length) return html`<p class="cw-muted">No projects yet. Add one to get started.</p>`;
    return html`
      <ul class="cw-projects">
        ${this._projects.map((p) => html`
          <li class="cw-project">
            <a class="cw-project-title" href="#"
              @click=${(e) => { e.preventDefault(); this.showProject(p.slug); }}>${p.title}</a>
            <div class="cw-project-meta">
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
      <ol class="cw-steps">
        ${STEPS.map((label, i) => html`<li class=${this.stepClass(i)}>${i + 1}. ${label}</li>`)}
      </ol>`;
  }

  renderTemplateStep() {
    if (this._loadingTpls) return html`<p class="cw-muted">Loading templates...</p>`;
    if (!this._templates.length) return html`<p class="cw-muted">No templates found for this site.</p>`;
    return html`
      <fieldset>
        <legend>Choose a template</legend>
        ${this._templates.map((t) => html`
          <label class="cw-radio">
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
          <label class="cw-field">Project name
            <input type="text" .value=${this._values.title}
              @input=${(e) => this.setValues({ title: e.target.value })}
              placeholder="My SEO Page" />
          </label>
          <label class="cw-field">What is this project for?
            <textarea .value=${this._values.description}
              @input=${(e) => this.setValues({ description: e.target.value })}
              rows="3"></textarea>
          </label>
          <p class="cw-muted">Path: <code>/${this.context?.org}/${this.context?.repo}/projects/${this.slug || '...'}</code></p>`;
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
      <button class="nx-action-btn" ?disabled=${this._step === 0 || this._creating} @click=${() => this.back()}>Back</button>
      ${last
    ? html`<button class="nx-btn-accent" ?disabled=${this._creating} @click=${() => this.create()}>${this._creating ? 'Creating...' : 'Create project'}</button>`
    : html`<button class="nx-btn-accent" ?disabled=${!this.stepValid} @click=${() => this.next()}>Next</button>`}`;
  }

  renderSuccess() {
    const { slug, editUrl } = this._result;
    return html`
      <p>Created <code>projects/${slug}.json</code></p>
      ${editUrl ? html`<p><a href=${editUrl} target="_blank" rel="noopener">Open the record in DA</a></p>` : ''}
      <div class="cw-actions">
        <button class="nx-btn-accent" @click=${() => this.showProject(slug)}>View project</button>
        <button class="nx-action-btn" @click=${() => this.showList()}>Back to projects</button>
        <button class="nx-action-btn" @click=${() => this.resetWizard()}>Create another</button>
      </div>`;
  }

  renderWizard() {
    return html`
      <div class="cw-header">
        <h1>Add Project</h1>
        ${this._result ? '' : html`<button class="nx-action-btn" @click=${() => this.showList()}>Cancel</button>`}
      </div>
      ${this._result ? this.renderSuccess() : html`
        ${this.renderIndicator()}
        ${this.renderStep()}
        <div class="cw-actions">
          ${this.renderActions()}
        </div>`}
      ${this._error ? html`<p class="cw-error">Error: ${this._error}</p>` : ''}`;
  }

  // --- render: project (stage-execution shell) ---
  // One node in the top progress bar. Unlocked nodes are buttons that open the
  // stage; a locked node collapses to a lock disc (matches the demo shell).
  renderStageNode(s) {
    const disc = html`<span class="cw-disc ${DISC_MOD[s.status] ?? ''}">${STAGE_ICON[s.status] ?? '○'}</span>`;
    if (s.status === 'Locked') {
      return html`<div class="cw-stage is-locked" title="Locked until the previous stage is complete">
        ${disc}
      </div>`;
    }
    const active = s.stageIndex === this._activeStage;
    return html`<button class="cw-stage ${active ? 'is-active' : ''}" @click=${() => this.openStage(s.stageIndex)}>
      ${disc}
      <span class="cw-stage-label">
        <span class="cw-stage-name">${s.stage}</span>
        <span class="cw-stage-sub">Stage ${s.stageIndex} &middot; ${s.status}</span>
      </span>
    </button>`;
  }

  renderStageBar(stages) {
    return html`
      <div class="cw-stagebar">
        ${stages.map((s, i) => html`
          ${i > 0 ? html`<span class="cw-chevron">&rsaquo;</span>` : ''}
          ${this.renderStageNode(s)}`)}
      </div>`;
  }

  // Status control for the active unlocked stage - the mechanism that drives
  // gating + persistence until the real per-stage panels land (tickets #16+).
  renderStageControl(stage) {
    const set = (status) => () => this.changeStage(stage.stageIndex, status);
    let controls;
    if (stage.status === 'Not Started') {
      controls = html`<button class="nx-btn-accent" ?disabled=${this._savingStage}
        @click=${set('In Progress')}>Start stage</button>`;
    } else if (stage.status === 'In Progress') {
      controls = html`
        <button class="nx-btn-accent" ?disabled=${this._savingStage}
          @click=${set('Complete')}>Mark complete</button>
        <button class="nx-action-btn" ?disabled=${this._savingStage}
          @click=${set('Not Started')}>Reset</button>`;
    } else {
      controls = html`<button class="nx-action-btn" ?disabled=${this._savingStage}
        @click=${set('In Progress')}>Reopen stage</button>`;
    }
    return html`
      <div class="cw-controls">
        ${controls}
        ${this._savingStage ? html`<span class="cw-saving"><span class="nx-loading-spinner"></span>Saving...</span>` : ''}
      </div>`;
  }

  renderStagePanel(stages) {
    const stage = stages.find((s) => s.stageIndex === this._activeStage);
    if (!stage) return '';
    if (stage.status === 'Locked') {
      return html`<div class="cw-card">
        <p class="cw-muted" style="margin:0;">This stage is locked. Complete the previous stage to continue.</p>
      </div>`;
    }
    return html`
      <h2 class="cw-panel-title">Stage ${stage.stageIndex}: ${stage.stage}</h2>
      <p class="cw-panel-note">
        Placeholder panel - the ${stage.stage} tools arrive in a later ticket.
      </p>
      <div class="cw-card">
        <ul class="cw-steps-list">
          ${stage.steps.map((st) => html`<li>${st.displayName}</li>`)}
        </ul>
        ${this.renderStageControl(stage)}
        ${this._stageError ? html`<p class="cw-error" style="margin:.75rem 0 0;">${this._stageError}</p>` : ''}
      </div>`;
  }

  renderProjectBody() {
    if (this._loadingProject) return html`<p class="cw-muted">Loading project...</p>`;
    if (!this._project) return html`<p class="cw-muted">Project not found.</p>`;
    const { meta, stages } = this._project;
    return html`
      ${meta.description ? html`<p>${meta.description}</p>` : ''}
      <div class="cw-meta">
        ${meta.templateId ? html`<span>Template: <code>${meta.templateId}</code></span>` : ''}
        ${meta.status ? html`<span>${statusBadge(meta.status)}</span>` : ''}
        ${meta.createdAt ? html`<span>Created ${fmtDate(meta.createdAt)}</span>` : ''}
      </div>
      ${this.renderStageBar(stages)}
      ${this.renderStagePanel(stages)}`;
  }

  renderProject() {
    const title = this._project?.meta?.title ?? this._selectedSlug;
    return html`
      <div class="cw-runner">
        <div class="cw-header">
          <h1>${title}</h1>
          <button class="nx-action-btn" @click=${() => this.showList()}>Back to projects</button>
        </div>
        ${this.renderProjectBody()}
      </div>`;
  }

  render() {
    let body;
    let wide = false;
    if (this._view === 'wizard') body = this.renderWizard();
    else if (this._view === 'project') { body = this.renderProject(); wide = true; } else body = this.renderList();
    return html`<main class="cw-app ${wide ? 'cw-wide' : ''}">${body}</main>`;
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
