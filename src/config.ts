import { PROBE_DEFAULT_S, PROBE_MAX_S, PROBE_MIN_S } from './settings.js';

/** The plugin's settings, checked and with defaults filled in. */
export interface PluginConfig {
  name: string;
  /** The refresh token from ring-auth-cli. Only used until the plugin has saved a newer one. */
  refreshToken: string;
  /** Which camera: its name in the Ring app or its numeric id. Empty: the only doorbell. */
  camera: string;
  /** The stream probe's length in seconds, or 0 for no probe. */
  probeSeconds: number;
  ffmpegPath?: string;
  debug: boolean;
}

export class ConfigError extends Error {}

function text(v: unknown): string {
  return typeof v === 'string' ? v.trim() : typeof v === 'number' ? String(v) : '';
}

/** Checks the settings from config.json. Throws ConfigError when the plugin can't run with them. */
export function readConfig(raw: Record<string, unknown>): PluginConfig {
  const refreshToken = text(raw.refreshToken);
  if (!refreshToken) {
    throw new ConfigError(
      'refreshToken is missing. Create one on the Pi with: cd ~ && npx -y -p ring-client-api@14.3.0 ring-auth-cli ' +
        '(use a new token for this plugin, not the one homebridge-ring uses).',
    );
  }
  let probeSeconds = 0;
  if (raw.probe === true) {
    const n = Number(raw.probeSeconds ?? PROBE_DEFAULT_S);
    probeSeconds = Number.isFinite(n) ? Math.min(PROBE_MAX_S, Math.max(PROBE_MIN_S, Math.round(n))) : PROBE_DEFAULT_S;
  }
  const ffmpegPath = text(raw.ffmpegPath);
  return {
    name: text(raw.name) || 'Ring HKSV',
    refreshToken,
    camera: text(raw.camera),
    probeSeconds,
    ffmpegPath: ffmpegPath || undefined,
    debug: raw.debug === true,
  };
}

/** What the camera chooser needs to know about each camera. */
export interface CameraInfo {
  id: number;
  name: string;
  isDoorbot: boolean;
}

/**
 * Picks the camera the settings ask for: by numeric id or by name (case doesn't matter). Without
 * a `camera` setting, the account's only doorbell. Returns the camera, or why none was chosen.
 */
export function chooseCamera<T extends CameraInfo>(cameras: T[], wanted: string): T | string {
  if (wanted) {
    const lower = wanted.toLowerCase();
    const found = cameras.find((c) => String(c.id) === wanted) ?? cameras.find((c) => c.name.toLowerCase() === lower);
    return found ?? `no camera called "${wanted}" in the Ring account`;
  }
  const doorbells = cameras.filter((c) => c.isDoorbot);
  if (doorbells.length === 1) {
    return doorbells[0];
  }
  return doorbells.length === 0
    ? 'no doorbell in the Ring account'
    : `${doorbells.length} doorbells in the Ring account: set "camera" to the one to use`;
}
