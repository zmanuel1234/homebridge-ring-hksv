import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import plugin from '../dist/index.js';

function fakeApi(storage) {
  const api = new EventEmitter();
  api.user = { storagePath: () => storage };
  api.registered = [];
  api.registerPlatform = (pluginName, platformName, ctor) => api.registered.push({ pluginName, platformName, ctor });
  api.unregistered = [];
  api.unregisterPlatformAccessories = (p, n, list) => api.unregistered.push(...list);
  return api;
}

function logger() {
  const lines = [];
  const add = (level) => (msg) => lines.push(`${level}: ${msg}`);
  return { lines, info: add('info'), warn: add('warn'), error: add('error'), debug: add('debug') };
}

test('registers the RingHksv platform', () => {
  const api = fakeApi('/nonexistent');
  plugin(api);
  assert.equal(api.registered.length, 1);
  assert.equal(api.registered[0].pluginName, 'homebridge-ring-hksv');
  assert.equal(api.registered[0].platformName, 'RingHksv');
});

test('without a token it logs why and does nothing', () => {
  const storage = mkdtempSync(join(tmpdir(), 'ring-hksv-platform-'));
  try {
    const api = fakeApi(storage);
    plugin(api);
    const log = logger();
    new api.registered[0].ctor(log, { platform: 'RingHksv' }, api);
    assert.match(log.lines.join('\n'), /error: Not starting: refreshToken is missing/);
    assert.equal(api.listenerCount('didFinishLaunching'), 0);
  } finally {
    rmSync(storage, { recursive: true, force: true });
  }
});

test('accessories cached from another version are removed', () => {
  const api = fakeApi('/nonexistent');
  plugin(api);
  const p = new api.registered[0].ctor(logger(), { platform: 'RingHksv', refreshToken: 't' }, api);
  const acc = { displayName: 'old' };
  p.configureAccessory(acc);
  assert.deepEqual(api.unregistered, [acc]);
  api.emit('shutdown');
});
