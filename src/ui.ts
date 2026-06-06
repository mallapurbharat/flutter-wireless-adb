import * as vscode from 'vscode';
import { validateIp, validatePort, validatePairingCode } from './validate';

/**
 * UI prompts (QuickPick / InputBox). The pure validators live in `validate.ts`
 * and are re-exported here for backward compatibility with existing imports.
 */
export { validateIp, validatePort, validatePairingCode };

/** Details gathered from the pairing prompts. */
export interface PairingInput {
  ip: string;
  pairingPort: number;
  pairingCode: string;
  debugPort: number;
  friendlyName?: string;
}

/**
 * Walk the user through the pairing prompts. Returns undefined if the user
 * cancels at any step.
 *
 * The pairing port and debug port are clearly distinguished in the prompts,
 * because Android shows them in two different places.
 */
export async function promptForPairing(): Promise<PairingInput | undefined> {
  const ip = await vscode.window.showInputBox({
    title: 'Pair New Device (1/5) — IP address',
    prompt: 'Device IP address shown under Wireless debugging on your phone',
    placeHolder: '192.168.1.42',
    ignoreFocusOut: true,
    validateInput: validateIp,
  });
  if (ip === undefined) {
    return undefined;
  }

  const pairingPortRaw = await vscode.window.showInputBox({
    title: 'Pair New Device (2/5) — PAIRING port',
    prompt:
      'The PAIRING port — shown on the "Pair device with pairing code" dialog ' +
      '(this is NOT the main debug port).',
    placeHolder: 'e.g. 37123',
    ignoreFocusOut: true,
    validateInput: validatePort,
  });
  if (pairingPortRaw === undefined) {
    return undefined;
  }

  const pairingCode = await vscode.window.showInputBox({
    title: 'Pair New Device (3/5) — pairing code',
    prompt:
      'The 6-digit pairing code shown on your phone. It is used once and never stored.',
    placeHolder: '123456',
    ignoreFocusOut: true,
    password: true,
    validateInput: validatePairingCode,
  });
  if (pairingCode === undefined) {
    return undefined;
  }

  const debugPortRaw = await vscode.window.showInputBox({
    title: 'Pair New Device (4/5) — DEBUG/connect port',
    prompt:
      'The DEBUG port — shown on the main "Wireless debugging" screen ' +
      '(this is DIFFERENT from the pairing port).',
    placeHolder: 'e.g. 5555 or 39000',
    ignoreFocusOut: true,
    validateInput: validatePort,
  });
  if (debugPortRaw === undefined) {
    return undefined;
  }

  const friendlyName = await vscode.window.showInputBox({
    title: 'Pair New Device (5/5) — friendly name (optional)',
    prompt: 'An optional name to recognize this device later. Leave empty to skip.',
    placeHolder: 'Pixel 7',
    ignoreFocusOut: true,
  });
  // friendlyName === undefined means cancelled; empty string is allowed.
  if (friendlyName === undefined) {
    return undefined;
  }

  return {
    ip: ip.trim(),
    pairingPort: Number(pairingPortRaw.trim()),
    pairingCode: pairingCode.trim(),
    debugPort: Number(debugPortRaw.trim()),
    friendlyName: friendlyName.trim() || undefined,
  };
}

/**
 * Prompt for an optional friendly name (used by the QR flow after a successful
 * connect). Returns the trimmed name, or undefined if left empty/cancelled.
 */
export async function promptForFriendlyName(
  suggestion?: string
): Promise<string | undefined> {
  const name = await vscode.window.showInputBox({
    title: 'Name this device (optional)',
    prompt: 'An optional name to recognize this device later. Leave empty to skip.',
    placeHolder: suggestion || 'Pixel 7',
    ignoreFocusOut: true,
  });
  return name?.trim() || undefined;
}

/**
 * Prompt for a debug/connect port. Used as a fallback in the QR flow when the
 * connect service cannot be auto-discovered after a successful pair.
 */
export async function promptForDebugPort(): Promise<number | undefined> {
  const raw = await vscode.window.showInputBox({
    title: 'Connect — DEBUG/connect port',
    prompt:
      'Pairing succeeded but the connect service was not found automatically. ' +
      'Enter the DEBUG port shown on the main "Wireless debugging" screen.',
    placeHolder: 'e.g. 5555 or 39000',
    ignoreFocusOut: true,
    validateInput: validatePort,
  });
  if (raw === undefined) {
    return undefined;
  }
  return Number(raw.trim());
}
