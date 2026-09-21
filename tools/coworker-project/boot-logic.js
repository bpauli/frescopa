// Boot-time failure surface for the Coworker Projects app.
//
// This app can paint nothing at all in two ways, both of them silent:
//
//   1. its ES module graph fails to load - one 404'd import kills the whole
//      graph, so `coworker-project.js` never evaluates and its init() never
//      runs. `coworker-project.html` catches that inline, because a module
//      cannot report its own failure to load;
//   2. the DA shell never completes the SDK handshake, so `await DA_SDK` never
//      settles and init() waits forever. That one is this module's job.
//
// Both left `<body>` empty with no message. The rules live here, and not in
// coworker-project.js, for the same reason stage4-logic.js does: that module
// boots the app on import, so it cannot be unit tested.

/** How long to wait for the DA shell handshake before saying so on screen. */
export const CONTEXT_TIMEOUT_MS = 8000;

/** Shown when the DA app context never arrives. */
export const CONTEXT_TIMEOUT_TEXT = 'DA app context not received. This app runs inside the DA '
  + 'shell - open it from da.live/app/..., or reload the DA tab to retry the handshake.';

/**
 * Wait for the DA app context, but give up waiting silently. Never rejects and
 * never hangs: the caller always learns which of the two happened, so it can
 * put a message on screen instead of leaving an empty page.
 *
 * Giving up waiting is not giving up: the SDK promise stays live, so a caller
 * that keeps awaiting it still boots when a slow handshake lands late.
 *
 * @param {Promise} sdk the DA_SDK promise (or any thenable)
 * @param {number} [timeoutMs] how long to wait
 * @returns {Promise<{ok: true, value: any} | {ok: false, reason: string, error?: Error}>}
 */
export async function awaitContext(sdk, timeoutMs = CONTEXT_TIMEOUT_MS) {
  let timer;
  const timeout = new Promise((resolve) => {
    timer = setTimeout(() => resolve({ ok: false, reason: 'timeout' }), timeoutMs);
  });
  const settled = Promise.resolve(sdk).then(
    (value) => ({ ok: true, value }),
    (error) => ({ ok: false, reason: 'error', error }),
  );
  const result = await Promise.race([settled, timeout]);
  clearTimeout(timer);
  return result;
}
