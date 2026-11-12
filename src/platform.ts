import { join } from 'node:path';
import type { API, DynamicPlatformPlugin, Logging, PlatformAccessory, PlatformConfig } from 'homebridge';
import { PushNotificationAction, RingApi, type RingCamera } from 'ring-client-api';
import { chooseCamera, ConfigError, readConfig, type PluginConfig } from './config.js';
import { describeEvent } from './events.js';
import { runProbe } from './probe.js';
import { CONTROL_CENTER_NAME, PLATFORM_NAME, PLUGIN_NAME, PROBE_DELAY_MS, STORAGE_FOLDER } from './settings.js';
import { PluginState } from './state.js';

/**
 * 0.1 (stream probe): connects to Ring with the plugin's own token, finds the doorbell, logs its
 * motion and doorbell events with how late they arrive, and (setting "Stream probe") measures
 * one live call to tell whether HomeKit Secure Video can use its video as it is. It adds
 * nothing to HomeKit yet.
 */
export class RingHksvPlatform implements DynamicPlatformPlugin {
  private readonly config?: PluginConfig;
  private ringApi?: RingApi;
  private readonly subscriptions: { unsubscribe(): void }[] = [];
  private probeTimer?: NodeJS.Timeout;
  private readonly stopping = new AbortController();
  private stopped = false;

  constructor(
    private readonly log: Logging,
    rawConfig: PlatformConfig,
    private readonly api: API,
  ) {
    try {
      this.config = readConfig(rawConfig as Record<string, unknown>);
    } catch (e) {
      if (e instanceof ConfigError) {
        this.log.error(`Not starting: ${e.message}`);
        return;
      }
      throw e;
    }
    this.api.on('didFinishLaunching', () => {
      this.start().catch((e: unknown) => this.log.error(`Could not start: ${(e as Error).message}`));
    });
    this.api.on('shutdown', () => this.stop());
  }

  configureAccessory(accessory: PlatformAccessory): void {
    // 0.1 adds no accessories; one left from a later version is removed at start.
    this.api.unregisterPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [accessory]);
  }

  private get storageDir(): string {
    return join(this.api.user.storagePath(), STORAGE_FOLDER);
  }

  private async start(): Promise<void> {
    const config = this.config!;
    const state = new PluginState(this.storageDir);
    const { token, fromConfig } = state.tokenFor(config.refreshToken);
    this.log.debug(fromConfig ? 'Signing in with the token from the settings' : 'Signing in with the token saved at the last run');
    const ringApi = new RingApi({
      refreshToken: token,
      systemId: state.systemId,
      controlCenterDisplayName: CONTROL_CENTER_NAME,
      ffmpegPath: config.ffmpegPath,
      avoidSnapshotBatteryDrain: true,
      debug: config.debug,
    });
    this.ringApi = ringApi;
    this.subscriptions.push(
      ringApi.onRefreshTokenUpdated.subscribe(({ newRefreshToken }) => {
        state.saveToken(newRefreshToken);
        this.log.debug('Ring issued a new token; saved for the next start');
      }),
    );

    let cameras: RingCamera[];
    try {
      cameras = await ringApi.getCameras();
    } catch (e) {
      this.log.error(
        `Could not sign in to Ring: ${(e as Error).message}. If the token was revoked or used by another app, ` +
          'create a new one with: npx -p ring-client-api ring-auth-cli, and paste it into the settings.',
      );
      return;
    }
    if (this.stopped) {
      return;
    }
    this.log.info(`Signed in to Ring (shows as "${CONTROL_CENTER_NAME}" under Authorized Client Devices in the Ring app's Control Center)`);
    for (const c of cameras) {
      const battery = c.batteryLevel === null ? '' : `, battery ${c.batteryLevel}%`;
      this.log.info(`Ring camera: ${c.name} (id ${c.id}, ${c.model}${c.isDoorbot ? ', doorbell' : ''}${battery}${c.isOffline ? ', OFFLINE' : ''})`);
    }
    const chosen = chooseCamera(cameras, config.camera);
    if (typeof chosen === 'string') {
      this.log.error(`No camera to use: ${chosen}`);
      return;
    }
    this.watch(chosen);
    if (config.probeSeconds > 0) {
      this.log.info(`Stream probe: runs in ${PROBE_DELAY_MS / 1000} s`);
      this.probeTimer = setTimeout(() => {
        runProbe(chosen, config.probeSeconds, this.storageDir, this.log, this.stopping.signal).catch((e: unknown) =>
          this.log.error(`Stream probe failed: ${(e as Error).message}`),
        );
      }, PROBE_DELAY_MS);
    }
  }

  /** Logs the camera's events, with how late each arrives. */
  private watch(camera: RingCamera): void {
    this.log.info(`Using ${camera.name}: logging its motion and doorbell events (nothing is added to HomeKit in this version)`);
    if ((camera.data as { settings?: { e2ee_enabled?: boolean } }).settings?.e2ee_enabled) {
      this.log.warn(`${camera.name} has end-to-end encryption on in the Ring app; live video from it will not work`);
    }
    let motionOn = false;
    this.subscriptions.push(
      camera.onNewNotification.subscribe((n) => {
        const category = n.android_config?.category;
        if (category === PushNotificationAction.Ding) {
          this.log.info(`${camera.name}: ${describeEvent('doorbell pressed', n, Date.now())}`);
        } else if (category === PushNotificationAction.Motion) {
          this.log.info(`${camera.name}: ${describeEvent('motion', n, Date.now())}`);
        } else {
          this.log.debug(`${camera.name}: notification ${category}`);
        }
      }),
      camera.onMotionDetected.subscribe((on) => {
        if (motionOn && !on) {
          this.log.info(`${camera.name}: motion ended`);
        }
        motionOn = on;
      }),
    );
  }

  private stop(): void {
    this.stopped = true;
    clearTimeout(this.probeTimer);
    this.stopping.abort();
    for (const s of this.subscriptions) {
      s.unsubscribe();
    }
    this.subscriptions.length = 0;
    this.ringApi?.disconnect();
  }
}
