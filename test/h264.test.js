import { test } from 'node:test';
import assert from 'node:assert/strict';
import { nalsInRtpPayload, parseSps, describeSps } from '../dist/h264.js';

// SPS from libx264 (ffmpeg 6.1), with emulation prevention bytes.
const SPS_1080P_HIGH = Buffer.from('67640028acd940780227e5c044000003000400000300783c60c658', 'hex');
const SPS_720P_MAIN = Buffer.from('674d401feca02802dd8088000003000800000300f078c18cb0', 'hex');
const SPS_360P_BASELINE = Buffer.from('6742c016da0280bfe5c044000003000400000300783c58ba80', 'hex');

test('SPS: size, profile and level', () => {
  assert.deepEqual(parseSps(SPS_1080P_HIGH), { profileIdc: 100, levelIdc: 40, width: 1920, height: 1080 });
  assert.deepEqual(parseSps(SPS_720P_MAIN), { profileIdc: 77, levelIdc: 31, width: 1280, height: 720 });
  assert.deepEqual(parseSps(SPS_360P_BASELINE), { profileIdc: 66, levelIdc: 22, width: 640, height: 360 });
  assert.equal(describeSps(parseSps(SPS_1080P_HIGH)), '1920x1080, High profile, level 4.0');
});

test('SPS: not an SPS, or cut short', () => {
  assert.throws(() => parseSps(Buffer.from([0x68, 1, 2, 3])), /not an SPS/);
  assert.throws(() => parseSps(SPS_1080P_HIGH.subarray(0, 6)), /SPS ends early/);
});

test('RTP payloads: single NAL unit', () => {
  const n = nalsInRtpPayload(Buffer.from([0x65, 0x88, 0x84]));
  assert.equal(n.length, 1);
  assert.equal(n[0].type, 5);
  assert.ok(n[0].nal);
});

test('RTP payloads: STAP-A with SPS and PPS', () => {
  const pps = Buffer.from([0x68, 0xee, 0x3c, 0x80]);
  const len = (b) => Buffer.from([b.length >> 8, b.length & 0xff]);
  const stap = Buffer.concat([Buffer.from([0x78]), len(SPS_720P_MAIN), SPS_720P_MAIN, len(pps), pps]);
  const n = nalsInRtpPayload(stap);
  assert.deepEqual(n.map((x) => x.type), [7, 8]);
  assert.deepEqual(parseSps(n[0].nal), { profileIdc: 77, levelIdc: 31, width: 1280, height: 720 });
});

test('RTP payloads: a broken STAP-A stops at the bad size', () => {
  const n = nalsInRtpPayload(Buffer.from([0x78, 0x00, 0x02, 0x67, 0x64, 0x00, 0x09, 0x68]));
  assert.deepEqual(n.map((x) => x.type), [7]);
});

test('RTP payloads: FU-A counts only at its start', () => {
  assert.deepEqual(nalsInRtpPayload(Buffer.from([0x7c, 0x85, 1])).map((x) => x.type), [5]); // start of IDR
  assert.deepEqual(nalsInRtpPayload(Buffer.from([0x7c, 0x05, 1])), []); // middle
  assert.deepEqual(nalsInRtpPayload(Buffer.from([0x7c, 0x45, 1])), []); // end
  assert.equal(nalsInRtpPayload(Buffer.from([0x7c, 0x85]))[0].nal, undefined);
});

test('RTP payloads: empty or unknown', () => {
  assert.deepEqual(nalsInRtpPayload(Buffer.alloc(0)), []);
  assert.deepEqual(nalsInRtpPayload(Buffer.from([0x1e, 1])), []);
});
