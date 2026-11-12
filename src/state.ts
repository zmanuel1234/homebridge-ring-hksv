import { createHash, randomUUID } from 'node:crypto';
import { chmodSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * What the plugin keeps between restarts, in `<Homebridge storage>/ring-hksv/state.json`
 * (readable by the Homebridge user only):
 *
 * - The current Ring refresh token. Ring replaces the token now and then (and the plugin's push
 *   notification credentials are stored inside it), so the one in config.json goes stale; the
 *   newest is saved here and used instead.
 * - Which config.json token that chain started from (as a hash, not the token), so pasting a
 *   new token into the settings takes over from the saved one.
 * - The plugin's own system id. Ring tells client devices apart by a hardware id, which
 *   ring-client-api would otherwise derive from the machine, the same one homebridge-ring uses
 *   on the same Pi. With its own id, the plugin is a separate entry in Ring's Control Center.
 */
interface StateFile {
  systemId?: string;
  configTokenHash?: string;
  refreshToken?: string;
}

export function tokenHash(token: string): string {
  return createHash('sha256').update(token).digest('hex').slice(0, 16);
}

export class PluginState {
  private readonly file: string;
  private data: StateFile = {};

  constructor(private readonly dir: string) {
    this.file = join(dir, 'state.json');
    try {
      const parsed: unknown = JSON.parse(readFileSync(this.file, 'utf8'));
      if (parsed && typeof parsed === 'object') {
        this.data = parsed as StateFile;
      }
    } catch {
      // No state yet (first start) or an unreadable file: start afresh.
    }
  }

  /** The plugin's own system id, made once and kept. */
  get systemId(): string {
    if (!this.data.systemId) {
      this.data.systemId = `homebridge-ring-hksv-${randomUUID()}`;
      this.save();
    }
    return this.data.systemId;
  }

  /**
   * The token to sign in with: the saved one, unless the token in config.json changed since it
   * was saved (the user pasted a new one).
   */
  tokenFor(configToken: string): { token: string; fromConfig: boolean } {
    const hash = tokenHash(configToken);
    if (this.data.configTokenHash === hash && this.data.refreshToken) {
      return { token: this.data.refreshToken, fromConfig: false };
    }
    this.data.configTokenHash = hash;
    this.data.refreshToken = undefined;
    this.save();
    return { token: configToken, fromConfig: true };
  }

  /** Ring issued a new token: keep it for the next start. */
  saveToken(token: string): void {
    this.data.refreshToken = token;
    this.save();
  }

  private save(): void {
    mkdirSync(this.dir, { recursive: true, mode: 0o700 });
    const tmp = `${this.file}.${process.pid}.tmp`;
    writeFileSync(tmp, JSON.stringify(this.data, null, 2), { mode: 0o600 });
    chmodSync(tmp, 0o600);
    renameSync(tmp, this.file);
  }
}
