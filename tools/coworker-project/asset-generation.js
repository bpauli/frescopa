// Stage 5 asset-generation contract (ticket #59).
//
// The reusable seam that turns the placeholder images Stage 4 left in the page
// doc into real Firefly assets, over the structured Coworker (AO) client
// (coworker.js `askJson`). Four steps, each usable on its own:
//   1. `readPageDoc`      - read the generated page back from DA (the doc is the
//                           source of truth; Stage 4 persists no outline).
//   2. `extractSlots`     - find every placeholder `<img>` in document order.
//   3. `buildAssetPrompt` - slot `alt` + Stage 2 creative direction + aspect.
//   4. `generateAsset(s)` - one AO turn that generates the images.
// Like the sibling contracts it never throws: every failure degrades to a soft
// error row the panel (#61) can render without a try/catch, and a failed slot
// simply keeps its placeholder.
//
// The recipe below is not a guess - gate #57 proved it live. The facts that
// shape this file:
//   - AO drives the WHOLE Firefly loop inside ONE turn: it calls
//     `generateImagesV3Async`, polls `jobResultV3`, and sleeps between polls
//     with its own `sleep` tool. The app polls NOTHING; it makes one `ask`.
//   - AO batches slots in parallel: N slots cost the same ~45 s as one. So the
//     page-level primitive is `generateAssets` (one turn for the whole page);
//     `generateAsset` is the single-slot case of it, used by Regenerate.
//   - A real generation turn takes 37-48 s and the `ask`/`askJson` default
//     timeout is 60 000 ms, which leaves no margin. Hence `ASSET_TIMEOUT_MS`.
//   - AO silently DROPS keys from a bulleted parameter list, so the Firefly
//     `requestBody` is handed over verbatim and echoed back as
//     `sentRequestBody`. `buildRequestBody` owns that object.
//   - `size` must be pinned from the slot geometry against the Firefly
//     allow-list: an unlisted size is a hard 400, and true 16:9 is 2688x1512,
//     NOT the 2688x1536 (7:4) AO picks for itself.
//   - The Firefly tool reports NO model. `model` is only ever what we sent, so
//     it is best-effort metadata, never tool fact.
//
// Storage note: `generateAsset` returns the Firefly `sourceUrl` (a presigned S3
// URL that expires after one hour) plus the metadata around it, and stops
// there. What the page doc finally references - the raw Firefly URL or a
// permanent DA-hosted copy of the bytes - is the page-swap ticket's (#60) call,
// and nothing here assumes the expiring URL is the final answer.

import { getCoworker } from './coworker.js';
import { derivePagePath } from './page-generation.js';

const DA_ADMIN = 'https://admin.da.live';

// The placeholder image service Stage 4 writes into the page doc
// (page-generation.js `PLACEHOLDER_BASE`). A slot is an `<img>` pointing here.
const PLACEHOLDER_HOST = 'placehold.co';

// Stage 4 emits 1600x900 slots; used when a placeholder carries no geometry.
const DEFAULT_ASPECT = '16:9';

// Every `size` pair `Firefly__generateImagesV3Async` accepts (gate #57, read off
// the tool schema). Anything else is a 400, so the pinned size comes from here.
const FIREFLY_SIZES = [
  { width: 2048, height: 2048 },
  { width: 1024, height: 1024 },
  { width: 2304, height: 1792 },
  { width: 1792, height: 2304 },
  { width: 2688, height: 1536 },
  { width: 2688, height: 1512 },
  { width: 1344, height: 768 },
  { width: 1344, height: 756 },
  { width: 1152, height: 896 },
  { width: 896, height: 1152 },
  { width: 1440, height: 2560 },
];

// `x-model-version` we pin. The tool never reports a model, so this value IS
// the recorded `model` unless AO echoes a different one back.
const MODEL = 'image4_standard';

// Firefly's `prompt` is 1..1024 characters; a longer prompt is a 400.
const PROMPT_MAX = 1024;

// One asset per slot - the schema default is 2 and the map says one.
const VARIATIONS = 1;

// A generation turn takes 37-48 s, so the 60 s `askJson` default is not
// survivable. Stage 5 must pass this explicitly (gate #57).
export const ASSET_TIMEOUT_MS = 300000;

