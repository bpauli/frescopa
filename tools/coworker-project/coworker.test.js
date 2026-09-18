/* eslint-disable no-underscore-dangle, max-classes-per-file */
import test from 'node:test';
import assert from 'node:assert/strict';

import { Coworker, sessionUrl, isStaleSessionError } from './coworker.js';

// A fake AO socket: it records the URL it was opened with, then answers a
// USER_INPUT the way the backend does - SESSION_READY carrying the episode id,
// the reply text, turn_completed - so the client's session threading is
// exercised end to end without a network.
class FakeWs {
  constructor(url) {
    this.url = url;
    this._listeners = {};
    FakeWs.opened.push(url);
    setTimeout(() => this._emit('open', {}), 0);
  }

  addEventListener(type, fn) {
    (this._listeners[type] ||= []).push(fn);
  }

  _emit(type, event) {
    (this._listeners[type] || []).forEach((fn) => fn(event));
  }

  frame(obj) {
    this._emit('message', { data: JSON.stringify(obj) });
  }

  close() {
    this.closed = true;
  }

  send(raw) {
    const msg = JSON.parse(raw);
    if (msg.type !== 'USER_INPUT') return;
    setTimeout(() => FakeWs.respond(this, msg), 0);
  }
}

// The episode id a `new` socket mints, and the id every other socket must name.
const EPISODE = '7300000000000000001';

// Default backend: `new` mints EPISODE, any other path joins that episode.
function aoDefault(ws, msg) {
  const id = ws.url.endsWith('/new') ? EPISODE : ws.url.split('/').pop();
  ws.frame({ type: 'SESSION_READY', context_id: id, episode_id: id });
  ws.frame({ type: 'text_done', data: { content: `reply:${msg.text}` } });
  ws.frame({ type: 'turn_completed' });
}

function withFakeSockets(respond = aoDefault) {
  FakeWs.opened = [];
  FakeWs.respond = respond;
  globalThis.WebSocket = FakeWs;
  return FakeWs.opened;
}

// A client whose connection info is local: no IMS, no da.live import.
class TestCoworker extends Coworker {
  // eslint-disable-next-line class-methods-use-this
  async _connectionInfo() {
    return { wsBase: 'wss://ao.test', authFrame: { type: 'AUTH' } };
  }
}

test('sessionUrl names the bound episode, else the `new` sentinel', () => {
  assert.equal(sessionUrl('wss://ao.test', null), 'wss://ao.test/ws/sessions/new');
  assert.equal(sessionUrl('wss://ao.test', ''), 'wss://ao.test/ws/sessions/new');
  assert.equal(sessionUrl('wss://ao.test', '42'), 'wss://ao.test/ws/sessions/42');
});

test('isStaleSessionError only matches AO\'s episode-shaped rejections', () => {
  assert.equal(isStaleSessionError('Episode not found'), true);
  assert.equal(isStaleSessionError("Invalid episode_id: 'x'. Use 'new' for new conversations"), true);
  assert.equal(isStaleSessionError('coworker timeout'), false);
  assert.equal(isStaleSessionError(''), false);
  assert.equal(isStaleSessionError(undefined), false);
});

test('a wizard pass lands in ONE chat: the first turn opens `new`, later turns join it', async () => {
  const opened = withFakeSockets();
  const persisted = [];
  const cw = new TestCoworker({ org: 'o', repo: 's' });
  cw.setSessionId(null, (id) => persisted.push(id));

  assert.equal(await cw.ask('one'), 'reply:one');
  assert.equal(await cw.ask('two'), 'reply:two');
  assert.equal(await cw.ask('three'), 'reply:three');

  assert.deepEqual(opened, [
    'wss://ao.test/ws/sessions/new',
    `wss://ao.test/ws/sessions/${EPISODE}`,
    `wss://ao.test/ws/sessions/${EPISODE}`,
  ]);
  // One socket per turn (AO's own design), but only one episode = one chat.
  assert.deepEqual([...new Set(opened.map((u) => u.split('/').pop()))].filter((i) => i !== 'new'), [EPISODE]);
  // The persister is called once, with the adopted id.
  assert.deepEqual(persisted, [EPISODE]);
});

test('a persisted session id is joined without re-persisting it', async () => {
  const opened = withFakeSockets();
  const persisted = [];
  const cw = new TestCoworker({ org: 'o', repo: 's' });
  cw.setSessionId(EPISODE, (id) => persisted.push(id));

  assert.equal(await cw.ask('hi'), 'reply:hi');
  assert.deepEqual(opened, [`wss://ao.test/ws/sessions/${EPISODE}`]);
  assert.deepEqual(persisted, []);
  assert.equal(cw.getSessionId(), EPISODE);
});

test('resetSession / setSessionId(null) rebinds on project switch', async () => {
  const opened = withFakeSockets();
  const cw = new TestCoworker({ org: 'o', repo: 's' });
  cw.setSessionId('other-project-episode', () => {});
  cw.resetSession();
  await cw.ask('hi');
  assert.deepEqual(opened, ['wss://ao.test/ws/sessions/new']);
});

test('an episode AO refuses is dropped and the turn is retried once on `new`', async () => {
  // AO rejects the stale episode with an ERROR frame, then closes (1008).
  const opened = withFakeSockets((ws, msg) => {
    if (ws.url.endsWith('/STALE')) {
      ws.frame({ type: 'ERROR', message: 'Episode not found' });
      ws._emit('close', {});
      return;
    }
    aoDefault(ws, msg);
  });
  const persisted = [];
  const cw = new TestCoworker({ org: 'o', repo: 's' });
  cw.setSessionId('STALE', (id) => persisted.push(id));

  // The turn is not lost.
  assert.equal(await cw.ask('one'), 'reply:one');
  assert.deepEqual(opened, [
    'wss://ao.test/ws/sessions/STALE',
    'wss://ao.test/ws/sessions/new',
  ]);
  // The stale id is forgotten, then the fresh one is adopted and persisted.
  assert.deepEqual(persisted, [null, EPISODE]);
  assert.equal(cw.getSessionId(), EPISODE);
});

test('a non-session error is not retried and keeps the bound episode', async () => {
  const opened = withFakeSockets((ws) => {
    ws.frame({ type: 'ERROR', message: 'model overloaded' });
  });
  const cw = new TestCoworker({ org: 'o', repo: 's' });
  cw.setSessionId(EPISODE, () => {});

  await assert.rejects(cw.ask('one'), /model overloaded/);
  assert.equal(opened.length, 1);
  assert.equal(cw.getSessionId(), EPISODE);
});
