import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, statSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PluginState } from '../dist/state.js';

function dir() {
  const d = mkdtempSync(join(tmpdir(), 'ring-hksv-test-'));
  return { root: d, dir: join(d, 'ring-hksv') };
}

test('system id is made once and kept', () => {
  const { root, dir: d } = dir();
  try {
    const id = new PluginState(d).systemId;
    assert.match(id, /^homebridge-ring-hksv-[0-9a-f-]{36}$/);
    assert.equal(new PluginState(d).systemId, id);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('the saved token is used until config.json gets a new one', () => {
  const { root, dir: d } = dir();
  try {
    const s = new PluginState(d);
    assert.deepEqual(s.tokenFor('first'), { token: 'first', fromConfig: true });
    s.saveToken('rotated-1');
    assert.deepEqual(new PluginState(d).tokenFor('first'), { token: 'rotated-1', fromConfig: false });
    // A new token pasted into the settings takes over.
    const s2 = new PluginState(d);
    assert.deepEqual(s2.tokenFor('second'), { token: 'second', fromConfig: true });
    assert.deepEqual(new PluginState(d).tokenFor('second'), { token: 'second', fromConfig: true });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('the file is private and does not hold the config token', () => {
  const { root, dir: d } = dir();
  try {
    const s = new PluginState(d);
    s.tokenFor('config-token-value');
    s.saveToken('rotated');
    const file = join(d, 'state.json');
    assert.equal(statSync(file).mode & 0o777, 0o600);
    const text = readFileSync(file, 'utf8');
    assert.ok(!text.includes('config-token-value'));
    assert.ok(text.includes('rotated'));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('an unreadable state file starts afresh', () => {
  const { root, dir: d } = dir();
  try {
    mkdirSync(d, { recursive: true });
    writeFileSync(join(d, 'state.json'), '{not json');
    assert.deepEqual(new PluginState(d).tokenFor('t'), { token: 't', fromConfig: true });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
