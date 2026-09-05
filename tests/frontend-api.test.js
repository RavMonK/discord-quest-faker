'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

// Exercise the browser's actual API helper without introducing a DOM dependency.
const source = fs.readFileSync(path.join(__dirname, '../src/public/app.js'), 'utf8').split('let toastTimer')[0];
const response = (status, data) => ({ ok: status < 400, status, json: async () => data });

test('frontend API: shares session bootstrap and adds the token to commands', async () => {
  let sessions = 0;
  const calls = [];
  const context = vm.createContext({ fetch: async (url, options) => {
    if (url === '/api/session') { sessions++; return response(200, { token: 'session-one' }); }
    calls.push({ url, options });
    return response(200, { ok: true });
  } });
  vm.runInContext(source, context);
  await Promise.all([context.api('/api/state'), context.api('/api/start', { method: 'POST', body: '{"id":"1"}' })]);
  assert.equal(sessions, 1);
  assert.equal(calls[1].options.method, 'POST');
  assert.equal(calls[1].options.body, '{"id":"1"}');
  for (const call of calls) assert.equal(call.options.headers['X-DQF-Token'], 'session-one');
});

test('frontend API: recovers once after server restart, never retries a command error', async () => {
  let sessions = 0;
  let commands = 0;
  const context = vm.createContext({ fetch: async (url, options) => {
    if (url === '/api/session') return response(200, { token: 'session-' + ++sessions });
    commands++;
    if (commands === 1) return response(403, { code: 'invalid_token', reason: 'expired' });
    assert.equal(options.headers['X-DQF-Token'], 'session-2');
    return response(409, { reason: 'already running' });
  } });
  vm.runInContext(source, context);
  await assert.rejects(context.api('/api/start', { method: 'POST' }), /already running/);
  assert.equal(sessions, 2);
  assert.equal(commands, 2);
});
