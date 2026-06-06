import * as vscode from 'vscode';
import { AdbService, AdbNotFoundError } from './adb';
import { FlutterService } from './flutter';
import { DeviceStore } from './deviceStore';
import { promptForPairing, promptForFriendlyName, promptForDebugPort } from './ui';
import { ConnectionStatus, DiscoveredService, KnownDevice } from './types';
import { createQrSession, redactPassword, redactQrPayload } from './qrPairing';
import { QrPanel } from './webviewQrPanel';
import {
  discoverService,
  selectPairingService,
  ADB_PAIRING_TYPE,
  ADB_CONNECT_TYPE,
} from './mdns';

/**
 * Entry point. Activates on first command invocation (no eager activation
 * events declared, so VS Code activates lazily on command use).
 */
let output: vscode.OutputChannel;
let adb: AdbService;
let flutter: FlutterService;
let store: DeviceStore;
let statusBar: vscode.StatusBarItem;
let refreshTimer: NodeJS.Timeout | undefined;

export function activate(context: vscode.ExtensionContext): void {
  output = vscode.window.createOutputChannel('Flutter Wireless ADB');
  adb = new AdbService(output);
  flutter = new FlutterService(output);
  store = new DeviceStore(context);

  statusBar = vscode.window.createStatusBarItem(
    vscode.StatusBarAlignment.Left,
    100
  );
  statusBar.command = 'flutterWirelessAdb.showMenu';
  context.subscriptions.push(statusBar, output);
  statusBar.show();

  // Register all commands.
  context.subscriptions.push(
    vscode.commands.registerCommand(
      'flutterWirelessAdb.pairNewDevice',
      () => pairNewDevice()
    ),
    vscode.commands.registerCommand(
      'flutterWirelessAdb.pairWithQr',
      () => pairWithQrCode()
    ),
    vscode.commands.registerCommand(
      'flutterWirelessAdb.connectKnownDevice',
      () => connectKnownDevice()
    ),
    vscode.commands.registerCommand(
      'flutterWirelessAdb.disconnectDevice',
      () => disconnectDevice()
    ),
    vscode.commands.registerCommand(
      'flutterWirelessAdb.listDevices',
      () => listDevices()
    ),
    vscode.commands.registerCommand(
      'flutterWirelessAdb.refreshStatus',
      () => refreshStatus()
    ),
    vscode.commands.registerCommand(
      'flutterWirelessAdb.openSettings',
      () => openSettings()
    ),
    vscode.commands.registerCommand(
      'flutterWirelessAdb.troubleshooting',
      () => showTroubleshooting()
    ),
    vscode.commands.registerCommand(
      'flutterWirelessAdb.showMenu',
      () => showQuickMenu()
    )
  );

  // Re-evaluate adb path when relevant settings change.
  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration('flutterWirelessAdb.adbPath')) {
        adb.invalidateCache();
        void refreshStatus();
      }
      if (
        e.affectsConfiguration(
          'flutterWirelessAdb.statusRefreshIntervalSeconds'
        )
      ) {
        scheduleAutoRefresh();
      }
    })
  );

  // Kick off an initial status check and background refresh loop.
  scheduleAutoRefresh();
  void refreshStatus();
}

export function deactivate(): void {
  if (refreshTimer) {
    clearInterval(refreshTimer);
    refreshTimer = undefined;
  }
}

// ---------------------------------------------------------------------------
// Status bar
// ---------------------------------------------------------------------------

function setStatus(status: ConnectionStatus, detail?: string): void {
  switch (status) {
    case 'connected':
      statusBar.text = '$(device-mobile) ADB: Connected';
      statusBar.tooltip = detail || 'A device is connected. Click for actions.';
      break;
    case 'disconnected':
      statusBar.text = '$(device-mobile) ADB: Disconnected';
      statusBar.tooltip = detail || 'No device connected. Click for actions.';
      break;
    case 'checking':
      statusBar.text = '$(sync~spin) ADB: Checking';
      statusBar.tooltip = 'Checking device status…';
      break;
    case 'not-found':
      statusBar.text = '$(warning) ADB: Not Found';
      statusBar.tooltip =
        detail || 'adb was not found. Click to configure the adb path.';
      break;
  }
}

