// Coworker (AO) service seam.
//
// Reuses da.live's hosted nx2 chat-ao `AoChatController` to talk to the Adobe
// Agent Orchestrator (manifest `experience-workspace`) over its WebSocket. This
// is the STRUCTURED-call client: it owns a dedicated AO session, kept separate
// from the visible "Ask anything" chat rail (ticket #19). It exposes `ask()` and
// `askJson()` so later tickets (keyword suggestions #14, cannibalization #15) can
// prompt the agent with a JSON contract we own.
//
// Reachability was verified live for ticket #11: the da.live `darkalley` IMS
// token is accepted by AO server-side, so no extra provisioning is needed for an
// entitled user. Loading the controller from hosted nx2 brings that IMS auth.

/* eslint-disable no-underscore-dangle */
// Private fields and methods use the `_` prefix, matching the Lit components in
// this app (e.g. coworker-project.js). airbnb-base's no-underscore-dangle rule
// fights that idiom, so it is disabled for this module.

const CONTROLLER_URL = 'https://da.live/nx2/blocks/chat-ao/ao-controller.js';
const IMS_URL = 'https://da.live/nx2/utils/ims.js';

// Import the hosted controller once and share it across sessions.
let controllerPromise;
async function loadController() {
  if (!controllerPromise) {
    controllerPromise = import(CONTROLLER_URL).then((m) => m.default || m.AoChatController);
  }
  return controllerPromise;
}

// nx2 `loadIms()` assumes it bootstraps imslib and waits for imslib's `onReady`.
// In the DA app runtime `window.adobeIMS` is already initialized (by DA_SDK), so
// imslib never re-fires `onReady` and `loadIms()` hits its hard 5s timeout - which
// is exactly the auth the AoChatController awaits in `_connectionInfo`. But nx2's
// `setup()` does set `window.adobeid.onReady` synchronously, and that callback
// resolves `loadIms()` from the existing signed-in `adobeIMS`. So we fire it once
// ourselves to warm the shared, memoized `loadIms` before the controller connects.
// Verified for ticket #13; harmless when the memo is already warm.
let imsWarmed;
async function warmIms() {
  if (!imsWarmed) {
    imsWarmed = (async () => {
      const { loadIms } = await import(IMS_URL);
      const pending = loadIms();
      const ims = window.adobeIMS;
      const signedIn = ims && ims.isSignedInUser && ims.isSignedInUser()
        && ims.getAccessToken && ims.getAccessToken();
      if (signedIn && window.adobeid && typeof window.adobeid.onReady === 'function') {
        try { window.adobeid.onReady(); } catch { /* the memo will still settle or time out */ }
      }
      return pending;
    })();
  }
  return imsWarmed;
}

// Newest assistant reply at or after `fromIndex`, or null.
function lastAssistant(messages, fromIndex) {
  for (let i = messages.length - 1; i >= fromIndex; i -= 1) {
    const m = messages[i];
    if (m && m.role === 'assistant' && typeof m.content === 'string') return m.content;
  }
  return null;
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
 * A dedicated Coworker (AO) session for structured, one-shot prompts.
 */
export class Coworker {
  constructor(context) {
    const { org, repo: site } = context || {};
    this._org = org;
    this._site = site;
    this._ctrl = null;
    this._ready = null;
    this._state = { messages: [] };
    this._onState = null;
    // AO rejects a new USER_INPUT while a turn is thinking, so serialize calls.
    this._lock = Promise.resolve();
  }

  async _ensure() {
    if (!this._ready) {
      this._ready = (async () => {
        // Warm IMS first so the controller's `_connectionInfo` gets a resolved token.
        await warmIms();
        const AoChatController = await loadController();
        this._ctrl = new AoChatController({
          onUpdate: (st) => { this._state = st; if (this._onState) this._onState(st); },
        });
        this._ctrl.setContext({ org: this._org, site: this._site });
      })();
    }
    return this._ready;
  }

  // Keep a structured turn flowing: approve tool permissions and plans, decline
  // clarifying questions (we cannot answer them mid one-shot call).
  _autoHandle(st) {
    try {
      const perm = st.pendingPermission;
      if (perm && perm.calls && perm.calls.length) {
        const decided = perm.decisions || {};
        perm.calls.forEach((c) => {
          if (!(c.toolCallId in decided)) this._ctrl.respondToPermission(c.toolCallId, true);
        });
      } else if (st.pendingPlanApproval) {
        this._ctrl.respondToPlanApproval('approve');
      } else if (st.pendingQuestion) {
        this._ctrl.declineQuestion();
      }
    } catch { /* best effort - never block the turn */ }
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
      this._ensure().then(() => {
        const baseline = (this._state.messages || []).length;
        let sawThinking = false;
        let settled = false;
        let timer = null;
        const finish = (fn, arg) => {
          if (settled) return;
          settled = true;
          this._onState = null;
          if (timer) clearTimeout(timer);
          fn(arg);
        };
        timer = setTimeout(() => finish(reject, new Error('coworker timeout')), timeoutMs);
        this._onState = (st) => {
          this._autoHandle(st);
          if (st.thinking) sawThinking = true;
          const idle = !st.thinking && !st.streamingText
            && !st.pendingQuestion && !st.pendingPlanApproval && !st.pendingPermission;
          const answer = lastAssistant(st.messages || [], baseline);
          if (idle && (sawThinking || answer != null)) {
            if (answer != null) finish(resolve, answer);
            else finish(reject, new Error('coworker returned no answer'));
          }
        };
        this._ctrl.sendMessage(prompt);
      }).catch(reject);
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
    try { if (this._ctrl) this._ctrl.destroy(); } catch { /* noop */ }
    this._ready = null;
    this._ctrl = null;
  }
}

// One structured-call session per app, created lazily.
let singleton;
export function getCoworker(context) {
  if (!singleton) singleton = new Coworker(context);
  return singleton;
}
