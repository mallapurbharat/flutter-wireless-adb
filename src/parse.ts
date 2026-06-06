import { AdbDevice, AdbDeviceState, MdnsServiceRecord } from './types';

/**
 * Pure parsing helpers with NO dependency on the vscode API, so they can be
 * unit-tested under plain Node.
 */

/** Map an adb state token onto our known state union. */
function normalizeState(token: string): AdbDeviceState {
  switch (token) {
    case 'device':
    case 'offline':
    case 'unauthorized':
      return token;
    default:
      return 'unknown';
  }
}

/** Extract ip/port from an "ip:port" serial, if it matches. */
function parseWireless(
  serial: string
): { ip: string; port: number } | undefined {
  const match = /^(\d{1,3}(?:\.\d{1,3}){3}):(\d{1,5})$/.exec(serial);
  if (!match) {
    return undefined;
  }
  return { ip: match[1], port: Number(match[2]) };
}

/**
 * Parse the textual output of `adb devices` robustly.
 *
 * Example:
 *   List of devices attached
 *   192.168.1.42:5555   device
 *   emulator-5554       offline
 */
export function parseAdbDevices(raw: string): AdbDevice[] {
  const devices: AdbDevice[] = [];
  const lines = raw.split(/\r?\n/);

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) {
      continue;
    }
    if (/^List of devices attached/i.test(trimmed)) {
      continue;
    }
    if (/^\*/.test(trimmed)) {
      // Daemon chatter: "* daemon not running; starting now ..."
      continue;
    }
    if (/^adb:/i.test(trimmed)) {
      continue;
    }

    const parts = trimmed.split(/\s+/);
    if (parts.length < 2) {
      continue;
    }
    const serial = parts[0];
    const state = normalizeState(parts[1]);
    const wireless = parseWireless(serial);

    devices.push({
      serial,
      state,
      isWireless: wireless !== undefined,
      ip: wireless?.ip,
      port: wireless?.port,
    });
  }

  return devices;
}

/**
 * Parse the output of `adb mdns services` robustly.
 *
 * Example output (columns are whitespace/tab separated):
 *   List of discovered mdns services
 *   adb-39281749-RvBHvL  _adb-tls-connect._tcp.  192.168.1.42:42801
 *   ADB_WIFI_abc123      _adb-tls-pairing._tcp.  192.168.1.42:37155
 *
 * Only `_adb-*` service types are returned. The trailing dot on the service
 * type (and any trailing ".local") is normalized away.
 */
export function parseMdnsServices(raw: string): MdnsServiceRecord[] {
  const records: MdnsServiceRecord[] = [];
  const lines = raw.split(/\r?\n/);

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) {
      continue;
    }
    if (/^List of discovered mdns services/i.test(trimmed)) {
      continue;
    }
    if (/^No mdns services/i.test(trimmed)) {
      continue;
    }
    if (/^\*/.test(trimmed) || /^adb:/i.test(trimmed)) {
      continue;
    }

    const parts = trimmed.split(/\s+/);
    if (parts.length < 2) {
      continue;
    }
    const name = parts[0];
    const serviceType = normalizeServiceType(parts[1]);
    // Only keep adb service types; skip anything unexpected.
    if (!/^_adb/.test(serviceType)) {
      continue;
    }

    let ip: string | undefined;
    let port: number | undefined;
    if (parts[2]) {
      const m = /^(\d{1,3}(?:\.\d{1,3}){3}):(\d{1,5})$/.exec(parts[2]);
      if (m) {
        ip = m[1];
        port = Number(m[2]);
      }
    }

    records.push({ name, serviceType, ip, port });
  }

  return records;
}

/** Strip a trailing ".local", ".local.", and any trailing dot from a type. */
function normalizeServiceType(raw: string): string {
  return raw
    .replace(/\.local\.?$/i, '')
    .replace(/\.$/, '');
}
