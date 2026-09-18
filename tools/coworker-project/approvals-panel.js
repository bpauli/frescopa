/* eslint-disable no-underscore-dangle */
// The named-approvals gate (ticket #46).
//
// The strip under a stage title: "Approvals - N of M complete - P pending",
// one row per named sign-off, and the producer's Approve / Undo control. Once
// every approval is granted the gate is met, the panel says so and offers
// "View approved artifact"; the stage status itself is the shell's job - the
// panel only announces the new state with `approvals-changed`, which carries
// `fullyApproved` so the shell can move the stage to "Approved" (or back out of
// it when a sign-off is withdrawn).
//
// REUSABLE BY DESIGN: nothing here knows about Stage 4. The stage is the
// `stageIndex` property and the approval set is `names` (the PRD's four by
// default), because Stage 5 (Asset Generation) and Stage 7 (Final Review) reuse
// this same gate. Approvals persist through stage-state.js `saveApprovals`,
// which is keyed by stage, so the stages share one sheet without colliding.
//
// The panel never blocks: a failed save rolls the row back and degrades to a
// soft error, the same contract as its Stage 4 siblings.

import { LitElement, html } from 'da-lit';
import { saveApprovals } from './stage-state.js';
import {
  APPROVAL_NAMES, stageApprovals, approvalSummary, pendingLabel,
  isFullyApproved, setApproval, approvalChanges,
} from './approvals-logic.js';

class DaApprovalsPanel extends LitElement {
  static properties = {
    context: { attribute: false },
    daFetch: { attribute: false },
    slug: { attribute: false },
    stageIndex: { attribute: false },
    names: { attribute: false },
    approvals: { attribute: false },
    artifactUrl: { attribute: false },
    locked: { attribute: false },
    lockedReason: { attribute: false },
    _rows: { state: true },
    _saving: { state: true },
    _error: { state: true },
  };

  constructor() {
    super();
    this.context = null;
    this.daFetch = null;
    this.slug = null;
    this.stageIndex = 0;
    this.names = APPROVAL_NAMES;
    this.approvals = [];
    this.artifactUrl = '';
    this.locked = false;
    this.lockedReason = '';
    this._rows = null;
    this._saving = false;
    this._error = null;
  }

  createRenderRoot() {
    return this;
  }

  // The record is the source of truth; `_rows` only holds the optimistic state
  // of a save in flight.
  updated(changed) {
    if (changed.has('approvals') && !this._saving) this._rows = null;
  }

  get rows() {
    return this._rows ?? stageApprovals(this.approvals, this.stageIndex, this.names);
  }

  // Grant or withdraw one sign-off: show it at once, persist it, then tell the
  // shell. A failed save puts the row back and says so instead of throwing.
  async toggle(name, approved) {
    if (this._saving || this.locked) return;
    const previous = this.rows;
    const next = setApproval(previous, name, approved);
    this._rows = next;
    this._error = null;
    this._saving = true;
    try {
      const changes = approvalChanges(this.stageIndex, next);
      const saved = await saveApprovals(this.context, this.daFetch, this.slug, changes);
      this.approvals = saved;
      this._rows = stageApprovals(saved, this.stageIndex, this.names);
      this.dispatchEvent(new CustomEvent('approvals-changed', {
        detail: {
          approvals: saved,
          stageIndex: Number(this.stageIndex) || 0,
          rows: this._rows,
          fullyApproved: isFullyApproved(this._rows),
        },
        bubbles: true,
        composed: true,
      }));
    } catch (e) {
      this._rows = previous;
      this._error = `Could not save the approval: ${e.message || 'unknown error'}`;
    } finally {
      this._saving = false;
    }
  }

  renderRow(row) {
    const done = row.approved;
    return html`
      <li class="cw-ap-item ${done ? 'is-approved' : 'is-pending'}">
        <span class="cw-ap-mark" aria-hidden="true">${done ? '\u2713' : '\u25CB'}</span>
        <span class="cw-ap-name">${row.name}</span>
        <button class="${done ? 'nx-action-btn' : 'nx-btn-accent'} nx-btn-sm"
          ?disabled=${this._saving || this.locked}
          @click=${() => this.toggle(row.name, !done)}>${done ? 'Undo' : 'Approve'}</button>
      </li>`;
  }

  renderArtifact() {
    const url = (this.artifactUrl || '').trim();
    if (!url || !isFullyApproved(this.rows)) return '';
    return html`
      <a class="nx-action-btn nx-btn-sm cw-ap-artifact" href=${url}
        target="_blank" rel="noopener noreferrer">View approved artifact</a>`;
  }

  render() {
    const { rows } = this;
    const pending = pendingLabel(rows);
    const met = isFullyApproved(rows);
    return html`
      <div class="cw-ap">
        <div class="cw-ap-head">
          <span class="cw-ap-icon ${met ? 'is-done' : ''}" aria-hidden="true">\u2713</span>
          <h3 class="cw-ap-title">Approvals</h3>
          <span class="cw-ap-count">${approvalSummary(rows)}</span>
          ${pending ? html`<span class="cw-ap-pill ${met ? 'is-done' : ''}">${pending}</span>` : ''}
          ${this.renderArtifact()}
          ${this._saving ? html`<span class="cw-saving"><span class="nx-loading-spinner"></span>Saving...</span>` : ''}
        </div>
        ${this.locked && this.lockedReason
    ? html`<p class="cw-muted cw-ap-note">${this.lockedReason}</p>` : ''}
        <ul class="cw-ap-list">${rows.map((row) => this.renderRow(row))}</ul>
        ${this._error ? html`<p class="cw-error">${this._error}</p>` : ''}
      </div>`;
  }
}

customElements.define('da-approvals-panel', DaApprovalsPanel);
