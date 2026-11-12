import { test } from 'node:test';
import assert from 'node:assert/strict';
import { eventTiming, describeEvent } from '../dist/events.js';

test('timing from analytics in ms or seconds', () => {
  const now = 1_800_000_010_000;
  assert.deepEqual(eventTiming({ analytics: { triggered_at: now - 2500, sent_at: now - 1000 } }, now), {
    triggeredAgoMs: 2500,
    sentAfterMs: 1500,
  });
  assert.deepEqual(eventTiming({ analytics: { triggered_at: (now - 3000) / 1000 } }, now), {
    triggeredAgoMs: 3000,
    sentAfterMs: undefined,
  });
});

test('timing falls back to the ding time, or is unknown', () => {
  const now = Date.parse('2026-11-12T19:00:05Z');
  assert.equal(eventTiming({ data: { event: { ding: { created_at: '2026-11-12T19:00:00Z' } } } }, now).triggeredAgoMs, 5000);
  assert.deepEqual(eventTiming({}, now), { triggeredAgoMs: undefined, sentAfterMs: undefined });
});

test('event lines', () => {
  const now = 1_800_000_010_000;
  const n = {
    analytics: { triggered_at: now - 3200, sent_at: now - 1100 },
    data: { event: { ding: { subtype: 'human', detection_type: 'human' } } },
  };
  assert.equal(describeEvent('motion', n, now), 'motion (human, human), 3.2 s after the camera saw it (Ring sent it after 2.1 s)');
  assert.equal(describeEvent('doorbell pressed', {}, now), 'doorbell pressed');
  assert.equal(describeEvent('motion', { data: { event: { ding: { subtype: 'motion' } } } }, now), 'motion');
});
