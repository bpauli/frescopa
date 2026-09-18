import test from 'node:test';
import assert from 'node:assert/strict';

import {
  APPROVAL_NAMES, stageApprovals, approvalCounts, isFullyApproved,
  approvalSummary, pendingLabel, setApproval, approvalChanges,
} from './approvals-logic.js';

const AT = '2026-01-01T00:00:00.000Z';

test('the canonical set is the PRD\'s four sign-offs', () => {
  assert.deepEqual(APPROVAL_NAMES, ['Content', 'Brand & Design', 'SEO & Performance', 'Compliance']);
});

test('stageApprovals opens an untouched stage with every name pending', () => {
  assert.deepEqual(stageApprovals([], 4), [
    { name: 'Content', approved: false, approvedAt: '' },
    { name: 'Brand & Design', approved: false, approvedAt: '' },
    { name: 'SEO & Performance', approved: false, approvedAt: '' },
    { name: 'Compliance', approved: false, approvedAt: '' },
  ]);
});

test('stageApprovals reads only the given stage\'s rows', () => {
  const rows = [
    {
      stageIndex: 4, name: 'Content', approved: true, approvedAt: AT,
    },
    {
      stageIndex: 5, name: 'Compliance', approved: true, approvedAt: AT,
    },
  ];
  const stage4 = stageApprovals(rows, 4);
  assert.deepEqual(stage4[0], { name: 'Content', approved: true, approvedAt: AT });
  assert.equal(stage4.find((r) => r.name === 'Compliance').approved, false);
  // The same helper serves Stage 5 - nothing is keyed to Stage 4.
  const stage5 = stageApprovals(rows, 5);
  assert.equal(stage5.find((r) => r.name === 'Compliance').approved, true);
  assert.equal(stage5.find((r) => r.name === 'Content').approved, false);
});

test('stageApprovals takes a per-stage name set and keeps its order', () => {
  const names = ['Legal', 'Rights'];
  const rows = [{
    stageIndex: 7, name: 'Rights', approved: true, approvedAt: AT,
  }];
  assert.deepEqual(stageApprovals(rows, 7, names), [
    { name: 'Legal', approved: false, approvedAt: '' },
    { name: 'Rights', approved: true, approvedAt: AT },
  ]);
});

test('stageApprovals ignores a row naming something outside the set', () => {
  const rows = [{
    stageIndex: 4, name: 'Budget', approved: true, approvedAt: AT,
  }];
  assert.equal(stageApprovals(rows, 4).some((r) => r.approved), false);
});

test('approvalCounts counts approved, total, and pending', () => {
  const rows = stageApprovals([{ stageIndex: 4, name: 'Content', approved: true }], 4);
  assert.deepEqual(approvalCounts(rows), { approved: 1, total: 4, pending: 3 });
});

test('isFullyApproved is met only when every approval is granted', () => {
  let rows = stageApprovals([], 4);
  assert.equal(isFullyApproved(rows), false);
  APPROVAL_NAMES.forEach((name) => { rows = setApproval(rows, name, true, AT); });
  assert.equal(isFullyApproved(rows), true);
});

test('isFullyApproved is false for an empty set - nothing was signed off', () => {
  assert.equal(isFullyApproved([]), false);
  assert.equal(isFullyApproved(null), false);
});

test('the summary and pill read like the demo', () => {
  const rows = stageApprovals([], 4);
  assert.equal(approvalSummary(rows), '0 of 4 complete');
  assert.equal(pendingLabel(rows), '4 pending');
  const one = setApproval(rows, 'Content', true, AT);
  assert.equal(approvalSummary(one), '1 of 4 complete');
  assert.equal(pendingLabel(one), '3 pending');
});

test('the pill reads Approved once the gate is met', () => {
  let rows = stageApprovals([], 4);
  APPROVAL_NAMES.forEach((name) => { rows = setApproval(rows, name, true, AT); });
  assert.equal(approvalSummary(rows), '4 of 4 complete');
  assert.equal(pendingLabel(rows), 'Approved');
});

test('setApproval stamps a grant and does not touch the input', () => {
  const rows = stageApprovals([], 4);
  const next = setApproval(rows, 'Compliance', true, AT);
  assert.deepEqual(next.find((r) => r.name === 'Compliance'), {
    name: 'Compliance', approved: true, approvedAt: AT,
  });
  assert.equal(rows.find((r) => r.name === 'Compliance').approved, false);
});

test('setApproval drops the timestamp when a sign-off is withdrawn', () => {
  const granted = setApproval(stageApprovals([], 4), 'Content', true, AT);
  const withdrawn = setApproval(granted, 'Content', false);
  assert.deepEqual(withdrawn.find((r) => r.name === 'Content'), {
    name: 'Content', approved: false, approvedAt: '',
  });
});

test('setApproval leaves an unknown name alone', () => {
  const rows = stageApprovals([], 4);
  assert.deepEqual(setApproval(rows, 'Budget', true, AT), rows);
});

test('approvalChanges keys the set by stage for saving', () => {
  const rows = setApproval(stageApprovals([], 5), 'Content', true, AT);
  assert.deepEqual(approvalChanges(5, rows), {
    stageIndex: 5,
    approvals: [
      { name: 'Content', approved: true, approvedAt: AT },
      { name: 'Brand & Design', approved: false, approvedAt: '' },
      { name: 'SEO & Performance', approved: false, approvedAt: '' },
      { name: 'Compliance', approved: false, approvedAt: '' },
    ],
  });
});
