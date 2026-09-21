// Pure completion rule for Stage 5 "Asset Generation" (ticket #64).
//
// The sibling of stage4-logic.js, and for the same reason: the Stage 1-3 rules
// live inline in coworker-project.js, but that module boots the app on import,
// so nothing in it can be unit tested. This rule sits in its own module.
//
// Stage 5 has two ways out, exactly like Stage 4: this readiness rule
// ("Complete Stage 5") and the named-approvals gate ("Approved", #46). The rule
// is the precondition for BOTH - the stage's work must be done before it is
// completed or signed off.

import { hasGeneratedPage } from './page-preview-logic.js';
import { assetState } from './assets-logic.js';

const str = (v) => (typeof v === 'string' ? v.trim() : '');
const isHttpUrl = (s) => /^https?:\/\//i.test(str(s));

/**
 * Stage 5's approval set (FR-47): two sign-offs, not Stage 4's four. Generated
 * imagery is judged on how it looks and on what it is allowed to show, so the
 * set is the visual pair of the canonical four in approvals-logic.js. The
 * approvals panel takes the set as a property, so this is a configuration
 * value, not a rule.
 */
export const STAGE5_APPROVALS = ['Brand & Design', 'Compliance'];

/**
 * Whether one asset row is done: it came back with an image AND that image is
 * on the page. `mediaUrl` is the proof of the second half - it is written by
 * the swap (#60), which stores the bytes in DA, rewrites that slot's `<img
 * src>` and re-previews the page. A row that only carries a Firefly
 * `sourceUrl` was generated but never landed. Pure.
 * @param {{status?: string, sourceUrl?: string, mediaUrl?: string}} row
 * @returns {boolean}
 */
function swappedIn(row) {
  return assetState(row) === 'ready' && isHttpUrl(row?.mediaUrl);
}

/**
 * Whether Stage 5's work is done: the page must exist (Stage 4's preview URL is
 * the proof) and every slot the page carries must hold an asset that was
 * generated AND written into the page.
 *
 * The discovered slots are not persisted anywhere: the page doc is the source
 * of truth for them (#59 `extractSlots`), and the panel writes one `assets` row
 * per discovered slot - including a slot whose generation failed, which keeps
 * its placeholder and its row. So the saved rows ARE the discovered slots, and
 * a stage with a row that is not `ready` and swapped is not done. A page with
 * no image slots at all therefore has no rows and stays not-ready, which is
 * honest: Stage 5 has generated nothing.
 *
 * The reason names the next step so the UI can hint. Pure.
 * @param {{previewUrl?: string}} page the project's generated-page record
 * @param {Array<{status?: string, sourceUrl?: string, mediaUrl?: string}>} assets the `assets` rows
 * @returns {{ready: boolean, reason: string}}
 */
export default function stage5Readiness(page, assets) {
  if (!hasGeneratedPage(page)) return { ready: false, reason: 'Generate the page.' };
  const rows = Array.isArray(assets) ? assets : [];
  if (!rows.length || !rows.every(swappedIn)) {
    return { ready: false, reason: 'Generate the assets.' };
  }
  return { ready: true, reason: '' };
}

/**
 * A stamp of where the project's images are: one `slot:mediaUrl` pair per row.
 *
 * The shell re-renders the Assets Rendering view (#63) when this changes, and
 * only then. The grid (#61) announces `assets-changed` twice per run - once
 * when the rows are saved and again after the swap - and a Regenerate lands a
 * new stamp on the same slot (the durable DA address carries the row's
 * timestamp), so this is exactly "the page's pictures moved". Pure.
 * @param {Array<{slot?: number, mediaUrl?: string}>} assets
 * @returns {string}
 */
export function assetsStamp(assets) {
  return (Array.isArray(assets) ? assets : [])
    .filter((r) => isHttpUrl(r?.mediaUrl))
    .map((r) => `${Number(r.slot)}:${str(r.mediaUrl)}`)
    .sort()
    .join('|');
}
