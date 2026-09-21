// Pure completion rule for Stage 4 "Page Generation" (ticket #44).
//
// Its Stage 1-3 siblings live inline in coworker-project.js, but that module
// boots the app on import, so it cannot be unit tested. This rule sits in its
// own module for the same reason the panels keep their logic in `*-logic.js`.
//
// Stage 4 has no approval gate: reaching "Approved" is the approvals gate's job
// (approvals-logic.js, ticket #46). This rule is the precondition for BOTH -
// the stage's work must be done before it is completed or signed off.

import { hasGeneratedPage } from './page-preview-logic.js';

/**
 * Whether Stage 4's work is done: the page must be generated (the preview URL
 * is the proof) AND the pre-flight check must have run (it carries a run
 * timestamp). It gates both "Complete Stage 4" and the approvals gate. The
 * reason names every missing step so the UI can hint. Pure.
 * @param {{previewUrl?: string}} page the project's generated-page record
 * @param {{ranAt?: string}} preflight the project's pre-flight record
 * @returns {{ready: boolean, reason: string}}
 */
export default function stage4Readiness(page, preflight) {
  const missing = [];
  if (!hasGeneratedPage(page)) missing.push('Generate the page.');
  if (!(preflight?.ranAt || '').trim()) missing.push('Run the pre-flight check.');
  if (missing.length) return { ready: false, reason: missing.join(' ') };
  return { ready: true, reason: '' };
}
