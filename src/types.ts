/**
 * Shared type definitions for the Flutter Wireless ADB extension.
 */

/** Possible states reported by `adb devices`. */
export type AdbDeviceState = 'device' | 'offline' | 'unauthorized' | 'unknown';

/** A single device parsed from `adb devices`. */
export interface AdbDevice {
  /** The adb serial, e.g. "192.168.1.42:5555" for wireless devices. */
  serial: string;
  /** Connection state. */
  state: AdbDeviceState;
  /** Whether this looks like a wireless (ip:port) device. */
  isWireless: boolean;
  /** Parsed IP if wireless, otherwise undefined. */
  ip?: string;
  /** Parsed port if wireless, otherwise undefined. */
  port?: number;
}

/** Result of running an adb/flutter command. */
export interface CommandResult {
  /** Process exit code (null if the process was killed/never started). */
  code: number | null;
  /** Captured stdout (trimmed). */
  stdout: string;
  /** Captured stderr (trimmed). */
  stderr: string;
  /** Convenience flag: true when code === 0. */
  success: boolean;
}

/** A device the user has saved for quick reconnect. */
export interface KnownDevice {
  /** Friendly name shown in the UI. */
  name: string;
  /** Device IP address. */
  ip: string;
  /** Debug/connect port (NOT the pairing port). */
  debugPort: number;
  /** adb serial last seen for this device, e.g. "192.168.1.42:5555" (optional). */
  serial?: string;
  /** ISO timestamp of the last successful connect (optional). */
  lastConnectedAt?: string;
}

/** High-level connection status used to drive the status bar. */
export type ConnectionStatus =
  | 'connected'
  | 'disconnected'
  | 'checking'
  | 'not-found';

/** A raw service record parsed from `adb mdns services`. */
export interface MdnsServiceRecord {
  /** Instance name, e.g. "adb-XXXX-YYYY" or our "ADB_WIFI_<id>". */
  name: string;
  /** Service type, e.g. "_adb-tls-pairing._tcp". */
  serviceType: string;
  /** Parsed IPv4 address, if present. */
  ip?: string;
  /** Parsed port, if present. */
  port?: number;
}

/** A resolved mDNS service (from multicast-dns or adb), ready to use. */
export interface DiscoveredService {
  /** Instance name advertised by the device. */
  name: string;
  /** Service type, e.g. "_adb-tls-pairing._tcp". */
  serviceType: string;
  /** Target hostname (may be an mDNS .local name); optional. */
  host?: string;
  /** Resolved IPv4 address. */
  address: string;
  /** Service port. */
  port: number;
  /** Which backend resolved this service (for logging/diagnostics). */
  source: 'multicast-dns' | 'adb-mdns';
}

/** A QR pairing session: the random identifiers and the QR payload. */
export interface QrSession {
  /** Random mDNS service name placed in the QR's S: field. */
  serviceName: string;
  /** Random, temporary pairing password placed in the QR's P: field. Never stored. */
  password: string;
  /** The full QR payload string: WIFI:T:ADB;S:<name>;P:<password>;; */
  payload: string;
}
