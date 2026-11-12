import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readConfig, chooseCamera, ConfigError } from '../dist/config.js';

test('a token is required', () => {
  assert.throws(() => readConfig({}), ConfigError);
  assert.throws(() => readConfig({ refreshToken: '  ' }), /ring-auth-cli/);
});

test('defaults', () => {
  assert.deepEqual(readConfig({ refreshToken: 'abc' }), {
    name: 'Ring HKSV',
    refreshToken: 'abc',
    camera: '',
    probeSeconds: 0,
    ffmpegPath: undefined,
    debug: false,
  });
});

test('probe length: default, limits, nonsense', () => {
  assert.equal(readConfig({ refreshToken: 'a', probe: true }).probeSeconds, 30);
  assert.equal(readConfig({ refreshToken: 'a', probe: true, probeSeconds: 5 }).probeSeconds, 10);
  assert.equal(readConfig({ refreshToken: 'a', probe: true, probeSeconds: 500 }).probeSeconds, 60);
  assert.equal(readConfig({ refreshToken: 'a', probe: true, probeSeconds: 'x' }).probeSeconds, 30);
  assert.equal(readConfig({ refreshToken: 'a', probe: false, probeSeconds: 20 }).probeSeconds, 0);
});

test('camera id may be a number; ffmpeg path trimmed', () => {
  const c = readConfig({ refreshToken: 'a', camera: 129821015, ffmpegPath: ' /usr/bin/ffmpeg ' });
  assert.equal(c.camera, '129821015');
  assert.equal(c.ffmpegPath, '/usr/bin/ffmpeg');
});

const cams = [
  { id: 1, name: 'Front Door', isDoorbot: true },
  { id: 2, name: 'Garage', isDoorbot: false },
];

test('camera: the only doorbell, by name, by id', () => {
  assert.equal(chooseCamera(cams, ''), cams[0]);
  assert.equal(chooseCamera(cams, 'garage'), cams[1]);
  assert.equal(chooseCamera(cams, '2'), cams[1]);
});

test('camera: none or several', () => {
  assert.match(chooseCamera(cams, 'Back'), /no camera called "Back"/);
  assert.match(chooseCamera([cams[1]], ''), /no doorbell/);
  assert.match(chooseCamera([cams[0], { id: 3, name: 'Side', isDoorbot: true }], ''), /2 doorbells/);
});
