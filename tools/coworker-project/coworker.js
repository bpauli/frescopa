/* eslint-disable no-underscore-dangle */
// Coworker (AO) service seam - a minimal, direct Agent Orchestrator WebSocket
// client for structured, one-shot prompts (`ask` -> text, `askJson` -> parsed).
//
// Why not the hosted nx2 `AoChatController`? It assumes it runs inside da.live's
// own nx2 runtime: it needs imslib to initialize `window.adobeIMS` (which never
// happens in this app's iframe, served from a foreign origin) and it reads the
// IMS client id from the nx runtime config (unbootstrapped here -> "Missing IMS
// Client ID"). Rather than shim da.live internals, we talk to AO directly.
//
// Auth uses the IMS token DA_SDK bridges from the parent frame (kept fresh by
// DA_SDK's refresh listener), which we read via `initIms()` from daFetch. From
// that token we fetch the IMS profile once for the org/tenant/user fields the
// AUTH frame needs. Protocol (verified for ticket #11): open
// `${wsBase}/ws/sessions/new`, send AUTH then USER_INPUT, collect
// text_delta/text_done, resolve on turn_completed.

const DAFETCH_URL = 'https://da.live/nx/utils/daFetch.js';
const IMS_PROFILE_URL = 'https://ims-na1.adobelogin.com/ims/profile/v1?client_id=darkalley';
const AO_WS_BASE = 'wss://agent-orchestrator-prod-va7.adobe.io';
const AO_MANIFEST_ID = 'experience-workspace';

// x-org-name: the dma_tartan tenant id (e.g. "sitesinternal").
const tenantNameOf = (ppc) => ppc?.find((p) => p.prodCtx?.serviceCode === 'dma_tartan')?.prodCtx?.tenant_id;
// x-tenant-id: the owning IMS org (e.g. "...@AdobeOrg").
const orgIdOf = (ppc) => ppc?.find((p) => p.prodCtx?.owningEntity)?.prodCtx?.owningEntity;

// AO region base from the IMS profile, else the default prod base (see nx2
// uploads.js resolveAoWsBase - replicated so we do not depend on that module).
function wsBaseOf(ppc) {
  const found = ppc?.find(({ prodCtx } = {}) => prodCtx?.statusCode === 'ACTIVE'
    && (prodCtx?.serviceCode === 'acp' || prodCtx?.serviceCode === 'dma_tartan'));
  try {
    const { region, environment } = JSON.parse(found?.prodCtx?.fulfillable_data ?? 'null') ?? {};
    if (region && environment) {
      return `wss://agent-orchestrator-${environment.toLowerCase()}-${region.toLowerCase()}.adobe.io`;
    }
  } catch { /* fall through to the default */ }
  return AO_WS_BASE;
}

// The current bridged IMS access token, or ''. daFetch is imported dynamically
// (hosted URL) so this module stays importable outside the browser.
async function currentToken() {
  try {
    const { initIms } = await import(DAFETCH_URL);
    const details = await initIms();
    return details?.accessToken?.token || '';
  } catch {
    return '';
  }
}

// Best-effort auto-handling so a one-shot turn is not left hanging on a
// permission/plan/question gate (our structured prompts rarely hit these).
function autoHandle(evt, send) {
  try {
    if (evt.type === 'permission_request') {
      const calls = evt.data?.calls ?? evt.data?.tool_calls ?? [];
      const decisions = Object.fromEntries(calls.map((c) => {
        const id = c.tool_call_id ?? c.toolCallId;
        return [id, { tool_call_id: id, approved: true }];
      }));
      send({ type: 'PERMISSION_RESPONSE', turn_id: evt.turn_id, decisions });
    } else if (evt.type === 'plan_approval_request') {
      send({
        type: 'RESUME',
        turn_id: evt.turn_id,
        data: {
          type: 'plan-response', decision: 'approve', feedback: '', edited_plan_content: null,
        },
      });
    } else if (evt.type === 'user_question') {
      send({
        type: 'QUESTION_RESPONSE', turn_id: evt.turn_id, answers: [], declined: true,
      });
    }
  } catch { /* best effort - never block the turn */ }
}

/**
 * Pull the first JSON value out of an assistant reply. Handles ```json fences,
 * bare objects/arrays, and leading prose.
 * @param {string} text
 * @returns {any}
 */
