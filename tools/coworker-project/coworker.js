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
// `${wsBase}/ws/sessions/{episode}`, send AUTH then USER_INPUT, collect
// text_delta/text_done, resolve on turn_completed.
//
// `{episode}` is a path parameter, not a fixed endpoint: the sentinel `new`
// mints a fresh AO episode (one "Recents" chat), while an episode id joins that
// existing chat and accumulates turns in it. Ticket #49: the wizard binds the
// project's episode id so all its contract calls land in ONE chat per producer,
// instead of one chat per call.

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

// Build the AUTH frame + ws base, shared by the one-shot client and the chat
// session. Profile fields (org/tenant/user, ws region) are per-user, cached
// module-wide; the token is read fresh each call so a refresh is picked up.
let authCache = null;
async function getConnectionInfo() {
  const token = await currentToken();
  if (!token) throw new Error('no IMS token');
  if (!authCache) {
    const resp = await fetch(IMS_PROFILE_URL, { headers: { Authorization: `Bearer ${token}` } });
    if (!resp.ok) throw new Error(`IMS profile ${resp.status}`);
    const p = await resp.json();
    const ppc = p.projectedProductContext;
    authCache = {
      orgName: tenantNameOf(ppc),
      tenantId: orgIdOf(ppc),
      email: p.email,
      userId: p.userId,
      name: p.displayName || p.name || '',
      wsBase: wsBaseOf(ppc),
    };
  }
  const a = authCache;
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
 * The identity AO attributes a turn to: the IMS profile's email (else its user
 * id), read from the same cached profile the AUTH frame uses. AO episodes are
 * owned by an IMS user, so this is the key a persisted session id is stored
 * under. DA_SDK's app context carries no user, so this profile is the only
 * identity the app has. Resolves to '' when there is no usable token.
 * @returns {Promise<string>}
 */
export async function coworkerUserId() {
  try {
    const { authFrame } = await getConnectionInfo();
    return authFrame['x-user-email'] || authFrame['x-user-id'] || '';
  } catch {
    return '';
  }
}

/**
 * The AO socket URL for one turn. A bound episode id joins that chat; a falsy id
 * uses the `new` sentinel, which mints a fresh episode.
 * @param {string} wsBase
 * @param {string|null} [sessionId]
 * @returns {string}
 */
export function sessionUrl(wsBase, sessionId) {
  return `${wsBase}/ws/sessions/${sessionId || 'new'}`;
}

/**
 * True for the AO rejections that mean "this episode id cannot be served" -
 * deleted, archived, or owned by another user. AO replies with an ERROR frame
 * and then closes 1008. Such a turn is safe to retry on a fresh session.
 * @param {string} message
 * @returns {boolean}
 */
export function isStaleSessionError(message) {
  const m = String(message || '');
  return /episode not found/i.test(m) || /invalid episode_id/i.test(m);
}

/**
 * A dedicated Coworker (AO) client for structured, one-shot prompts.
 */
export class Coworker {
  constructor(context) {
    const { org, repo: site } = context || {};
    this._org = org;
    this._site = site;
    // AO rejects a new turn while one is in flight, so serialize calls.
    this._lock = Promise.resolve();
    // The AO episode every turn joins. `null` means "not opened yet": the next
    // turn opens `sessions/new` and adopts the id AO reports in SESSION_READY.
    this._sessionId = null;
    this._onSessionId = null;
  }

  /**
   * Bind the AO episode later turns join. Pass a persisted id to continue that
   * chat, or `null` to open a fresh one on the next turn. `onSessionId` is
   * called once with each newly adopted id (and with `null` when a bound episode
   * turns out to be unusable) so the caller can persist it.
   * @param {string|null} id
   * @param {(id: string|null) => void} [onSessionId]
   */
  setSessionId(id, onSessionId) {
    this._sessionId = id || null;
    this._onSessionId = typeof onSessionId === 'function' ? onSessionId : null;
  }

  /** Forget the bound episode; the next turn opens a fresh chat. */
  resetSession() {
    this.setSessionId(null, null);
  }

  /** The bound AO episode id, or null. */
  getSessionId() {
    return this._sessionId;
  }

  // Remember the episode AO just reported and hand it to the persister once.
  _adoptSession(id) {
    if (!id || id === this._sessionId) return;
    this._sessionId = id;
    try { this._onSessionId?.(id); } catch { /* best effort - never block the turn */ }
  }

  // Drop an episode AO refused, so the next turn starts a fresh chat.
  _dropSession() {
    this._sessionId = null;
    try { this._onSessionId?.(null); } catch { /* best effort - never block the turn */ }
  }

  // eslint-disable-next-line class-methods-use-this
  async _connectionInfo() {
    return getConnectionInfo();
  }

  /**
   * Send one prompt and resolve with the assistant's final text.
   * @param {string} prompt
   * @param {{ timeoutMs?: number }} [opts]
   * @returns {Promise<string>}
   */
  async ask(prompt, { timeoutMs = 60000 } = {}) {
    const run = this._lock.then(() => this._askOnce(prompt, timeoutMs));
    this._lock = run.catch(() => {});
    return run;
  }

