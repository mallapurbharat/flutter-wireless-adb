import * as vscode from 'vscode';
import { KnownDevice } from './types';

/**
 * Persists known devices (IP, debug port, friendly name) so the user can
 * reconnect without pairing again.
 *
 * IMPORTANT: pairing codes are NEVER stored. Only the non-sensitive reconnect
 * details are kept.
 *
 * Storage strategy: devices are mirrored into the `flutterWirelessAdb.knownDevices`
 * setting (so they're visible/portable) AND validated through global state.
 * The setting is the source of truth here, written at the Global target.
 */
export class DeviceStore {
  constructor(private readonly context: vscode.ExtensionContext) {}

  /** Return all known devices. */
  public getAll(): KnownDevice[] {
    const devices = vscode.workspace
      .getConfiguration('flutterWirelessAdb')
      .get<KnownDevice[]>('knownDevices', []);
    // Defensive copy + light validation.
    return (devices || []).filter(
      (d) =>
        d &&
        typeof d.ip === 'string' &&
        typeof d.debugPort === 'number' &&
        typeof d.name === 'string'
    );
  }

  /** Find a device by ip + debug port. */
  public find(ip: string, debugPort: number): KnownDevice | undefined {
    return this.getAll().find(
      (d) => d.ip === ip && d.debugPort === debugPort
    );
  }

  /**
   * Add or update a known device (keyed by ip + debugPort). Persists to the
   * global configuration target.
   */
  public async upsert(device: KnownDevice): Promise<void> {
    const all = this.getAll();
    // Stamp the last-connected time unless the caller supplied one.
    const stamped: KnownDevice = {
      ...device,
      lastConnectedAt: device.lastConnectedAt ?? new Date().toISOString(),
    };
    const idx = all.findIndex(
      (d) => d.ip === device.ip && d.debugPort === device.debugPort
    );
    if (idx >= 0) {
      all[idx] = stamped;
    } else {
      all.push(stamped);
    }
    await this.save(all);
  }

  /** Remove a known device by ip + debug port. */
  public async remove(ip: string, debugPort: number): Promise<void> {
    const all = this.getAll().filter(
      (d) => !(d.ip === ip && d.debugPort === debugPort)
    );
    await this.save(all);
  }

  /** Persist the full list to global settings. */
  private async save(devices: KnownDevice[]): Promise<void> {
    await vscode.workspace
      .getConfiguration('flutterWirelessAdb')
      .update(
        'knownDevices',
        devices,
        vscode.ConfigurationTarget.Global
      );
    // Touch global state with a last-updated marker (used for diagnostics).
    await this.context.globalState.update(
      'knownDevices.updatedAt',
      new Date().toISOString()
    );
  }
}