/**
 * Refresh the connection status by querying `adb devices` and updating the
 * status bar. Safe to call repeatedly; never throws.
 */
async function refreshStatus(): Promise<void> {
  setStatus('checking');
  try {
    const devices = await adb.listDevices();
    const online = devices.filter((d) => d.state === 'device');
    if (online.length > 0) {
      const serials = online.map((d) => d.serial).join(', ');
      setStatus('connected', `Connected: ${serials}`);
    } else if (devices.length > 0) {
      // Devices present but not in 'device' state (offline/unauthorized).
      const detail = devices
        .map((d) => `${d.serial} (${d.state})`)
        .join(', ');
      setStatus('disconnected', detail);
    } else {
      setStatus('disconnected', 'No devices');
    }
  } catch (err) {
    if (err instanceof AdbNotFoundError) {
      setStatus('not-found', err.message);
    } else {
      setStatus('disconnected', `Error: ${String(err)}`);
    }
  }
}

/** (Re)start the background refresh timer based on the configured interval. */
function scheduleAutoRefresh(): void {
  if (refreshTimer) {
    clearInterval(refreshTimer);
    refreshTimer = undefined;
  }
  const seconds = vscode.workspace
    .getConfiguration('flutterWirelessAdb')
    .get<number>('statusRefreshIntervalSeconds', 30);
  if (seconds && seconds > 0) {
    refreshTimer = setInterval(() => void refreshStatus(), seconds * 1000);
  }
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

/** Pair + connect a brand new device. */
async function pairNewDevice(): Promise<void> {
  // Fail fast if adb is missing, with a helpful action.
  if (!(await ensureAdbAvailable())) {
    return;
  }

  const input = await promptForPairing();
  if (!input) {
    return; // user cancelled
  }

  await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: 'Flutter Wireless ADB',
      cancellable: false,
    },
    async (progress) => {
      progress.report({ message: 'Pairing…' });
      const pairResult = await adb.pair(
        input.ip,
        input.pairingPort,
        input.pairingCode
      );

      // adb pair prints "Successfully paired" on success. It can also exit
      // non-zero on failure; check both the code and the text.
      const pairedOk =
        pairResult.success &&
        /successfully paired/i.test(pairResult.stdout + pairResult.stderr);
      if (!pairedOk) {
        const msg =
          pairResult.stdout ||
          pairResult.stderr ||
          'Pairing failed. Double-check the pairing port and code (they expire quickly).';
        vscode.window
          .showErrorMessage(`Pairing failed: ${msg}`, 'Troubleshooting')
          .then((choice) => {
            if (choice === 'Troubleshooting') {
              void showTroubleshooting();
            }
          });
        return;
      }

      progress.report({ message: 'Connecting…' });
      const connectResult = await adb.connect(input.ip, input.debugPort);
      // adb connect reports failure on stdout with exit code 0.
      const connectedOk =
        connectResult.success &&
        /connected to|already connected/i.test(connectResult.stdout);
      if (!connectedOk) {
        const msg = connectResult.stdout || connectResult.stderr;
        vscode.window
          .showErrorMessage(
            `Paired, but connect failed: ${msg}`,
            'Troubleshooting'
          )
          .then((choice) => {
            if (choice === 'Troubleshooting') {
              void showTroubleshooting();
            }
          });
        return;
      }

      progress.report({ message: 'Verifying…' });
      await verifyAndFinish(input.ip, input.debugPort, input.friendlyName);
    }
  );
}