  // One turn, with a single recovery: an episode AO cannot serve costs a chat,
  // never a turn, so drop the id and retry on `new`.
  async _askOnce(prompt, timeoutMs) {
    try {
      return await this._ask(prompt, timeoutMs);
    } catch (e) {
      if (!this._sessionId || !isStaleSessionError(e?.message)) throw e;
      this._dropSession();
      return this._ask(prompt, timeoutMs);
    }
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
        ws = new WebSocket(sessionUrl(wsBase, this._sessionId));
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
          else if (evt.type === 'SESSION_READY') {
            // The episode this turn runs in - remembered so the next turn joins it.
            this._adoptSession(evt.episode_id || evt.context_id);
          } else if (evt.type === 'error' || evt.type === 'ERROR') {
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

  // eslint-disable-next-line class-methods-use-this
  destroy() {
    authCache = null;
  }
}

// One client per app, created lazily.
let singleton;
export function getCoworker(context) {
  if (!singleton) singleton = new Coworker(context);
  return singleton;
}

/**
 * A persistent, multi-turn Coworker (AO) chat session for the "Ask anything"
 * rail (ticket #29). Unlike the one-shot `Coworker`, it keeps ONE WebSocket
 * session open so AO retains conversation memory across turns. It deliberately
 * keeps its OWN episode (`sessions/new`) rather than joining the project chat
 * the wizard binds (#49): the rail and the wizard hold separate turn locks, so
 * sharing one episode needs a shared lock first - a follow-up ticket.
 * A stage-context
 * preamble can be set/replaced (used by the rail, #30) and is prepended to the
 * next message only when it has changed, so context stays fresh without being
 * resent every turn. Responses are one-shot (resolved on turn_completed);
 * token streaming is out of scope here.
 */
export class ChatSession {
  constructor(context) {
    const { org, repo: site } = context || {};
    this._org = org;
    this._site = site;
    this._ws = null;
    this._ready = null; // promise: WS open + AUTH sent
    this._pending = null; // the in-flight turn's collector
    this._context = ''; // stage-context preamble
    this._lastSentContext = null;
    this._lock = Promise.resolve(); // serialize turns (AO rejects concurrent turns)
  }

  /** Set/replace the stage-context preamble; sent with the next changed turn. */
  setContext(preamble) {
    this._context = preamble || '';
  }

  _fail(err) {
    if (this._pending) this._pending.reject(err);
    this._ready = null;
    this._ws = null;
  }

  _ensure() {
    if (this._ready) return this._ready;
    this._ready = new Promise((resolve, reject) => {
      getConnectionInfo().then(({ authFrame, wsBase }) => {
        const ws = new WebSocket(`${wsBase}/ws/sessions/new`);
        this._ws = ws;
        ws.addEventListener('open', () => {
          ws.send(JSON.stringify(authFrame));
          resolve();
        });
        ws.addEventListener('error', () => this._fail(new Error('AO WebSocket error')));
        ws.addEventListener('close', () => this._fail(new Error('AO connection closed')));
        ws.addEventListener('message', (e) => this._onMessage(e));
      }).catch(reject);
    });
    return this._ready;
  }

  _onMessage(event) {
    let evt;
    try { evt = JSON.parse(event.data); } catch { return; }
    const p = this._pending;
    const send = (o) => { try { this._ws?.send(JSON.stringify(o)); } catch { /* noop */ } };
    if (!p) { autoHandle(evt, send); return; } // SESSION_READY / between-turn noise
    if (evt.type === 'text_delta') p.streamed += evt.data?.content ?? '';
    else if (evt.type === 'text_done') p.finalText = evt.data?.content ?? p.streamed;
    else if (evt.type === 'turn_completed') p.resolve(p.finalText ?? p.streamed);
    else if (evt.type === 'error' || evt.type === 'ERROR') {
      p.reject(new Error(evt.data?.message || evt.message || 'AO error'));
    } else autoHandle(evt, send);
  }

  /**
   * Send one chat message and resolve with the assistant's reply. Turns are
   * serialized. The stage-context preamble is prepended only when it changed.
   * @param {string} text - the user's message (display text; preamble is added internally)
   * @param {{ timeoutMs?: number }} [opts]
   * @returns {Promise<string>}
   */
  async send(text, { timeoutMs = 60000 } = {}) {
    const run = this._lock.then(() => this._send(text, timeoutMs));
    this._lock = run.catch(() => {});
    return run;
  }

  _send(text, timeoutMs) {
    return new Promise((resolve, reject) => {
      let settled = false;
      let timer = null;
      const done = (fn, arg) => {
        if (settled) return;
        settled = true;
        if (timer) clearTimeout(timer);
        this._pending = null;
        fn(arg);
      };
      timer = setTimeout(() => done(reject, new Error('coworker timeout')), timeoutMs);
      this._pending = {
        streamed: '',
        finalText: null,
        resolve: (v) => done(resolve, v),
        reject: (e) => done(reject, e),
      };
      this._ensure().then(() => {
        let payload = text;
        if (this._context && this._context !== this._lastSentContext) {
          payload = `${this._context}\n\n${text}`;
          this._lastSentContext = this._context;
        }
        this._ws.send(JSON.stringify({
          type: 'USER_INPUT',
          text: payload,
          manifestId: AO_MANIFEST_ID,
          clientMessageId: crypto.randomUUID(),
          client_context: { org: this._org, site: this._site },
        }));
      }).catch((e) => done(reject, e));
    });
  }

  close() {
    try { this._ws?.close(); } catch { /* noop */ }
    this._ws = null;
    this._ready = null;
    this._pending = null;
    this._lastSentContext = null;
  }
}

/** Open a fresh multi-turn chat session. The caller owns its lifecycle. */
export function openChat(context) {
  return new ChatSession(context);
}
