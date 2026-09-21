import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { awaitContext, CONTEXT_TIMEOUT_TEXT, CONTEXT_TIMEOUT_MS } from './boot-logic.js';

const HTML = readFileSync(new URL('./coworker-project.html', import.meta.url), 'utf-8');

test('awaitContext hands back the context the DA shell sent', async () => {
  const sdk = Promise.resolve({ context: { org: 'bpauli' }, token: 't', actions: {} });
  const result = await awaitContext(sdk, 1000);
  assert.equal(result.ok, true);
  assert.deepEqual(result.value.context, { org: 'bpauli' });
});

test('awaitContext gives up waiting on a handshake that never lands', async () => {
  // The blank-page mode this replaces: `await DA_SDK` on a promise that never
  // settles used to hang init() forever, leaving <body> empty and silent.
  const never = new Promise(() => {});
  const result = await awaitContext(never, 10);
  assert.deepEqual(result, { ok: false, reason: 'timeout' });
});

test('awaitContext reports a rejected SDK instead of rejecting', async () => {
  const result = await awaitContext(Promise.reject(new Error('nope')), 1000);
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'error');
  assert.equal(result.error.message, 'nope');
});

test('awaitContext lets a late handshake still resolve afterwards', async () => {
  // Giving up waiting must not consume the promise: the caller re-awaits it.
  let resolve;
  const slow = new Promise((r) => { resolve = r; });
  assert.equal((await awaitContext(slow, 10)).ok, false);
  resolve('late');
  assert.equal(await slow, 'late');
});

test('the timeout is long enough for a real handshake and short enough to see', () => {
  // The DA shell posts its ready message 750ms after the iframe load event.
  assert.ok(CONTEXT_TIMEOUT_MS > 750);
  assert.ok(CONTEXT_TIMEOUT_MS <= 10000);
  assert.match(CONTEXT_TIMEOUT_TEXT, /DA app context not received/);
});

// --- the shell's boot failure surface -------------------------------------
//
// Regression guard for the reproduced blank page: the DA shell iframed
// coworker-project.html while the local dev server was on an older commit, so
// three of coworker-project.js's imports 404'd, the module graph never
// evaluated, init() never ran, and <body> stayed empty with no message at all.
// The app cannot report that itself, so the shell has to.

test('the shell ships a boot message, so a dead module graph is never a blank page', () => {
  const body = HTML.match(/<body>([\s\S]*)<\/body>/);
  assert.ok(body, 'coworker-project.html has a <body>');
  assert.match(body[1], /class="cw-boot"/, '<body> ships the .cw-boot element');
  assert.match(body[1], /Loading Coworker Projects/);
});

test('the shell listens for load errors in the capture phase', () => {
  // Resource errors do not bubble, so a listener without `true` sees nothing.
  assert.match(HTML, /window\.addEventListener\('error',[\s\S]*?\}, true\);/);
  assert.match(HTML, /\.cw-boot/, 'the handler writes into the boot element');
});

test('the error listener is registered before the app module can fail', () => {
  const listener = HTML.indexOf("window.addEventListener('error'");
  const appModule = HTML.indexOf('<script src="/tools/coworker-project/coworker-project.js"');
  assert.ok(listener > -1, 'the shell registers an error listener');
  assert.ok(appModule > -1, 'the shell loads the app module');
  assert.ok(listener < appModule, 'a later listener would miss the module load error');
});
