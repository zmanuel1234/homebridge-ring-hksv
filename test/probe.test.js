import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runProbe, pruneProbeFiles } from '../dist/probe.js';

function subject() {
  const subs = new Set();
  return {
    subscribe(fn) {
      subs.add(fn);
      return { unsubscribe: () => subs.delete(fn) };
    },
    next(v) {
      for (const fn of [...subs]) fn(v);
    },
    get count() {
      return subs.size;
    },
  };
}

function logger() {
  const lines = [];
  const add = (level) => (msg) => lines.push(`${level}: ${msg}`);
  return { lines, info: add('info'), warn: add('warn'), error: add('error'), debug: add('debug') };
}

const SPS = Buffer.from('674d401feca02802dd8088000003000800000300f078c18cb0', 'hex');
const STAP = Buffer.concat([Buffer.from([0x78, 0, SPS.length]), SPS, Buffer.from([0, 4, 0x68, 0xee, 0x3c, 0x80])]);

/** A fake camera whose live call sends 6 s of 10 fps video, a keyframe every 2 s, then ends. */
function fakeCamera(outputs) {
  const video = subject();
  const ended = subject();
  const session = {
    onVideoRtp: video,
    onCallEnded: ended,
    stopped: false,
    async startTranscoding(opts) {
      outputs.push(opts);
      const file = opts.output.at(-1);
      writeFileSync(file, Buffer.alloc(2048));
      setImmediate(() => {
        let seq = 0;
        for (let f = 0; f <= 60; f++) {
          const payloads = f % 20 === 0 ? [STAP, Buffer.from([0x65, 0x88])] : [Buffer.from([0x41, 0x9a])];
          for (const payload of payloads) {
            video.next({ header: { sequenceNumber: seq++, timestamp: f * 9000 }, payload });
          }
        }
        ended.next();
      });
    },
    requestKeyFrame() {},
    stop() {
      this.stopped = true;
      ended.next();
    },
  };
  return { camera: { name: 'Front Door', startLiveCall: async () => session }, session, video };
}

test('the probe measures the call, saves it and gives a verdict', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'ring-hksv-probe-'));
  try {
    const outputs = [];
    const { camera, video } = fakeCamera(outputs);
    const log = logger();
    const sum = await runProbe(camera, 30, dir, log);
    assert.equal(sum.keyframes, 4);
    assert.deepEqual(sum.keyframeGaps, [2, 2, 2]);
    assert.equal(sum.sps.width, 1280);
    // Video copied as it is; ffmpeg stops after the probe length.
    assert.deepEqual(outputs[0].video, ['-vcodec', 'copy']);
    assert.deepEqual(outputs[0].output.slice(0, 2), ['-t', 30]);
    const text = log.lines.join('\n');
    assert.match(text, /verdict: the video can likely be recorded as it is/);
    assert.match(text, /1280x720, Main profile, level 3\.1/);
    assert.match(text, /saved the call .*probe-\d{8}-\d{6}\.mp4 \(2 KB\)/);
    assert.equal(video.count, 0, 'unsubscribed after the probe');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('the probe reports a call that could not start', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'ring-hksv-probe-'));
  try {
    const log = logger();
    const camera = { name: 'Front Door', startLiveCall: async () => { throw new Error('Timeout waiting for camera connection'); } };
    assert.equal(await runProbe(camera, 10, dir, log), undefined);
    assert.match(log.lines.join('\n'), /error: Stream probe: the live call could not start: Timeout/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('only the newest probe files are kept', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ring-hksv-probe-'));
  try {
    for (const name of ['probe-20261112-100000.mp4', 'probe-20261112-110000.mp4', 'probe-20261112-120000.mp4', 'probe-20261112-130000.mp4', 'state.json']) {
      writeFileSync(join(dir, name), '');
    }
    pruneProbeFiles(dir);
    assert.deepEqual(readdirSync(dir).sort(), ['probe-20261112-110000.mp4', 'probe-20261112-120000.mp4', 'probe-20261112-130000.mp4', 'state.json']);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('shutting down stops the call at once', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'ring-hksv-probe-'));
  try {
    const ended = subject();
    let stopped = 0;
    const session = {
      onVideoRtp: subject(),
      onCallEnded: ended,
      async startTranscoding() {},
      requestKeyFrame() {},
      stop() {
        stopped++;
        ended.next();
      },
    };
    const ac = new AbortController();
    const log = logger();
    const done = runProbe({ name: 'Front Door', startLiveCall: async () => session }, 30, dir, log, ac.signal);
    await new Promise((r) => setImmediate(r));
    ac.abort();
    assert.equal(await done, undefined);
    assert.ok(stopped >= 1);
    assert.match(log.lines.join('\n'), /stopped \(Homebridge is shutting down\)/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
