// Pure helpers for the named-approvals gate (ticket #46).
//
// A stage reaches "Approved" - the PRD's strongest stage status - once every
// named approval in its set is granted (FR-40, FR-63..65). Stage 4 is the first
// user, but nothing here knows about Stage 4: the stage is a parameter and the
// name set is configurable, because Stage 5 (Asset Generation) and Stage 7
// (Final Review) reuse this same gate.
//
// The record stores one flat row per approval, keyed by stage
// (`{ stageIndex, name, approved, approvedAt }`), so a project carries every
// stage's approvals in one sheet. These helpers turn that flat list into the
// ordered set for one stage and back again. All pure - no DOM, no fetch.

const str = (v) => (typeof v === 'string' ? v.trim() : '');

/** The canonical approval set: the four sign-offs the PRD names. */
export const APPROVAL_NAMES = ['Content', 'Brand & Design', 'SEO & Performance', 'Compliance'];

/**
 * One stage's approval set, in canonical order: every configured name with its
 * current state, whether or not the record already carries a row for it. Rows
 * for other stages and rows naming something outside the set are ignored, so a
 * renamed set never resurrects a stale sign-off. Pure.
 * @param {Array<{stageIndex, name, approved, approvedAt}>} approvals the record's flat rows
 * @param {number} stageIndex the stage to read
 * @param {string[]} [names] the stage's approval set
 * @returns {Array<{name: string, approved: boolean, approvedAt: string}>}
 */
export function stageApprovals(approvals, stageIndex, names = APPROVAL_NAMES) {
  const idx = Number(stageIndex);
  const rows = (approvals || []).filter((r) => Number(r?.stageIndex) === idx);
  return (names || []).map((name) => {
    const row = rows.find((r) => str(r.name) === name);
    return {
      name,
      approved: !!row?.approved,
      approvedAt: row?.approved ? str(row.approvedAt) : '',
    };
  });
}

/**
 * How far a stage's approval set has got. Pure.
 * @param {Array<{approved: boolean}>} rows one stage's approval set
 * @returns {{approved: number, total: number, pending: number}}
 */
export function approvalCounts(rows) {
  const total = (rows || []).length;
  const approved = (rows || []).filter((r) => r?.approved).length;
  return { approved, total, pending: total - approved };
}

/**
 * Whether the gate is met: every approval in a non-empty set is granted. An
 * empty set is NOT approved - nothing was signed off. Pure.
 * @param {Array<{approved: boolean}>} rows one stage's approval set
 * @returns {boolean}
 */
export function isFullyApproved(rows) {
  const { approved, total } = approvalCounts(rows);
  return total > 0 && approved === total;
}

/**
 * The demo's progress line, e.g. "0 of 4 complete". Pure.
 * @param {Array<{approved: boolean}>} rows one stage's approval set
 * @returns {string}
 */
export function approvalSummary(rows) {
  const { approved, total } = approvalCounts(rows);
  return `${approved} of ${total} complete`;
}

/**
 * The pill next to the summary: "N pending" while sign-offs are outstanding,
 * "Approved" once the gate is met, '' for an empty set. Pure.
 * @param {Array<{approved: boolean}>} rows one stage's approval set
 * @returns {string}
 */
export function pendingLabel(rows) {
  const { total, pending } = approvalCounts(rows);
  if (!total) return '';
  return pending ? `${pending} pending` : 'Approved';
}

/**
 * Grant or withdraw one named approval. Returns a new set - the input is
 * untouched - with the approval timestamp stamped on a grant and dropped on a
 * withdrawal. An unknown name changes nothing. Pure.
 * @param {Array<{name, approved, approvedAt}>} rows one stage's approval set
 * @param {string} name the approval to change
 * @param {boolean} approved the new state
 * @param {string} [at] ISO timestamp for a grant
 * @returns {Array<{name: string, approved: boolean, approvedAt: string}>}
 */
export function setApproval(rows, name, approved, at = new Date().toISOString()) {
  const target = str(name);
  return (rows || []).map((r) => {
    if (r.name !== target) return r;
    return { name: r.name, approved: !!approved, approvedAt: approved ? str(at) : '' };
  });
}

/**
 * The persistence shape for `saveApprovals`: one stage's set, keyed by stage so
 * the save replaces only that stage's rows. Pure.
 * @param {number} stageIndex
 * @param {Array<{name, approved, approvedAt}>} rows
 * @returns {{stageIndex: number, approvals: Array}}
 */
export function approvalChanges(stageIndex, rows) {
  return {
    stageIndex: Number(stageIndex) || 0,
    approvals: (rows || []).map((r) => ({
      name: str(r.name),
      approved: !!r.approved,
      approvedAt: r.approved ? str(r.approvedAt) : '',
    })).filter((r) => r.name),
  };
}
