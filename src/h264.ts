/**
 * Just enough H.264 to judge a Ring stream for HomeKit Secure Video: which NAL units each RTP
 * packet carries (RFC 6184: single NAL unit, STAP-A, FU-A), and the picture size, profile and
 * level from the SPS.
 */

export const NAL_IDR = 5;
export const NAL_SPS = 7;
export const NAL_PPS = 8;
const STAP_A = 24;
const FU_A = 28;

/** A NAL unit, or the start of one (FU-A), found in an RTP payload. */
export interface NalInfo {
  type: number;
  /** The whole NAL unit, when the packet holds all of it (not FU-A). */
  nal?: Buffer;
}

/** The NAL units an RTP payload carries. A FU-A packet counts only when it starts its unit. */
export function nalsInRtpPayload(payload: Buffer): NalInfo[] {
  if (payload.length < 1) {
    return [];
  }
  const type = payload[0] & 0x1f;
  if (type >= 1 && type <= 23) {
    return [{ type, nal: payload }];
  }
  if (type === STAP_A) {
    const out: NalInfo[] = [];
    let at = 1;
    while (at + 2 <= payload.length) {
      const size = payload.readUInt16BE(at);
      at += 2;
      if (size === 0 || at + size > payload.length) {
        break;
      }
      const nal = payload.subarray(at, at + size);
      out.push({ type: nal[0] & 0x1f, nal });
      at += size;
    }
    return out;
  }
  if (type === FU_A && payload.length >= 2 && (payload[1] & 0x80) !== 0) {
    return [{ type: payload[1] & 0x1f }];
  }
  return [];
}

/** Reads Exp-Golomb coded bits (H.264 7.2), after removing emulation prevention bytes. */
class BitReader {
  private readonly bytes: Buffer;
  private pos = 0;

  constructor(rbsp: Buffer) {
    // Remove 0x03 in 00 00 03 sequences.
    const out: number[] = [];
    let zeros = 0;
    for (const b of rbsp) {
      if (zeros >= 2 && b === 3) {
        zeros = 0;
        continue;
      }
      zeros = b === 0 ? zeros + 1 : 0;
      out.push(b);
    }
    this.bytes = Buffer.from(out);
  }

  bit(): number {
    const byte = this.bytes[this.pos >> 3];
    if (byte === undefined) {
      throw new Error('SPS ends early');
    }
    const v = (byte >> (7 - (this.pos & 7))) & 1;
    this.pos++;
    return v;
  }

  bits(n: number): number {
    let v = 0;
    for (let i = 0; i < n; i++) {
      v = v * 2 + this.bit();
    }
    return v;
  }

  ue(): number {
    let zeros = 0;
    while (this.bit() === 0) {
      zeros++;
      if (zeros > 31) {
        throw new Error('bad Exp-Golomb code');
      }
    }
    return 2 ** zeros - 1 + this.bits(zeros);
  }

  se(): number {
    const k = this.ue();
    return k % 2 === 1 ? (k + 1) / 2 : -(k / 2);
  }
}

export interface SpsInfo {
  profileIdc: number;
  levelIdc: number;
  width: number;
  height: number;
}

const PROFILE_NAMES: Record<number, string> = { 66: 'Baseline', 77: 'Main', 88: 'Extended', 100: 'High' };

export function describeSps(s: SpsInfo): string {
  return `${s.width}x${s.height}, ${PROFILE_NAMES[s.profileIdc] ?? `profile ${s.profileIdc}`} profile, level ${(s.levelIdc / 10).toFixed(1)}`;
}

function skipScalingList(r: BitReader, size: number): void {
  let last = 8;
  let next = 8;
  for (let i = 0; i < size; i++) {
    if (next !== 0) {
      next = (last + r.se() + 256) % 256;
    }
    last = next === 0 ? last : next;
  }
}

/** The picture size, profile and level of an SPS NAL unit (with its 1-byte header). */
export function parseSps(nal: Buffer): SpsInfo {
  if ((nal[0] & 0x1f) !== NAL_SPS || nal.length < 4) {
    throw new Error('not an SPS');
  }
  const r = new BitReader(nal.subarray(1));
  const profileIdc = r.bits(8);
  r.bits(8); // constraint flags
  const levelIdc = r.bits(8);
  r.ue(); // seq_parameter_set_id
  let chromaFormatIdc = 1;
  if ([100, 110, 122, 244, 44, 83, 86, 118, 128, 138, 139, 134, 135].includes(profileIdc)) {
    chromaFormatIdc = r.ue();
    if (chromaFormatIdc === 3) {
      r.bit(); // separate_colour_plane_flag
    }
    r.ue(); // bit_depth_luma_minus8
    r.ue(); // bit_depth_chroma_minus8
    r.bit(); // qpprime_y_zero_transform_bypass_flag
    if (r.bit()) {
      // seq_scaling_matrix_present_flag
      for (let i = 0; i < (chromaFormatIdc !== 3 ? 8 : 12); i++) {
        if (r.bit()) {
          skipScalingList(r, i < 6 ? 16 : 64);
        }
      }
    }
  }
  r.ue(); // log2_max_frame_num_minus4
  const pocType = r.ue();
  if (pocType === 0) {
    r.ue(); // log2_max_pic_order_cnt_lsb_minus4
  } else if (pocType === 1) {
    r.bit(); // delta_pic_order_always_zero_flag
    r.se(); // offset_for_non_ref_pic
    r.se(); // offset_for_top_to_bottom_field
    const n = r.ue();
    for (let i = 0; i < n; i++) {
      r.se();
    }
  }
  r.ue(); // max_num_ref_frames
  r.bit(); // gaps_in_frame_num_value_allowed_flag
  const widthMbs = r.ue() + 1;
  const heightMapUnits = r.ue() + 1;
  const frameMbsOnly = r.bit();
  if (!frameMbsOnly) {
    r.bit(); // mb_adaptive_frame_field_flag
  }
  r.bit(); // direct_8x8_inference_flag
  let width = widthMbs * 16;
  let height = (2 - frameMbsOnly) * heightMapUnits * 16;
  if (r.bit()) {
    // frame_cropping_flag
    const left = r.ue();
    const right = r.ue();
    const top = r.ue();
    const bottom = r.ue();
    const cropX = chromaFormatIdc === 1 || chromaFormatIdc === 2 ? 2 : 1;
    const cropY = (chromaFormatIdc === 1 ? 2 : 1) * (2 - frameMbsOnly);
    width -= (left + right) * cropX;
    height -= (top + bottom) * cropY;
  }
  return { profileIdc, levelIdc, width, height };
}
