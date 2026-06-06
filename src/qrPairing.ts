import * as crypto from 'crypto';
import { QrSession } from './types';

/**
 * Pure helpers for Android Wireless Debugging QR pairing.
 *
 * NO dependency on the vscode API so these can be unit-tested under plain Node.
 *
 * The QR payload format (from AOSP Settings) is:
 *   WIFI:T:ADB;S:<serviceName>;P:<password>;;
 * where the phone uses S: as the mDNS service name it advertises and P: as the
 * pre-shared pairing password.
 */

/** Prefix for our generated mDNS service name (mirrors Android Studio's style). */
const SERVICE_NAME_PREFIX = 'ADB_WIFI_';

/**
 * Build the QR payload from a service name and password.
 *
 * Both inputs MUST be free of the delimiter characters ';' and ':' so the
 * payload cannot be corrupted. `createQrSession` only ever produces hex, which
 * satisfies this; we assert here as defense-in-depth.
 */
export function buildQrPayload(serviceName: string, password: string): string {
  if (/[;:]/.test(serviceName) || /[;:]/.test(password)) {
    throw new Error('serviceName/password must not contain ";" or ":"');
  }
  return `WIFI:T:ADB;S:${serviceName};P:${password};;`;
}

/**
 * Create a fresh QR pairing session with a random service name and a random,
 * temporary password.
 *
 * The password is hex-only (URL/QR-safe, no delimiters) and is NEVER persisted.
 */
export function createQrSession(): QrSession {
  const serviceName = SERVICE_NAME_PREFIX + crypto.randomBytes(6).toString('hex');
  // 8 random bytes -> 16 hex chars. Plenty of entropy; payload-safe charset.
  const password = crypto.randomBytes(8).toString('hex');
  const payload = buildQrPayload(serviceName, password);
  return { serviceName, password, payload };
}

/**
 * Redact a password everywhere it appears in a string (for safe logging).
 * Returns the text unchanged when the password is empty.
 */
export function redactPassword(text: string, password: string): string {
  if (!password) {
    return text;
  }
  // Escape regex metacharacters in the password before building the matcher.
  const escaped = password.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return text.replace(new RegExp(escaped, 'g'), '******');
}

/**
 * Redact the P: (password) field of a QR payload, regardless of its value.
 * e.g. "WIFI:T:ADB;S:ADB_WIFI_ab12;P:deadbeef;;"
 *   -> "WIFI:T:ADB;S:ADB_WIFI_ab12;P:<redacted>;;"
 */
export function redactQrPayload(payload: string): string {
  return payload.replace(/(;P:)[^;]*/i, '$1<redacted>');
}