/**
 * Pair a new device using Android 11+ Wireless Debugging QR code.
 *
 * Flow: generate a random service name + temporary password → show a QR the
 * phone scans → discover the `_adb-tls-pairing` service over mDNS → `adb pair`
 * → discover `_adb-tls-connect` → `adb connect` → verify → persist.
 *
 * The temporary password is never stored and is redacted from logs.
 */
async function pairWithQrCode(): Promise<void> {
  if (!(await ensureAdbAvailable())) {
    return;
  }

  // Warn (but don't hard-block) if adb's mDNS backend looks unavailable — the
  // multicast-dns backend may still work, so we proceed and let discovery race.
  const mdnsOk = await adb.mdnsCheck();
  if (!mdnsOk) {
    output.appendLine(
      '[qr] adb mdns appears unavailable; relying on multicast-dns. ' +
        'If discovery times out, check your firewall/VPN or use manual pairing.'
    );
  }

  const session = createQrSession();
  // Log the payload with the password redacted — never log the real secret.
  output.appendLine(
    `[qr] session ${session.serviceName} payload: ` +
      redactQrPayload(session.payload)
  );

  const controller = new AbortController();
  const panel = new QrPanel(session.payload, () => controller.abort());

  try {
    panel.setStatus('Open Wireless debugging on your phone, then scan this code…');

    // 1) Wait for the phone to advertise the pairing service after scanning.
    //    Only one pairing service is advertised while the dialog is open, so we
    //    take any `_adb-tls-pairing` service; matching our serviceName only
    //    raises log confidence (OEMs don't always echo it as the instance name).
    const pairing = await discoverService({
      serviceType: ADB_PAIRING_TYPE,
      timeoutMs: 60_000,
      signal: controller.signal,
      adb,
      logger: output,
      // Prefer a service whose name matches our QR serviceName, but accept the
      // sole visible pairing service otherwise (OEMs don't always echo it).
      choose: (candidates) => {
        const sel = selectPairingService(candidates, session.serviceName);
        if (!sel) {
          return undefined;
        }
        switch (sel.confidence) {
          case 'name-match':
            output.appendLine(
              '[qr] Matched pairing service by generated QR service name'
            );
            break;
          case 'sole-service':
            output.appendLine(
              '[qr] Using only visible adb pairing service; name did not match generated QR service name'
            );
            break;
          case 'ambiguous-first':
            output.appendLine(
              '[qr] Multiple pairing services found and none matched the QR name; using the first. (TODO: prompt to choose.)'
            );
            break;
        }
        return sel.service;
      },
    });

    if (controller.signal.aborted) {
      return; // user closed the panel
    }
    if (!pairing) {
      panel.setStatus('Timed out waiting for a scan. Close and try again.');
      offerManualFallback(
        'No pairing service was found. Make sure the phone and computer are on ' +
          'the same Wi-Fi and that no VPN/firewall is blocking mDNS.'
      );
      return;
    }

    // 2) Pair using the discovered host/port and our temporary password.
    panel.setStatus(`Scanned! Pairing with ${pairing.address}…`);
    const pairResult = await adb.pair(
      pairing.address,
      pairing.port,
      session.password
    );
    const pairedOk =
      pairResult.success &&
      /successfully paired/i.test(pairResult.stdout + pairResult.stderr);
    if (!pairedOk) {
      const msg = redactPassword(
        pairResult.stdout || pairResult.stderr || 'unknown error',
        session.password
      );
      panel.setStatus('Pairing failed.');
      vscode.window
        .showErrorMessage(`QR pairing failed: ${msg}`, 'Troubleshooting')
        .then((choice) => {
          if (choice === 'Troubleshooting') {
            void showTroubleshooting();
          }
        });
      return;
    }

    // 3) Discover the connect service (different port!) for the SAME device.
    panel.setStatus('Pairing successful. Connecting…');
    const connect = await discoverService({
      serviceType: ADB_CONNECT_TYPE,
      timeoutMs: 20_000,
      signal: controller.signal,
      adb,
      logger: output,
      match: (svc: DiscoveredService) => svc.address === pairing.address,
    });

    if (controller.signal.aborted) {
      return;
    }

    let connectIp = connect?.address;
    let connectPort = connect?.port;

    // 4) Fallback: pairing worked but we couldn't auto-find the connect port.
    if (connectIp === undefined || connectPort === undefined) {
      panel.setStatus('Paired, but the connect service was not found.');
      const manualPort = await promptForDebugPort();
      if (manualPort === undefined) {
        offerManualFallback(
          `Paired with ${pairing.address}, but automatic connect discovery ` +
            'failed. Use "Connect Known Device" or pair again to finish.'
        );
        return;
      }
      connectIp = pairing.address;
      connectPort = manualPort;
    }

    // 5) Connect.
    const connectResult = await adb.connect(connectIp, connectPort);
    const connectedOk =
      connectResult.success &&
      /connected to|already connected/i.test(connectResult.stdout);
    if (!connectedOk) {
      const msg = connectResult.stdout || connectResult.stderr;
      panel.setStatus('Connect failed.');
      vscode.window
        .showErrorMessage(`Paired, but connect failed: ${msg}`, 'Troubleshooting')
        .then((choice) => {
          if (choice === 'Troubleshooting') {
            void showTroubleshooting();
          }
        });
      return;
    }

    // 6) Verify + persist + optional Flutter check. Ask for an optional name.
    panel.setStatus('Connected! Verifying…');
    const name = await promptForFriendlyName(`${connectIp}:${connectPort}`);
    await verifyAndFinish(connectIp, connectPort, name);
    panel.setStatus('Connected and ready for Flutter. You can close this panel.');
  } finally {
    // Stop any in-flight discovery. The panel is intentionally left open so the
    // user can read the final status; they close it themselves (which is a
    // harmless no-op abort once the flow has finished).
    controller.abort();
  }
}

