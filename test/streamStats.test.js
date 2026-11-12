import { test } from 'node:test';
import assert from 'node:assert/strict';
import { StreamStats, verdict, describe } from '../dist/streamStats.js';

const SPS = Buffer.from('674d401feca02802dd8088000003000800000300f078c18cb0', 'hex');
const len = (b) => Buffer.from([b.length >> 8, b.length & 0xff]);
const PPS = Buffer.from([0x68, 0xee, 0x3c, 0x80]);
const STAP = Buffer.concat([Buffer.from([0x78]), len(SPS), SPS, len(PPS), PPS]);
const IDR_START = Buffer.from([0x7c, 0x85, 0]);
const IDR_MID = Buffer.from([0x7c, 0x05, 0]);
const P_FRAME = Buffer.from([0x41, 0x9a, 0]);

/**
 * A fake Ring stream: `seconds` at `fps`, a keyframe (SPS/PPS + IDR in two FU-A packets) every
 * `keyEvery` frames, starting at RTP timestamp `ts0`.
 */
function feed(stats, { seconds, fps, keyEvery, ts0 = 1000, startMs = 0, drop = [], seq0 = 65000 }) {
  let seq = seq0;
  const frames = Math.round(seconds * fps) + 1;
  for (let f = 0; f < frames; f++) {
    const ts = (ts0 + Math.round((f * 90_000) / fps)) >>> 0;
    const at = startMs + (f * 1000) / fps;
    const packets = f % keyEvery === 0 ? [STAP, IDR_START, IDR_MID] : [P_FRAME];
    for (const payload of packets) {
      seq = (seq + 1) & 0xffff;
      if (!drop.includes(seq)) {
        stats.push({ sequenceNumber: seq, timestamp: ts, payload }, at);
      }
    }
  }
}

test('a stream with keyframes every 2 s can be copied', () => {
  const s = new StreamStats(0);
  feed(s, { seconds: 30, fps: 15, keyEvery: 30, startMs: 1500 });
  const sum = s.summary();
  assert.equal(sum.frames, 451);
  assert.ok(Math.abs(sum.seconds - 30) < 0.01);
  assert.ok(Math.abs(sum.fps - 15) < 0.01);
  assert.equal(sum.keyframes, 16);
  assert.ok(sum.keyframeGaps.every((g) => Math.abs(g - 2) < 0.01));
  assert.equal(sum.firstVideoMs, 1500);
  assert.equal(sum.firstKeyframeMs, 1500);
  assert.deepEqual(sum.sps, { profileIdc: 77, levelIdc: 31, width: 1280, height: 720 });
  assert.equal(sum.lostPackets, 0);
  assert.equal(verdict(sum).verdict, 'copy');
});

test('keyframes every 8 s need re-encoding', () => {
  const s = new StreamStats(0);
  feed(s, { seconds: 30, fps: 15, keyEvery: 120 });
  const v = verdict(s.summary());
  assert.equal(v.verdict, 'reencode');
  assert.match(v.reason, /8\.00 s apart/);
});

test('exactly 4 s apart is still fine', () => {
  const s = new StreamStats(0);
  feed(s, { seconds: 20, fps: 20, keyEvery: 80 });
  assert.equal(verdict(s.summary()).verdict, 'copy');
});

test('one keyframe in a long stream: re-encode; too short: no conclusion', () => {
  const long = new StreamStats(0);
  feed(long, { seconds: 20, fps: 15, keyEvery: 10_000 });
  assert.equal(verdict(long.summary()).verdict, 'reencode');
  const short = new StreamStats(0);
  feed(short, { seconds: 2, fps: 15, keyEvery: 10_000 });
  assert.equal(verdict(short.summary()).verdict, 'unknown');
  assert.equal(verdict(new StreamStats(0).summary()).verdict, 'unknown');
});

test('the RTP timestamp wrapping around does not break the timing', () => {
  const s = new StreamStats(0);
  feed(s, { seconds: 10, fps: 10, keyEvery: 20, ts0: 0xffffffff - 90_000 * 3 });
  const sum = s.summary();
  assert.ok(Math.abs(sum.seconds - 10) < 0.01);
  assert.ok(sum.keyframeGaps.every((g) => Math.abs(g - 2) < 0.01));
});

test('lost packets are counted, including across the sequence wrap', () => {
  const s = new StreamStats(0);
  feed(s, { seconds: 2, fps: 10, keyEvery: 10, seq0: 65530, drop: [65532, 0, 1] });
  assert.equal(s.summary().lostPackets, 3);
});

test('a late packet of an older frame is not a new frame', () => {
  const s = new StreamStats(0);
  s.push({ sequenceNumber: 1, timestamp: 9000, payload: P_FRAME }, 0);
  s.push({ sequenceNumber: 2, timestamp: 18000, payload: P_FRAME }, 100);
  s.push({ sequenceNumber: 3, timestamp: 9000, payload: P_FRAME }, 110);
  assert.equal(s.summary().frames, 2);
});

test('the description has the numbers the log needs', () => {
  const s = new StreamStats(0);
  feed(s, { seconds: 10, fps: 15, keyEvery: 30, startMs: 2000 });
  const text = describe(s.summary()).join('\n');
  assert.match(text, /1280x720, 15\.0 fps/);
  assert.match(text, /keyframes: 6, gaps 2\.00-2\.00 s/);
  assert.match(text, /first video 2\.0 s, first keyframe 2\.0 s/);
});
