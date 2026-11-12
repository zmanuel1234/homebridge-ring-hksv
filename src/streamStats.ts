import { HKSV_FRAGMENT_MS } from './settings.js';
import { NAL_IDR, NAL_SPS, nalsInRtpPayload, parseSps, type SpsInfo } from './h264.js';

/** The parts of an RTP packet the stats need. */
export interface VideoPacket {
  sequenceNumber: number;
  /** 90 kHz. */
  timestamp: number;
  payload: Buffer;
}

export interface StreamSummary {
  packets: number;
  lostPackets: number;
  frames: number;
  /** From the first frame to the last, by the stream's own clock (s). */
  seconds: number;
  fps: number;
  keyframes: number;
  /** Time between keyframes, by the stream's own clock (s). */
  keyframeGaps: number[];
  /** From the start of the call to the first video and the first keyframe (ms), by wall clock. */
  firstVideoMs?: number;
  firstKeyframeMs?: number;
  sps?: SpsInfo;
}

/** At most this many frames are counted (a minute at 60 fps, with room to spare). */
const MAX_FRAMES = 10_000;

/**
 * Collects what matters about a Ring video stream for HomeKit Secure Video.
 *
 * Frames are told apart by their RTP timestamp, taken relative to the first one (as a signed
 * 32-bit difference, so the timestamp wrapping around doesn't matter, and frames sent out of
 * order, such as B-frames, still count).
 */
export class StreamStats {
  private packets = 0;
  private lost = 0;
  private lastSeq?: number;
  private firstTs?: number;
  /** Each frame's time, in 90 kHz ticks since the first frame. */
  private readonly frameTicks = new Set<number>();
  private readonly keyTicks = new Set<number>();
  private firstVideoAt?: number;
  private firstKeyAt?: number;
  private sps?: SpsInfo;
  private spsError?: string;

  constructor(private readonly startedAt: number) {}

  push(p: VideoPacket, at: number): void {
    this.packets++;
    if (this.lastSeq !== undefined) {
      const step = (p.sequenceNumber - this.lastSeq) & 0xffff;
      if (step > 1 && step < 0x8000) {
        this.lost += step - 1;
      }
    }
    this.lastSeq = p.sequenceNumber;
    if (this.firstTs === undefined) {
      this.firstTs = p.timestamp;
      this.firstVideoAt = at;
    }
    const rel = (p.timestamp - this.firstTs) | 0;
    if (this.frameTicks.size < MAX_FRAMES) {
      this.frameTicks.add(rel);
    }
    for (const n of nalsInRtpPayload(p.payload)) {
      if (n.type === NAL_SPS && n.nal && !this.sps) {
        try {
          this.sps = parseSps(n.nal);
        } catch (e) {
          this.spsError = (e as Error).message;
        }
      }
      if (n.type === NAL_IDR) {
        this.keyTicks.add(rel);
        this.firstKeyAt ??= at;
      }
    }
  }

  get spsProblem(): string | undefined {
    return this.sps ? undefined : this.spsError;
  }

  summary(): StreamSummary {
    const frames = [...this.frameTicks];
    const seconds = frames.length ? (Math.max(...frames) - Math.min(...frames)) / 90_000 : 0;
    const keys = [...this.keyTicks].sort((a, b) => a - b);
    const gaps: number[] = [];
    for (let i = 1; i < keys.length; i++) {
      gaps.push((keys[i] - keys[i - 1]) / 90_000);
    }
    return {
      packets: this.packets,
      lostPackets: this.lost,
      frames: frames.length,
      seconds,
      fps: seconds > 0 ? (frames.length - 1) / seconds : 0,
      keyframes: keys.length,
      keyframeGaps: gaps,
      firstVideoMs: this.firstVideoAt === undefined ? undefined : this.firstVideoAt - this.startedAt,
      firstKeyframeMs: this.firstKeyAt === undefined ? undefined : this.firstKeyAt - this.startedAt,
      sps: this.sps,
    };
  }
}

export type Verdict = 'copy' | 'reencode' | 'unknown';

/**
 * Whether HomeKit Secure Video could take the camera's own video as it is: every fragment must
 * start with a keyframe and be at most HKSV_FRAGMENT_MS long, so keyframes must come at least
 * that often. The first gap (after the keyframe that starts the stream) counts too.
 */
export function verdict(s: StreamSummary): { verdict: Verdict; reason: string } {
  const limit = HKSV_FRAGMENT_MS / 1000;
  if (s.keyframes < 2) {
    return {
      verdict: s.frames > 0 && s.seconds > limit ? 'reencode' : 'unknown',
      reason: s.frames > 0 && s.seconds > limit
        ? `only ${s.keyframes} keyframe in ${s.seconds.toFixed(1)} s of video`
        : 'not enough video to judge',
    };
  }
  const max = Math.max(...s.keyframeGaps);
  if (max <= limit + 0.05) {
    return { verdict: 'copy', reason: `keyframes at most ${max.toFixed(2)} s apart (HomeKit needs ${limit} s or less)` };
  }
  return { verdict: 'reencode', reason: `keyframes up to ${max.toFixed(2)} s apart (HomeKit needs ${limit} s or less)` };
}

/** The probe's result, as log lines. */
export function describe(s: StreamSummary): string[] {
  const gaps = s.keyframeGaps;
  const lines = [
    `video: ${s.sps ? `${s.sps.width}x${s.sps.height}` : 'size unknown'}, ${s.fps.toFixed(1)} fps, ${s.frames} frames in ${s.seconds.toFixed(1)} s`,
    `keyframes: ${s.keyframes}` +
      (gaps.length
        ? `, gaps ${Math.min(...gaps).toFixed(2)}-${Math.max(...gaps).toFixed(2)} s (average ${(gaps.reduce((a, b) => a + b, 0) / gaps.length).toFixed(2)} s)`
        : ''),
    ...(gaps.length ? [`keyframe gaps (s): ${gaps.slice(0, 20).map((g) => g.toFixed(2)).join(', ')}${gaps.length > 20 ? ', ...' : ''}`] : []),
    `start: first video ${s.firstVideoMs === undefined ? '-' : `${(s.firstVideoMs / 1000).toFixed(1)} s`}, ` +
      `first keyframe ${s.firstKeyframeMs === undefined ? '-' : `${(s.firstKeyframeMs / 1000).toFixed(1)} s`} after the live call was requested`,
    `network: ${s.packets} RTP packets, ${s.lostPackets} lost`,
  ];
  return lines;
}
