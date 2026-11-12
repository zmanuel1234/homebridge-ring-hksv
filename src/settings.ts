/** Name the platform is configured under in config.json. */
export const PLATFORM_NAME = 'RingHksv';
export const PLUGIN_NAME = 'homebridge-ring-hksv';

/** How this plugin shows in the Ring app's Control Center (Authorized Client Devices). */
export const CONTROL_CENTER_NAME = 'homebridge-ring-hksv';

/** Folder inside Homebridge's storage folder for this plugin's own files. */
export const STORAGE_FOLDER = 'ring-hksv';

/** The stream probe: default and limits of its length (s). */
export const PROBE_DEFAULT_S = 30;
export const PROBE_MIN_S = 10;
export const PROBE_MAX_S = 60;
/** The probe starts this long after Homebridge has started, so startup is quiet first. */
export const PROBE_DELAY_MS = 15_000;
/** The probe gives up if the stream hasn't sent any video after this long. */
export const PROBE_NO_VIDEO_MS = 20_000;

/**
 * HomeKit Secure Video's fragment length (ms). Recording with the camera's own video (no
 * re-encoding) needs a keyframe at least this often.
 */
export const HKSV_FRAGMENT_MS = 4000;
