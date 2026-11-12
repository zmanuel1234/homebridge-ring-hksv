import { mkdirSync, readdirSync, statSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import type { Logging } from 'homebridge';
import { PROBE_NO_VIDEO_MS } from './settings.js';
import { describe, StreamStats, verdict, type StreamSummary, type VideoPacket } from './streamStats.js';
import { describeSps } from './h264.js';

/** What the probe uses of ring-client-api's StreamingSession. */
export interface ProbeSession {
  onVideoRtp: { subscribe(fn: (p: { header: { sequenceNumber: number; timestamp: number }; payload: Buffer }) => void): { unsubscribe(): void } };
  onCallEnded: { subscribe(fn: () => void): { unsubscribe(): void } };
  startTranscoding(options: { output: (string | number)[]; video?: (string | number)[] | false; audio?: (string | number)[] }): Promise<void>;
  requestKeyFrame(): void;
  stop(): void;
}

export interface ProbeCamera {
  name: string;
  startLiveCall(): Promise<ProbeSession>;
}

/** Probe files kept in the plugin's folder (the newest ones). */
const KEEP_FILES = 3;

function stamp(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

/** Removes all but the newest probe files. */
export function pruneProbeFiles(dir: string, keep = KEEP_FILES): void {
  let files: string[];
  try {
    files = readdirSync(dir).filter((f) => /^probe-\d{8}-\d{6}\.mp4$/.test(f)).sort();
  } catch {
    return;
  }
  for (const f of files.slice(0, Math.max(0, files.length - keep))) {
    try {
      unlinkSync(join(dir, f));
    } catch {
      // Gone already.
    }
  }
}

/**
 * The stream probe: one live call of `seconds` from the camera, as HomeKit Secure Video would
 * get it, to see whether its video can be recorded as it is ("copy") or must be re-encoded.
 *
 * It measures the video as it arrives (picture size, frame rate, how often keyframes come, how
 * long the start takes) and saves the call, video copied without re-encoding, as an MP4 in the
 * plugin's folder for a closer look. A live call is the same as opening Live View in the Ring
 * app: it uses the doorbell's battery like one, and shows in the Ring app's history.
 */
export async function runProbe(
  camera: ProbeCamera,
  seconds: number,
  dir: string,
  log: Logging,
  /** Homebridge is stopping: end the call (and its ffmpeg) at once. */
  signal?: AbortSignal,
): Promise<StreamSummary | undefined> {
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const file = join(dir, `probe-${stamp(new Date())}.mp4`);
  log.info(`Stream probe: starting a ${seconds} s live call from ${camera.name} (like opening Live View in the Ring app)`);
  const startedAt = Date.now();
  const stats = new StreamStats(startedAt);
  let session: ProbeSession;
  try {
    session = await camera.startLiveCall();
  } catch (e) {
    log.error(`Stream probe: the live call could not start: ${(e as Error).message}`);
    return undefined;
  }
  if (signal?.aborted) {
    session.stop();
    return undefined;
  }
  const onAbort = () => session.stop();
  signal?.addEventListener('abort', onAbort);
  const subs: { unsubscribe(): void }[] = [];
  const ended = new Promise<void>((resolve) => {
    subs.push(session.onCallEnded.subscribe(() => resolve()));
  });
  let sawVideo = false;
  subs.push(
    session.onVideoRtp.subscribe((rtp) => {
      sawVideo = true;
      const p: VideoPacket = { sequenceNumber: rtp.header.sequenceNumber, timestamp: rtp.header.timestamp, payload: rtp.payload };
      stats.push(p, Date.now());
    }),
  );
  const timers: NodeJS.Timeout[] = [];
  timers.push(
    setTimeout(() => {
      if (!sawVideo) {
        log.warn(`Stream probe: no video ${PROBE_NO_VIDEO_MS / 1000} s after the call started; stopping`);
        session.stop();
      }
    }, PROBE_NO_VIDEO_MS),
    // ffmpeg stops after `seconds` (and ends the call); this is in case it doesn't.
    setTimeout(() => session.stop(), (seconds + 15) * 1000),
  );
  try {
    // Video as it comes (copy), sound to AAC: the file shows what the camera sends.
    await session.startTranscoding({
      video: ['-vcodec', 'copy'],
      audio: ['-acodec', 'aac'],
      output: ['-t', seconds, '-movflags', '+faststart', '-y', file],
    });
  } catch (e) {
    log.warn(`Stream probe: ffmpeg could not start (${(e as Error).message}); measuring the video without saving it`);
    timers.push(setTimeout(() => session.stop(), seconds * 1000));
  }
  await ended;
  for (const t of timers) {
    clearTimeout(t);
  }
  for (const s of subs) {
    s.unsubscribe();
  }
  signal?.removeEventListener('abort', onAbort);
  if (signal?.aborted) {
    log.info('Stream probe: stopped (Homebridge is shutting down)');
    return undefined;
  }
  const summary = stats.summary();
  const v = verdict(summary);
  log.info('Stream probe: result');
  for (const line of describe(summary)) {
    log.info(`  ${line}`);
  }
  if (summary.sps) {
    log.info(`  H.264: ${describeSps(summary.sps)}`);
  } else if (stats.spsProblem) {
    log.info(`  H.264: picture settings unreadable (${stats.spsProblem})`);
  }
  const what = {
    copy: 'the video can likely be recorded as it is (no re-encoding, little CPU)',
    reencode: "the video must be re-encoded for HomeKit Secure Video (more CPU; the Pi 4's hardware encoder can help)",
    unknown: 'no conclusion',
  }[v.verdict];
  log.info(`  verdict: ${what}: ${v.reason}`);
  try {
    const size = statSync(file).size;
    log.info(`  saved the call (video as the camera sent it) to ${file} (${(size / 1024).toFixed(0)} KB)`);
  } catch {
    log.info('  no file saved (ffmpeg wrote nothing)');
  }
  pruneProbeFiles(dir);
  log.info('Stream probe: done. Turn "Stream probe" off in the settings so it does not run at every restart.');
  return summary;
}
