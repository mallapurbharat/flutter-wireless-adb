/**
 * Pure input/validation helpers with NO dependency on the vscode API, so they
 * can be reused by discovery/QR code and unit-tested under plain Node.
 *
 * The string-returning validators match VS Code's InputBox `validateInput`
 * contract: return an error string when invalid, or undefined when valid.
 */

/** True if the value is a syntactically valid IPv4 address. */
export function isValidIpv4(value: string): boolean {
  const match = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(value.trim());
  if (!match) {
    return false;
  }
  for (let i = 1; i <= 4; i++) {
    const octet = Number(match[i]);
    if (octet < 0 || octet > 255) {
      return false;
    }
  }
  return true;
}

/** True if the value is a valid TCP port (1–65535). */
export function isValidPort(value: number): boolean {
  return Number.isInteger(value) && value >= 1 && value <= 65535;
}

/** Validate an IPv4 address for an InputBox. */
export function validateIp(value: string): string | undefined {
  return isValidIpv4(value)
    ? undefined
    : 'Enter a valid IPv4 address, e.g. 192.168.1.42';
}

/** Validate a TCP port string for an InputBox. */
export function validatePort(value: string): string | undefined {
  const trimmed = value.trim();
  if (!/^\d+$/.test(trimmed)) {
    return 'Port must be a number';
  }
  if (!isValidPort(Number(trimmed))) {
    return 'Port must be between 1 and 65535';
  }
  return undefined;
}

/** Validate an Android pairing code for an InputBox (usually 6 digits). */
export function validatePairingCode(value: string): string | undefined {
  const trimmed = value.trim();
  if (trimmed.length < 6) {
    return 'Pairing code is usually 6 digits — check the dialog on your phone';
  }
  if (!/^\d+$/.test(trimmed)) {
    return 'Pairing code should contain digits only';
  }
  return undefined;
}

/**
 * Sanitize a host + port discovered over mDNS before handing it to adb.
 * Returns the validated pair, or undefined if either is unusable. This is a
 * defense-in-depth check even though values never reach a shell.
 */
export function sanitizeHostPort(
  host: string | undefined,
  port: number | undefined
): { host: string; port: number } | undefined {
  if (!host || port === undefined) {
    return undefined;
  }
  const trimmed = host.trim();
  if (!isValidIpv4(trimmed) || !isValidPort(port)) {
    return undefined;
  }
  return { host: trimmed, port };
}