/** Show an informational fallback pointing the user at manual pairing. */
function offerManualFallback(message: string): void {
  vscode.window
    .showWarningMessage(message, 'Pair with Pairing Code', 'Troubleshooting')
    .then((choice) => {
      if (choice === 'Pair with Pairing Code') {
        void pairNewDevice();
      } else if (choice === 'Troubleshooting') {
        void showTroubleshooting();
      }
    });
}

/** Reconnect a previously saved device. */
async function connectKnownDevice(): Promise<void> {
  if (!(await ensureAdbAvailable())) {
    return;
  }

  const known = store.getAll();
  if (known.length === 0) {
    const choice = await vscode.window.showInformationMessage(
      'No known devices yet. Pair a device first.',
      'Pair New Device'
    );
    if (choice === 'Pair New Device') {
      void pairNewDevice();
    }
    return;
  }

  const picked = await vscode.window.showQuickPick(
    known.map((d) => ({
      label: d.name || `${d.ip}:${d.debugPort}`,
      description: `${d.ip}:${d.debugPort}`,
      device: d,
    })),
    {
      title: 'Connect Known Device',
      placeHolder: 'Select a device to reconnect',
    }
  );
  if (!picked) {
    return;
  }

  await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: 'Flutter Wireless ADB',
      cancellable: false,
    },
    async (progress) => {
      progress.report({ message: `Connecting to ${picked.label}…` });
      const result = await adb.connect(
        picked.device.ip,
        picked.device.debugPort
      );
      const ok =
        result.success &&
        /connected to|already connected/i.test(result.stdout);
      if (!ok) {
        const msg = result.stdout || result.stderr;
        vscode.window
          .showErrorMessage(
            `Connect failed: ${msg}. The phone may need re-pairing after a reboot or Wi-Fi change.`,
            'Pair New Device',
            'Troubleshooting'
          )
          .then((choice) => {
            if (choice === 'Pair New Device') {
              void pairNewDevice();
            } else if (choice === 'Troubleshooting') {
              void showTroubleshooting();
            }
          });
        return;
      }
      progress.report({ message: 'Verifying…' });
      await verifyAndFinish(
        picked.device.ip,
        picked.device.debugPort,
        picked.device.name
      );
    }
  );
}