// A page has 4-6 image slots; the cap keeps one runaway doc from building an
// unbounded prompt. Slots past the cap come back as a soft error.
const MAX_SLOTS = 12;

const GENERATED = 'Generated';
const FAILED = 'Failed';

const str = (v) => (typeof v === 'string' ? v.trim() : '');

const num = (v) => (Number.isFinite(v) ? v : Number.parseInt(v, 10) || 0);

// Reverse of page-generation.js `escapeHtml`, for attribute values read back out
// of the doc. `&amp;` last, so an escaped entity is not double-decoded.
const unescapeHtml = (s) => String(s)
  .replaceAll('&quot;', '"')
  .replaceAll('&#39;', "'")
  .replaceAll('&lt;', '<')
  .replaceAll('&gt;', '>')
  .replaceAll('&amp;', '&');

// --- slot discovery ---

const IMG_TAG_RE = /<img\b[^>]*>/gi;

// One attribute off an `<img ...>` tag, single or double quoted, unescaped.
function attr(tag, name) {
  const m = tag.match(new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`, 'i'));
  return m ? unescapeHtml(m[1] ?? m[2] ?? '') : '';
}

const gcd = (a, b) => (b ? gcd(b, a % b) : a);

/**
 * Reduce a pixel geometry to a `"W:H"` ratio string (e.g. 1600x900 -> "16:9").
 * Returns '' when either side is not a positive number. Pure.
 * @param {number} width
 * @param {number} height
 * @returns {string}
 */
export function aspectRatio(width, height) {
  const w = Math.round(num(width));
  const h = Math.round(num(height));
  if (w <= 0 || h <= 0) return '';
  const d = gcd(w, h);
  return `${w / d}:${h / d}`;
}

// The geometry a placehold.co URL carries in its path (".../1600x900/e9e9e9").
function placeholderAspect(src) {
  const m = String(src).match(/\/(\d{2,5})x(\d{2,5})(?:[/?#]|$)/);
  return m ? aspectRatio(Number(m[1]), Number(m[2])) || DEFAULT_ASPECT : DEFAULT_ASPECT;
}

/**
 * Every placeholder `<img>` in a page doc, in document order.
 *
 * `slot` is the image's index among ALL `<img>` elements in the doc, not among
 * the placeholders: that keeps the key stable once some slots have been swapped
 * for real assets, so a later read still identifies the same slot and a
 * Regenerate replaces exactly one assets row. Pure.
 * @param {string} html - the DA page doc
 * @returns {Array<{slot: number, alt: string, src: string, aspect: string}>}
 */
export function extractSlots(html) {
  const doc = typeof html === 'string' ? html : '';
  const out = [];
  let index = 0;
  const tags = doc.match(IMG_TAG_RE) || [];
  tags.forEach((tag) => {
    const src = attr(tag, 'src');
    const slot = index;
    index += 1;
    if (!src.includes(PLACEHOLDER_HOST)) return;
    out.push({
      slot, alt: attr(tag, 'alt'), src, aspect: placeholderAspect(src),
    });
  });
  return out;
}

/**
 * Read the generated page doc back from DA. The doc - not any persisted
 * outline - is the source of truth for the page's image slots. Never throws:
 * a failure comes back as an empty `html` plus a soft error.
 * @param {(url: string, opts?: object) => Promise<Response>} daFetch
 * @param {string} org
 * @param {string} site
 * @param {string} path - the page path, with or without a `.html` extension
 * @returns {Promise<{html: string, error: string|null}>}
 */
export async function readPageDoc(daFetch, org, site, path) {
  const target = derivePagePath(path);
  if (!org || !site || typeof daFetch !== 'function') {
    return { html: '', error: 'Missing DA context.' };
  }
  if (!target) return { html: '', error: 'The project has no generated page yet.' };
  try {
    const resp = await daFetch(`${DA_ADMIN}/source/${org}/${site}${target}.html`);
    if (!resp.ok) {
      return { html: '', error: `Could not read the page: ${resp.status} ${resp.statusText}` };
    }
    return { html: await resp.text(), error: null };
  } catch (e) {
    return { html: '', error: `Could not read the page: ${e.message || 'unknown error'}` };
  }
}

// --- prompt ---

// Close an authored fragment so it reads as one sentence in the prompt.
const sentence = (s) => (s && !/[.!?]$/.test(s) ? `${s}.` : s);

function orientation(aspect) {
  const [w, h] = String(aspect).split(':').map(Number);
  if (!w || !h) return '';
  if (w === h) return 'square';
  return w > h ? 'landscape' : 'portrait';
}

/**
 * The Firefly prompt for one slot: what the page says the picture shows (the
 * slot `alt`, written by AO in Stage 4), the Stage 2 creative direction that
 * keeps every asset on the same look, and the crop. Capped at Firefly's 1024
 * character limit. Pure.
 * @param {{alt?: string, aspect?: string}} slot
 * @param {{visualStyle?: object, colorPalette?: object}} [creativeDirection]
 * @returns {string}
 */
export function buildAssetPrompt(slot, creativeDirection) {
  const cd = creativeDirection || {};
  const aspect = str(slot?.aspect) || DEFAULT_ASPECT;
  const parts = [];

  // Stage 4's alt is usually a full sentence, but not always punctuated; the
  // prompt reads as one sentence per clause, so close it when it is open.
  const subject = str(slot?.alt);
  parts.push(sentence(subject) || 'An editorial photograph for a marketing web page.');

  const styleName = str(cd.visualStyle?.name);
  const styleDesc = str(cd.visualStyle?.description);
  if (styleName || styleDesc) {
    parts.push(sentence(`Visual style: ${[styleName, styleDesc].filter(Boolean).join(' - ')}`));
  }

  const paletteName = str(cd.colorPalette?.name);
  const paletteDesc = str(cd.colorPalette?.description);
  const rawColors = cd.colorPalette?.colors;
  const colors = (Array.isArray(rawColors) ? rawColors : []).map(str).filter(Boolean);
  const head = [paletteName, paletteDesc].filter(Boolean).join(' - ');
  if (head) parts.push(sentence(`Colour palette: ${head}`));
  if (colors.length) {
    parts.push(`${head ? '' : 'Colour palette: '}Use these colours: ${colors.join(', ')}.`);
  }

  const shape = orientation(aspect);
  parts.push(`Composed for a ${aspect}${shape ? ` ${shape}` : ''} crop.`);
  parts.push('No text, no lettering, no watermark, no logo.');

  const prompt = parts.join(' ').replace(/\s+/g, ' ').trim();
  return prompt.length <= PROMPT_MAX ? prompt : `${prompt.slice(0, PROMPT_MAX - 3).trimEnd()}...`;
}

// --- Firefly request ---

/**
 * The Firefly `size` for an aspect ratio: the allow-listed pair whose ratio is
 * closest to it, largest first. Unlisted sizes are a hard 400, and AO's own
 * "16:9" guess (2688x1536) is really 7:4 and crops differently - so the app
 * pins the size rather than describing it. Pure.
 * @param {string} aspect - a `"W:H"` ratio
 * @returns {{width: number, height: number}}
 */
export function fireflySize(aspect) {
  const [w, h] = String(aspect ?? '').split(':').map(Number);
  const target = Math.log(w > 0 && h > 0 ? w / h : 16 / 9);
  const drift = (s) => Math.abs(Math.log(s.width / s.height) - target);
  const area = (s) => s.width * s.height;
  const best = FIREFLY_SIZES.reduce((winner, size) => {
    const gap = drift(size) - drift(winner);
    if (gap < -1e-9) return size;
    if (gap < 1e-9 && area(size) > area(winner)) return size;
    return winner;
  });
  return { ...best };
}

/**
 * The verbatim Firefly `requestBody` for one slot. AO is handed this object
 * unchanged because it silently drops keys from a described parameter list
 * (proven in gate #57: `x-model-version` vanished), and every key here is a
 * deliberate pin: one variation (the schema default is 2), a photo content
 * class, the allow-listed size for the slot's crop, and the model whose id we
 * later record. Pure.
 * @param {string} prompt
 * @param {string} aspect
 * @returns {{prompt: string, numVariations: number, contentClass: string,
 *   size: {width: number, height: number}, 'x-model-version': string}}
 */
export function buildRequestBody(prompt, aspect) {
  const text = str(prompt).slice(0, PROMPT_MAX);
  return {
    prompt: text,
    numVariations: VARIATIONS,
    contentClass: 'photo',
    size: fireflySize(aspect),
    'x-model-version': MODEL,
  };
}

/**
 * The single AO turn that generates every slot: one instruction per slot with
 * its verbatim requestBody, an explicit "start them all before polling" so AO
 * keeps batching, and a fixed JSON answer shape filled from the tool values.
 * Pure.
 * @param {Array<{slot: number, requestBody: object}>} jobs
 * @returns {string}
 */
export function buildGenerationPrompt(jobs) {
  const blocks = jobs.map((job) => `Slot ${job.slot}:\n${JSON.stringify(job.requestBody)}`).join('\n\n');
  const shape = '{"assets":[{"slot":0,"status":"","jobId":"","sourceUrl":"","seed":0,'
    + '"width":0,"height":0,"description":"","sentRequestBody":{}}]}';
  return 'Use the Firefly image generation tool to create one image for each slot below.\n\n'
    + `There ${jobs.length === 1 ? 'is 1 slot' : `are ${jobs.length} slots`}. `
    + 'For each slot, call Firefly__generateImagesV3Async ONCE with exactly the requestBody '
    + 'given for that slot, changing nothing and dropping no key. Start every slot before you '
    + 'poll any of them.\n\n'
    + `${blocks}\n\n`
    + 'Then poll Firefly__jobResultV3 with each returned jobId until that job is no longer '
    + 'running, using your sleep tool between polls.\n\n'
    + 'When every job has finished, return ONLY valid JSON (no prose, no markdown fences) in '
    + `this shape, one entry per slot, filled with the exact values the tool reported:\n${shape}\n`
    + 'where "slot" is the slot number above, "sourceUrl" is that job\'s '
    + 'result.outputs[0].image.url copied exactly as the tool returned it, "seed", "width" and '
    + '"height" come from the same result, "sentRequestBody" is the requestBody object you '
    + 'actually passed, and "description" is one short sentence describing the image you '
    + 'generated. Set "status" to "succeeded" only for a slot whose job succeeded; for a slot '
    + 'that failed, set "status" to the reported failure, leave "sourceUrl" empty, and still '
    + 'return the other slots.';
}

// --- answer parsing ---

const isHttpUrl = (s) => /^https?:\/\//i.test(s);

// The asset rows AO returned, keyed by slot number.
function answerRows(raw) {
  let list = [];
  if (Array.isArray(raw)) list = raw;
  else if (Array.isArray(raw?.assets)) list = raw.assets;
  else if (raw && typeof raw === 'object') list = [raw];

  const bySlot = new Map();
  list.forEach((item, i) => {
    if (!item || typeof item !== 'object') return;
    const slot = Number.isFinite(item.slot) ? item.slot : Number.parseInt(item.slot, 10);
    bySlot.set(Number.isFinite(slot) ? slot : i, item);
  });
  return bySlot;
}

/**
 * Turn one AO generation answer into one result row per requested job, in the
 * order the jobs were asked for. A row that came back without a usable
 * `sourceUrl` - or did not come back at all - is a soft error, so the rest of
 * the page still lands. `model` is best-effort: the Firefly tool reports no
 * model, so it can only be the `x-model-version` we pinned (preferring what AO
 * echoes back as actually sent). Pure.
 * @param {unknown} raw - the parsed AO answer
 * @param {Array<{slot: number, prompt: string, aspect: string}>} jobs
 * @param {string} createdAt - ISO timestamp for the whole turn
 * @returns {Array<object>}
 */
export function parseAssetAnswer(raw, jobs, createdAt) {
  const rows = answerRows(raw);
  return (Array.isArray(jobs) ? jobs : []).map((job) => {
    const base = {
      slot: job.slot,
      prompt: job.prompt,
      aspect: job.aspect,
      sourceUrl: '',
      model: '',
      description: '',
      seed: 0,
      jobId: '',
      width: 0,
      height: 0,
      createdAt,
      status: FAILED,
      error: 'No image came back for this slot.',
    };
    const row = rows.get(job.slot);
    if (!row) return base;

    const sourceUrl = str(row.sourceUrl || row.url || row.image?.url);
    const status = str(row.status).toLowerCase();
    const sent = row.sentRequestBody && typeof row.sentRequestBody === 'object'
      ? row.sentRequestBody : {};
    const model = str(sent['x-model-version']) || MODEL;

    if (!isHttpUrl(sourceUrl)) {
      return {
        ...base,
        model,
        error: status && status !== 'succeeded'
          ? `Firefly did not finish this slot: ${str(row.status)}`
          : 'No image came back for this slot.',
      };
    }
    return {
      ...base,
      sourceUrl,
      model,
      description: str(row.description),
      seed: num(row.seed),
      jobId: str(row.jobId),
      width: num(row.width),
      height: num(row.height),
      status: GENERATED,
      error: null,
    };
  });
}

// --- generation ---

// Validate and shape the requested jobs. An unusable job never reaches AO; it
// comes back as a soft error row in its own place.
function planJobs(list, createdAt) {
  const jobs = [];
  const failures = new Map();
  (Array.isArray(list) ? list : []).forEach((item, i) => {
    const slot = Number.isFinite(item?.slot) ? item.slot : i;
    const prompt = str(item?.prompt);
    const aspect = str(item?.aspect) || DEFAULT_ASPECT;
    const fail = (error) => failures.set(slot, {
      slot,
      prompt,
      aspect,
      sourceUrl: '',
      model: '',
      description: '',
      seed: 0,
      jobId: '',
      width: 0,
      height: 0,
      createdAt,
      status: FAILED,
      error,
    });
    if (!prompt) fail('This slot has no prompt.');
    else if (jobs.length >= MAX_SLOTS) fail(`Only ${MAX_SLOTS} slots can be generated at once.`);
    else {
      jobs.push({
        slot, prompt, aspect, requestBody: buildRequestBody(prompt, aspect),
      });
    }
  });
  return { jobs, failures };
}

/**
 * Generate the assets for a whole page in ONE AO turn.
 *
 * This is the page-level primitive: AO batches the Firefly calls and drives the
 * poll loop itself, so N slots cost roughly the same ~45 s as one, and the app
 * makes exactly one `askJson` call - with an explicit `ASSET_TIMEOUT_MS`,
 * because the 60 s default is shorter than a real turn. Never throws: a failed
 * slot comes back as `status: 'Failed'` plus a message, and keeps its
 * placeholder while the other slots proceed.
 *
 * `sourceUrl` is the Firefly presigned URL, which expires after an hour; where
 * the page doc finally points is the page-swap ticket's (#60) decision.
 * @param {{org: string, repo: string}} context
 * @param {Array<{slot: number, prompt: string, aspect: string}>} slots
 * @returns {Promise<Array<{slot: number, prompt: string, aspect: string,
 *   sourceUrl: string, model: string, description: string, seed: number,
 *   jobId: string, width: number, height: number, createdAt: string,
 *   status: string, error: string|null}>>}
 */
export async function generateAssets(context, slots) {
  const createdAt = new Date().toISOString();
  const { jobs, failures } = planJobs(slots, createdAt);
  const ordered = (results) => {
    const bySlot = new Map(results.map((r) => [r.slot, r]));
    failures.forEach((row, slot) => bySlot.set(slot, row));
    return [...bySlot.values()].sort((a, b) => a.slot - b.slot);
  };

  if (!jobs.length) return ordered([]);

  const softFail = (error) => ordered(jobs.map((job) => ({
    slot: job.slot,
    prompt: job.prompt,
    aspect: job.aspect,
    sourceUrl: '',
    model: MODEL,
    description: '',
    seed: 0,
    jobId: '',
    width: 0,
    height: 0,
    createdAt,
    status: FAILED,
    error,
  })));

  if (!context?.org || !context?.repo) return softFail('Missing Coworker context.');

  try {
    const json = await getCoworker(context).askJson(
      buildGenerationPrompt(jobs),
      { timeoutMs: ASSET_TIMEOUT_MS },
    );
    return ordered(parseAssetAnswer(json, jobs, createdAt));
  } catch (e) {
    return softFail(e.message || 'Asset generation failed.');
  }
}

/**
 * Generate ONE asset - the single-slot case of `generateAssets`, and the call
 * Regenerate makes. Never throws: a failure is a `status: 'Failed'` row and the
 * slot keeps its placeholder.
 * @param {{org: string, repo: string}} context
 * @param {{slot?: number, prompt: string, aspect?: string}} job
 * @returns {Promise<object>} the single result row (see `generateAssets`)
 */
export async function generateAsset(context, { slot = 0, prompt, aspect } = {}) {
  const [row] = await generateAssets(context, [{ slot, prompt, aspect }]);
  return row;
}
