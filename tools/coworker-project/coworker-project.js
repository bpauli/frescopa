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

// Muted background per PRD status for the stage badge (light meta area).
const STATUS_BG = {
  Locked: '#e6e6e6',
  'Not Started': '#e3f0ff',
  'In Progress': '#fff3cd',
  Complete: '#d7f0dd',
  Approved: '#c3e6cb',
};

// A small pill for an overall/meta status.
function statusBadge(status) {
  if (!status) return '';
  const bg = STATUS_BG[status] ?? '#eee';
  return html`<span style="background:${bg}; color:#222; border-radius:1rem; padding:.1rem .6rem; font-size:.8rem; white-space:nowrap;">${status}</span>`;
}

// Stage-bar (dark) status glyph + icon-disc background, per PRD status.
const STAGE_ICON = {
  'Not Started': '○',
  'In Progress': '◐',
  Complete: '✓',
  Approved: '★',
  Locked: '🔒',
};
const ICON_BG = {
  'Not Started': '#3a4a5a',
  'In Progress': '#5a5326',
  Complete: '#2f5a3a',
  Approved: '#2f5a4a',
  Locked: '#333',
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

  // --- render: project (stage-execution shell) ---
  // One node in the top progress bar. Unlocked nodes are buttons that open the
  // stage; a locked node collapses to a lock disc (matches the demo shell).
  renderStageNode(s) {
    const locked = s.status === 'Locked';
    const active = s.stageIndex === this._activeStage;
    const disc = `display:inline-flex; align-items:center; justify-content:center;
      width:1.9rem; height:1.9rem; border-radius:50%; flex:0 0 auto;
      background:${ICON_BG[s.status] ?? '#333'}; font-size:.9rem;`;
    if (locked) {
      return html`<div title="Locked until the previous stage is complete"
        style="display:flex; align-items:center; padding:.4rem .6rem; opacity:.55;">
        <span style=${disc}>${STAGE_ICON.Locked}</span>
      </div>`;
    }
    return html`<button @click=${() => this.openStage(s.stageIndex)}
      style="display:flex; align-items:center; gap:.6rem; border:none; cursor:pointer;
        border-radius:.6rem; padding:.4rem .7rem; color:#eee; text-align:left;
        background:${active ? '#3b3a36' : 'transparent'};">
      <span style=${disc}>${STAGE_ICON[s.status] ?? '○'}</span>
      <span style="display:flex; flex-direction:column; line-height:1.15;">
        <strong style="font-size:.9rem;">${s.stage}</strong>
        <span style="font-size:.72rem; color:#aaa;">Stage ${s.stageIndex} &middot; ${s.status}</span>
      </span>
    </button>`;
  }

  renderStageBar(stages) {
    return html`
      <div class="stage-bar" style="display:flex; align-items:stretch; gap:.15rem;
        overflow-x:auto; background:#1f1d1a; border-radius:.75rem; padding:.4rem; margin:1rem 0 1.5rem;">
        ${stages.map((s, i) => html`
          ${i > 0 ? html`<span style="align-self:center; color:#666; padding:0 .1rem;">&rsaquo;</span>` : ''}
          ${this.renderStageNode(s)}`)}
      </div>`;
  }

  // Status control for the active unlocked stage - the mechanism that drives
  // gating + persistence until the real per-stage panels land (tickets #16+).
  renderStageControl(stage) {
    const set = (status) => () => this.changeStage(stage.stageIndex, status);
    const btn = 'padding:.4rem .9rem; border-radius:.4rem; border:1px solid #555; cursor:pointer;';
    let controls;
    if (stage.status === 'Not Started') {
      controls = html`<button ?disabled=${this._savingStage} @click=${set('In Progress')}
        style="${btn} background:#2f5a3a; color:#fff; border-color:#2f5a3a;">Start stage</button>`;
    } else if (stage.status === 'In Progress') {
      controls = html`
        <button ?disabled=${this._savingStage} @click=${set('Complete')}
          style="${btn} background:#2f5a3a; color:#fff; border-color:#2f5a3a;">Mark complete</button>
        <button ?disabled=${this._savingStage} @click=${set('Not Started')}
          style="${btn} background:transparent; color:#ccc;">Reset</button>`;
    } else {
      controls = html`<button ?disabled=${this._savingStage} @click=${set('In Progress')}
        style="${btn} background:transparent; color:#ccc;">Reopen stage</button>`;
    }
    return html`
      <div style="display:flex; gap:.5rem; flex-wrap:wrap; align-items:center; margin-top:1rem;">
        ${controls}
        ${this._savingStage ? html`<span style="color:#aaa; font-size:.85rem;">Saving...</span>` : ''}
      </div>`;
  }

  renderStagePanel(stages) {
    const stage = stages.find((s) => s.stageIndex === this._activeStage);
    if (!stage) return '';
    const card = 'background:#1f1d1a; border:1px solid #33312d; border-radius:.75rem; padding:1.25rem;';
    if (stage.status === 'Locked') {
      return html`<div style=${card}>
        <p style="color:#aaa; margin:0;">This stage is locked. Complete the previous stage to continue.</p>
      </div>`;
    }
    return html`
      <h2 style="color:#fff; margin:0 0 .25rem;">Stage ${stage.stageIndex}: ${stage.stage}</h2>
      <p style="color:#aaa; margin:0 0 1rem;">
        Placeholder panel - the ${stage.stage} tools arrive in a later ticket.
      </p>
      <div style=${card}>
        <ul style="margin:0; padding-left:1.2rem; color:#ddd;">
          ${stage.steps.map((st) => html`<li style="margin:.15rem 0;">${st.displayName}</li>`)}
        </ul>
        ${this.renderStageControl(stage)}
        ${this._stageError ? html`<p style="color:#ff8a8a; margin:.75rem 0 0;">${this._stageError}</p>` : ''}
      </div>`;
  }

  renderProjectBody() {
    if (this._loadingProject) return html`<p>Loading project...</p>`;
    if (!this._project) return html`<p>Project not found.</p>`;
    const { meta, stages } = this._project;
    return html`
      ${meta.description ? html`<p style="color:#ccc; margin:.25rem 0;">${meta.description}</p>` : ''}
      <div style="color:#999; font-size:.85rem; display:flex; gap:1rem; flex-wrap:wrap; align-items:center;">
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
      <div style="background:#141312; color:#eee; border-radius:1rem; padding:1.5rem 1.75rem;">
        <div style="display:flex; justify-content:space-between; align-items:center; gap:1rem;">
          <h1 style="color:#fff; margin:0;">${title}</h1>
          <button @click=${() => this.showList()}>Back to projects</button>
        </div>
        ${this.renderProjectBody()}
      </div>`;
  }

  render() {
    let body;
    let wide = false;
    if (this._view === 'wizard') body = this.renderWizard();
    else if (this._view === 'project') { body = this.renderProject(); wide = true; } else body = this.renderList();
    return html`
      <main style="font-family: system-ui, sans-serif; padding: 2rem; max-width: ${wide ? '72rem' : '40rem'};">
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