/** Disconnect a currently connected wireless device. */
async function disconnectDevice(): Promise<void> {
  if (!(await ensureAdbAvailable())) {
    return;
  }
  const devices = await adb.listDevices();
  const wireless = devices.filter((d) => d.isWireless);
  if (wireless.length === 0) {
    vscode.window.showInformationMessage(
      'No wireless devices are currently connected.'
    );
    return;
  }

  const picked = await vscode.window.showQuickPick(
    wireless.map((d) => ({
      label: d.serial,
      description: d.state,
      serial: d.serial,
    })),
    { title: 'Disconnect Device', placeHolder: 'Select a device to disconnect' }
  );
  if (!picked) {
    return;
  }

  const result = await adb.disconnect(picked.serial);
  if (result.success) {
    vscode.window.showInformationMessage(`Disconnected ${picked.serial}.`);
  } else {
    vscode.window.showWarningMessage(
      `Disconnect reported: ${result.stdout || result.stderr}`
    );
  }
  await refreshStatus();
}

/** Show the raw `adb devices` list in the output channel. */
async function listDevices(): Promise<void> {
  if (!(await ensureAdbAvailable())) {
    return;
  }
  const devices = await adb.listDevices();
  output.show(true);
  output.appendLine('--- Devices ---');
  if (devices.length === 0) {
    output.appendLine('(no devices)');
  } else {
    for (const d of devices) {
      output.appendLine(
        `${d.serial}\t${d.state}${d.isWireless ? '\t(wireless)' : ''}`
      );
    }
  }
  await refreshStatus();
}

/** Open the extension's settings UI. */
async function openSettings(): Promise<void> {
  // Filter the Settings UI by our configuration prefix. This avoids coupling to
  // the publisher id and shows exactly this extension's settings.
  await vscode.commands.executeCommand(
    'workbench.action.openSettings',
    'flutterWirelessAdb'
  );
}

/** Open the Troubleshooting section of the README in a Markdown preview. */
async function showTroubleshooting(): Promise<void> {
  const items: vscode.QuickPickItem[] = [
    {
      label: '$(circle-slash) adb not found',
      detail:
        'Set flutterWirelessAdb.adbPath, or add Android SDK platform-tools to PATH (or set ANDROID_HOME).',
    },
    {
      label: '$(globe) Phone and laptop not on the same Wi-Fi',
      detail:
        'Both must be on the same network/subnet. Guest networks and AP isolation block this.',
    },
    {
      label: '$(shield) VPN or firewall blocking the connection',
      detail:
        'Disable VPN on phone/laptop; allow adb through the firewall for the chosen ports.',
    },
    {
      label: '$(watch) Pairing timeout',
      detail:
        'The pairing dialog and code expire fast. Re-open it and pair again promptly.',
    },
    {
      label: '$(arrow-swap) Wrong port (pairing vs debug)',
      detail:
        'The pairing port is on the pairing dialog; the debug port is on the main Wireless debugging screen. They differ.',
    },
    {
      label: '$(circle-slash) Device says offline',
      detail:
        'Re-toggle Wireless debugging, then re-connect. After a reboot you usually must pair again.',
    },
    {
      label: '$(circle-slash) Flutter does not show the device',
      detail:
        'Ensure adb shows it as "device". Run "flutter devices". Restart the Flutter/Dart extension if needed.',
    },
  ];
  await vscode.window.showQuickPick(items, {
    title: 'Flutter Wireless ADB — Troubleshooting',
    placeHolder: 'Common issues and fixes (see README for full details)',
  });
}

