/** The parts of a Ring push notification (PushNotificationDingV2) the event log uses. */
export interface DingLike {
  analytics?: { triggered_at?: number; sent_at?: number };
  data?: {
    device?: { e2ee_enabled?: boolean };
    event?: { ding?: { subtype?: string; detection_type?: string; created_at?: string } };
  };
}

/** A Ring timestamp in ms (Ring sends some in seconds, some in ms). */
function toMs(t: number | undefined): number | undefined {
  if (typeof t !== 'number' || !Number.isFinite(t) || t <= 0) {
    return undefined;
  }
  return t < 1e12 ? t * 1000 : t;
}

/**
 * How late an event reached the plugin: from when the camera triggered it to now. This delay
 * is what a HomeKit Secure Video recording misses at its start, so it is logged for every event.
 */
export function eventTiming(n: DingLike, now: number): { triggeredAgoMs?: number; sentAfterMs?: number } {
  const triggered = toMs(n.analytics?.triggered_at) ?? (n.data?.event?.ding?.created_at ? Date.parse(n.data.event.ding.created_at) : undefined);
  const sent = toMs(n.analytics?.sent_at);
  return {
    triggeredAgoMs: triggered !== undefined && Number.isFinite(triggered) ? now - triggered : undefined,
    sentAfterMs: triggered !== undefined && sent !== undefined ? sent - triggered : undefined,
  };
}

/** One log line for a Ring event: what it was and how late it arrived. */
export function describeEvent(kind: string, n: DingLike, now: number): string {
  const ding = n.data?.event?.ding;
  const detail = [ding?.subtype, ding?.detection_type].filter((x) => x && x !== kind).join(', ');
  const t = eventTiming(n, now);
  const timing =
    t.triggeredAgoMs === undefined
      ? ''
      : `, ${(t.triggeredAgoMs / 1000).toFixed(1)} s after the camera saw it` +
        (t.sentAfterMs === undefined ? '' : ` (Ring sent it after ${(t.sentAfterMs / 1000).toFixed(1)} s)`);
  return `${kind}${detail ? ` (${detail})` : ''}${timing}`;
}