export function extractJson(text) {
  if (!text) throw new Error('empty response');
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fence ? fence[1] : text;
  const tryParse = (s) => { try { return JSON.parse(s.trim()); } catch { return undefined; } };

  const direct = tryParse(candidate);
  if (direct !== undefined) return direct;

  const start = candidate.search(/[[{]/);
  if (start !== -1) {
    for (let end = candidate.length; end > start; end -= 1) {
      const v = tryParse(candidate.slice(start, end));
      if (v !== undefined) return v;
    }
  }
  throw new Error('no JSON found in response');
}

/**
 * A dedicated Coworker (AO) client for structured, one-shot prompts.
 */
export class Coworker {
  constructor(context) {
    const { org, repo: site } = context || {};
    this._org = org;
    this._site = site;
    this._auth = null; // cached org/tenant/user fields (token fetched per call)
    // AO rejects a new turn while one is in flight, so serialize calls.
    this._lock = Promise.resolve();
  }

  // Build the AUTH frame + ws base. Profile fields are cached; the token is
  // read fresh each call so a refresh mid-session is picked up.
  async _connectionInfo() {
    const token = await currentToken();
    if (!token) throw new Error('no IMS token');
    if (!this._auth) {
      const resp = await fetch(IMS_PROFILE_URL, { headers: { Authorization: `Bearer ${token}` } });
      if (!resp.ok) throw new Error(`IMS profile ${resp.status}`);
      const p = await resp.json();
      const ppc = p.projectedProductContext;
      this._auth = {
        orgName: tenantNameOf(ppc),
        tenantId: orgIdOf(ppc),
        email: p.email,
        userId: p.userId,
        name: p.displayName || p.name || '',
        wsBase: wsBaseOf(ppc),
      };
    }
    const a = this._auth;
    return {
      wsBase: a.wsBase,
      authFrame: {
        type: 'AUTH',
        authorization: `Bearer ${token}`,
        'x-org-name': a.orgName,
        'x-tenant-id': a.tenantId,
        'x-user-email': a.email,
        'x-user-id': a.userId,
        'x-user-name': a.name,
      },
    };
  }

  /**
   * Send one prompt and resolve with the assistant's final text.
   * @param {string} prompt
   * @param {{ timeoutMs?: number }} [opts]
   * @returns {Promise<string>}
   */
  async ask(prompt, { timeoutMs = 60000 } = {}) {
    const run = this._lock.then(() => this._ask(prompt, timeoutMs));
    this._lock = run.catch(() => {});
    return run;
  }

  _ask(prompt, timeoutMs) {
    return new Promise((resolve, reject) => {
      let settled = false;
      let ws = null;
      let streamed = '';
      let finalText = null;
      let timer = null;
      const finish = (fn, arg) => {
        if (settled) return;
        settled = true;
        if (timer) clearTimeout(timer);
        try { if (ws) ws.close(); } catch { /* noop */ }
        fn(arg);
      };
      timer = setTimeout(() => finish(reject, new Error('coworker timeout')), timeoutMs);

      this._connectionInfo().then(({ authFrame, wsBase }) => {
        ws = new WebSocket(`${wsBase}/ws/sessions/new`);
        const send = (o) => ws.send(JSON.stringify(o));
        ws.addEventListener('open', () => {
          // AO expects AUTH then USER_INPUT; SESSION_READY arrives after.
          send(authFrame);
          send({
            type: 'USER_INPUT',
            text: prompt,
            manifestId: AO_MANIFEST_ID,
            clientMessageId: crypto.randomUUID(),
            client_context: { org: this._org, site: this._site },
          });
        });
        ws.addEventListener('error', () => finish(reject, new Error('AO WebSocket error')));
        ws.addEventListener('close', () => finish(reject, new Error('AO connection closed')));
        ws.addEventListener('message', (event) => {
          let evt;
          try { evt = JSON.parse(event.data); } catch { return; }
          if (evt.type === 'text_delta') streamed += evt.data?.content ?? '';
          else if (evt.type === 'text_done') finalText = evt.data?.content ?? streamed;
          else if (evt.type === 'turn_completed') finish(resolve, finalText ?? streamed);
          else if (evt.type === 'error' || evt.type === 'ERROR') {
            finish(reject, new Error(evt.data?.message || evt.message || 'AO error'));
          } else autoHandle(evt, send);
        });
      }).catch((e) => finish(reject, e));
    });
  }

  /**
   * Send a prompt that must return JSON; parse and return it. Retries once with a
   * stricter instruction on a parse failure.
   * @param {string} prompt
   * @param {{ timeoutMs?: number, retries?: number }} [opts]
   * @returns {Promise<any>}
   */
  async askJson(prompt, { timeoutMs, retries = 1 } = {}) {
    const strict = '\n\nReturn ONLY valid JSON. No prose and no markdown code fences.';
    let lastErr;
    for (let attempt = 0; attempt <= retries; attempt += 1) {
      const p = attempt === 0 ? prompt : prompt + strict;
      // eslint-disable-next-line no-await-in-loop
      const text = await this.ask(p, { timeoutMs });
      try {
        return extractJson(text);
      } catch (e) {
        lastErr = e;
      }
    }
    throw new Error(`coworker JSON parse failed: ${lastErr && lastErr.message}`);
  }

  destroy() {
    this._auth = null;
  }
}

// One client per app, created lazily.
let singleton;
export function getCoworker(context) {
  if (!singleton) singleton = new Coworker(context);
  return singleton;
}