/** Quick-pick menu shown when the status bar item is clicked. */
async function showQuickMenu(): Promise<void> {
  const picks: Array<vscode.QuickPickItem & { command: string }> = [
    {
      label: '$(device-camera) Pair with QR Code',
      command: 'flutterWirelessAdb.pairWithQr',
    },
    {
      label: '$(add) Pair with Pairing Code',
      command: 'flutterWirelessAdb.pairNewDevice',
    },
    {
      label: '$(plug) Connect Known Device',
      command: 'flutterWirelessAdb.connectKnownDevice',
    },
    {
      label: '$(debug-disconnect) Disconnect Device',
      command: 'flutterWirelessAdb.disconnectDevice',
    },
    {
      label: '$(list-unordered) List ADB Devices',
      command: 'flutterWirelessAdb.listDevices',
    },
    {
      label: '$(refresh) Refresh Status',
      command: 'flutterWirelessAdb.refreshStatus',
    },
    {
      label: '$(gear) Open Settings',
      command: 'flutterWirelessAdb.openSettings',
    },
    {
      label: '$(question) Troubleshooting Help',
      command: 'flutterWirelessAdb.troubleshooting',
    },
  ];
  const picked = await vscode.window.showQuickPick(picks, {
    title: 'Flutter Wireless ADB',
    placeHolder: 'Choose an action',
  });
  if (picked) {
    await vscode.commands.executeCommand(picked.command);
  }
}

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

/**
 * Verify the device shows up in `adb devices`, optionally run `flutter devices`,
 * persist the device, and notify the user. Used by both pair and reconnect.
 */
async function verifyAndFinish(
  ip: string,
  debugPort: number,
  friendlyName?: string
): Promise<void> {
  const serial = `${ip}:${debugPort}`;
  const devices = await adb.listDevices();
  // A wireless device may surface on the connect port or a different adbd port;
  // match by IP to be robust.
  const match =
    devices.find((d) => d.serial === serial) ||
    devices.find((d) => d.ip === ip);

  if (!match || match.state !== 'device') {
    const stateInfo = match ? ` (state: ${match.state})` : '';
    vscode.window.showWarningMessage(
      `Connected, but the device is not yet ready${stateInfo}. ` +
        'Give it a moment and Refresh Status, or check Troubleshooting.'
    );
  }

  // Persist for quick reconnect (never store any pairing code/password).
  const device: KnownDevice = {
    name: friendlyName || serial,
    ip,
    debugPort,
    serial: match?.serial ?? serial,
    lastConnectedAt: new Date().toISOString(),
  };
  await store.upsert(device);

  // Optionally confirm via Flutter.
  const autoRun = vscode.workspace
    .getConfiguration('flutterWirelessAdb')
    .get<boolean>('autoRunFlutterDevices', true);
  let flutterNote = '';
  if (autoRun) {
    const flutterResult = await flutter.listDevices();
    if (flutterResult === null) {
      flutterNote = ' (Flutter CLI not found — ADB connection is still active.)';
    } else if (
      flutterResult.success &&
      flutterResult.stdout.includes(ip)
    ) {
      flutterNote = ' Flutter sees the device.';
    } else {
      flutterNote =
        ' Flutter did not list it yet — try "flutter devices" again shortly.';
    }
  }

  await refreshStatus();
  vscode.window.showInformationMessage(
    `Device ${device.name} connected and ready for Flutter.${flutterNote}`
  );
}

/**
 * Ensure adb is available; if not, show an actionable error and return false.
 */
async function ensureAdbAvailable(): Promise<boolean> {
  try {
    await adb.findAdb();
    return true;
  } catch (err) {
    if (err instanceof AdbNotFoundError) {
      setStatus('not-found', err.message);
      const choice = await vscode.window.showErrorMessage(
        err.message,
        'Open Settings',
        'Troubleshooting'
      );
      if (choice === 'Open Settings') {
        void openSettings();
      } else if (choice === 'Troubleshooting') {
        void showTroubleshooting();
      }
    } else {
      vscode.window.showErrorMessage(`Unexpected error: ${String(err)}`);
    }
    return false;
  }
}
