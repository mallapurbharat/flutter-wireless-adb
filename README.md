# Flutter Wireless ADB

Connect VS Code to an Android phone over **Wireless Debugging** (Android 11+) and
run/debug your Flutter apps **without a USB cable**.

This is a small, open-source, local-only extension. It drives the standard
Android `adb` tool for you — pairing, connecting, reconnecting — and surfaces the
device status in the VS Code status bar. Once connected, Flutter sees the phone
as a normal device.

> **Warning**
> This extension is experimental and provided as-is. It was generated with
> assistance from Claude Code and may contain defects. Use at your own risk.

---

## What it does

- Pairs with an Android 11+ phone using **Wireless Debugging** — either by
  **scanning a QR code** or by typing a **pairing code**.
- Connects to the phone over Wi-Fi (`adb connect`).
- Lets you **reconnect later without pairing again**.
- Shows live connection status in the status bar with a click-through menu.
- Optionally runs `flutter devices` to confirm Flutter recognizes the phone.
- Stores only the **non-sensitive** reconnect details (IP, debug port, friendly
  name). **Pairing codes are never stored.**

It does **not** require Android Studio, root, the cloud, or any telemetry.

---

## Prerequisites

- **VS Code** 1.85 or newer.
- **Android SDK Platform Tools** (provides `adb`). The extension finds `adb` via,
  in order:
  1. the `flutterWirelessAdb.adbPath` setting,
  2. `ANDROID_HOME/platform-tools/adb`,
  3. `ANDROID_SDK_ROOT/platform-tools/adb`,
  4. the system `PATH`.
- An **Android 11+** phone with Developer Options enabled.
- Phone and computer on the **same Wi-Fi network/subnet**.
- *(Optional)* The **Flutter SDK** on your `PATH` (or set
  `flutterWirelessAdb.flutterPath`) for the optional `flutter devices` check.
  Flutter is not required for ADB connectivity.

---

## How to enable Wireless Debugging on Android

1. Open **Settings → About phone** and tap **Build number** 7 times to unlock
   **Developer options**.
2. Go to **Settings → System → Developer options**.
3. Turn on **Wireless debugging**.
4. Make sure the phone is on the **same Wi-Fi** as your computer.
5. Tap **Wireless debugging** to open its screen. You'll see:
   - the device **IP address and port** (this port is the **debug/connect
     port**), and
   - a **Pair device with pairing code** option.
6. Tap **Pair device with pairing code**. A dialog shows:
   - a **6-digit pairing code**, and
   - an **IP address and port** — this port is the **pairing port**.

> Keep this dialog open while you pair — the code and pairing port expire quickly.

---

## Pairing port vs. debug port — they are different!

This trips everyone up:

| | Where you see it | What it's for | Example |
|---|---|---|---|
| **Pairing port** | On the *"Pair device with pairing code"* dialog | One-time `adb pair` | `37123` |
| **Debug/connect port** | On the main *"Wireless debugging"* screen | `adb connect` (every time) | `5555` / `39000` |

The **pairing port changes** each time you open the pairing dialog. The **debug
port** is shown on the main Wireless debugging screen and is what you reconnect
to later. Using the wrong one is the #1 cause of failures.

---

## Pair with QR Code (recommended)

QR pairing avoids typing the pairing code **and** the pairing port — VS Code
shows a QR code, your phone scans it, and the extension finds, pairs, and
connects the device automatically over mDNS.

**Requirements:** Android 11+, and the phone and computer on the **same Wi-Fi**.

1. Open the **Command Palette** (`Ctrl/Cmd + Shift + P`).
2. Run **`Flutter Wireless ADB: Pair New Device with QR Code`** (or click the
   status bar item → **Pair with QR Code**).
3. A panel opens showing a QR code.
4. On your phone: **Settings → Developer options → Wireless debugging → Pair
   device with QR code**.
5. Scan the QR code shown in VS Code. **Keep the phone's pairing dialog open**
   until pairing finishes.
6. The extension automatically:
   - discovers the `_adb-tls-pairing._tcp` service and runs `adb pair`,
   - discovers the separate `_adb-tls-connect._tcp` service and runs
     `adb connect`,
   - verifies with `adb devices` and optionally `flutter devices`,
   - asks for an optional friendly name and saves the device.
7. **Close the panel to cancel** at any time — this aborts discovery.

The QR contains a **temporary** service name and password
(`WIFI:T:ADB;S:<name>;P:<password>;;`). The password is generated fresh per
session, used once, **never stored**, and **redacted from logs**.

> Discovery races two backends: adb's own mDNS (`adb mdns services`) and a
> pure-JS `multicast-dns` browser. Whichever finds the device first wins, which
> keeps QR pairing working even when one path is blocked.

---

## How to pair (with a pairing code)

1. Open the **Command Palette** (`Ctrl/Cmd + Shift + P`).
2. Run **`Flutter Wireless ADB: Pair New Device`**.
3. Enter, when prompted:
   - **IP address** (from the Wireless debugging screen),
   - **Pairing port** (from the *pairing code* dialog),
   - **Pairing code** (6 digits, used once, never stored),
   - **Debug/connect port** (from the main Wireless debugging screen),
   - an optional **friendly name** (e.g. "Pixel 7").
4. The extension runs `adb pair ip:pairingPort <code>`, then
   `adb connect ip:debugPort`, then verifies the device with `adb devices`.
5. On success you'll see **"Device connected and ready for Flutter."** and the
   status bar shows **`ADB: Connected`**.
6. Run your Flutter app normally — the phone appears as a target device.

You can also click the status bar item to open a quick menu with all actions.

---

## How to reconnect later

After the first pairing, the device's IP, debug port, and name are saved.

1. Open the Command Palette and run
   **`Flutter Wireless ADB: Connect Known Device`** (or click the status bar →
   *Connect Known Device*).
2. Pick the device. The extension runs `adb connect ip:debugPort` and verifies.

No pairing is needed for reconnects **unless** the phone rebooted, toggled
Wireless debugging off/on, or changed networks — in which case pair again.

---

## Commands

All commands are available from the Command Palette under **Flutter Wireless ADB**:

- **Pair New Device with QR Code** — scan-to-pair flow (recommended).
- **Pair New Device** — manual pairing-code flow.
- **Connect Known Device** — reconnect a saved device.
- **Disconnect Device** — disconnect a wireless device.
- **List ADB Devices** — show `adb devices` in the output channel.
- **Refresh Status** — re-check the connection now.
- **Open Settings** — jump to this extension's settings.
- **Troubleshooting Help** — common issues and fixes.

---

## Settings

| Setting | Default | Description |
|---|---|---|
| `flutterWirelessAdb.adbPath` | `""` | Absolute path to `adb`. Empty = auto-detect. |
| `flutterWirelessAdb.flutterPath` | `""` | Absolute path to `flutter`. Empty = auto-detect. |
| `flutterWirelessAdb.autoRunFlutterDevices` | `true` | Run `flutter devices` after connecting. |
| `flutterWirelessAdb.knownDevices` | `[]` | Saved devices (managed by the extension). |
| `flutterWirelessAdb.statusRefreshIntervalSeconds` | `30` | Background status refresh interval. `0` disables it. |

---

## Troubleshooting

**`adb` not found**
Install Android SDK Platform Tools. Then either set
`flutterWirelessAdb.adbPath` to the full path of `adb`/`adb.exe`, add
`platform-tools` to your `PATH`, or set `ANDROID_HOME` / `ANDROID_SDK_ROOT`.
Restart VS Code after changing environment variables.

**Phone and laptop not on the same Wi-Fi**
Both devices must be on the same network and subnet. Guest networks, "client
isolation"/"AP isolation", and separate 2.4/5 GHz SSIDs can block the
connection. Put both on the same regular Wi-Fi.

**VPN or firewall issue**
A VPN on the phone or computer often routes traffic away from the local subnet —
disable it while connecting. On the computer, allow `adb` through the firewall
for the chosen ports.

**Pairing timeout**
The pairing code and pairing port expire fast. If pairing fails, close and
re-open *Pair device with pairing code* on the phone to get a fresh code/port,
then try again promptly.

**Wrong port**
Make sure you used the **pairing port** (from the pairing dialog) for pairing,
and the **debug port** (from the main Wireless debugging screen) for connecting.
See the table above.

**Device says `offline`**
Toggle Wireless debugging off and on, then reconnect. After a reboot the phone
usually must be **paired again** (the debug port also commonly changes).

**Flutter does not show the device**
First confirm `adb devices` lists it as `device` (run
*List ADB Devices*). Then run `flutter devices`. If Flutter still doesn't show
it, restart the Dart/Flutter extension or reload the window. The Flutter check is
optional — ADB connectivity works regardless.

### QR pairing specific

**Installed extension fails with "Cannot find module 'multicast-dns'"**
This means the VSIX was built without its runtime dependencies. Do **not** add
`node_modules/**` to `.vscodeignore` for this (unbundled) extension — `vsce`
already prunes devDependencies and ships only production deps. Rebuild with the
packaging checklist below and reinstall.

**mDNS blocked by firewall / VPN / router**
QR pairing relies on mDNS (UDP port 5353). A VPN on either device, a strict
firewall, or a router that blocks multicast will prevent discovery. Disable the
VPN, allow `adb`/VS Code through the firewall, and use a normal home network.

**Windows firewall prompt on first run**
The first time discovery binds the mDNS socket, Windows may prompt to allow
access. Allow it on private networks, or QR discovery will silently find nothing.

**Corporate / guest Wi-Fi client isolation**
Many corporate and guest networks isolate clients so they can't see each other.
mDNS and `adb connect` both fail there. Use a phone hotspot or a home network.

**QR scan succeeds but VS Code keeps waiting**
The pairing service is only advertised while the phone's *Pair device with QR
code* dialog is open — keep it open. If it still times out, mDNS is likely
blocked (see above); fall back to **Pair New Device** (manual pairing code).

**Pairing succeeded but connect failed**
QR pairing pairs and connects in two steps using *different* ports. If pairing
worked but the connect service wasn't found, the extension says so and lets you
enter the debug port manually (or use **Connect Known Device**). It will **not**
falsely report that pairing failed.

---

## Security & privacy

- **Pairing codes and QR passwords are never stored.** They're used once for
  `adb pair`, passed as a process argument (never through a shell), and
  **redacted** from the output channel logs (the QR payload is logged as
  `…;P:<redacted>;;`).
- The QR service name and password are generated per session with
  `crypto.randomBytes` and are **hex-only**, so the QR payload never needs
  escaping and can't be corrupted.
- Only non-sensitive reconnect details are saved: device **IP**, **debug port**,
  **adb serial**, **friendly name**, and **last-connected time**.
- **No telemetry.** The extension collects and sends nothing.
- **No cloud service**, **no root**, **no Android Studio** required — everything
  runs locally against your own `adb`.
- All commands run via `child_process.execFile` with **argument arrays** (no
  shell string concatenation), preventing command injection from the IP/port/code
  you enter.
- Open source under the MIT license — read the code in `src/`.

---

## Development

```bash
npm install
npm run compile     # type-check and build to out/
npm test            # run the parsing + QR/redaction/selection tests
npm run watch       # rebuild on change
```

Press **F5** in VS Code to launch an **Extension Development Host** with the
extension loaded.

### Packaging verification checklist

This is an **unbundled** extension with runtime dependencies
(`qrcode-generator`, `multicast-dns`, `dns-packet`). F5 reads `node_modules`
directly, so a packaging mistake only shows up *after install*. Always verify
the packaged VSIX, not just F5:

```bash
npm install
npm run compile
npx @vscode/vsce package          # produces flutter-wireless-adb-<ver>.vsix
code --install-extension flutter-wireless-adb-<ver>.vsix
```

Then in VS Code:

1. Reload the window.
2. Run **Pair New Device with QR Code**.
3. Confirm the extension activates with **no** "Cannot find module …" error.

To confirm the runtime modules are inside the VSIX, run `vsce ls --tree` and
check that `node_modules/multicast-dns`, `node_modules/qrcode-generator`, and
`node_modules/dns-packet` are present. `.vscodeignore` must **not** exclude
`node_modules/**` (vsce prunes devDependencies automatically).

---

## License

The source code in this repository is licensed under the Apache License 2.0.

The documentation, screenshots, diagrams, website copy, and other non-code content are licensed under the Creative Commons Attribution 4.0 International License.

The project name, logo, and branding are not licensed for use in modified versions except for truthful attribution and nominative reference, such as:

"Based on Flutter Wireless ADB by Bharat Mallapur."

Forks and derivative works must not imply endorsement by the original authors.

See [LICENSE](LICENSE) (code), [LICENSE-DOCS.md](LICENSE-DOCS.md) (docs),
[NOTICE](NOTICE), and [TRADEMARKS.md](TRADEMARKS.md) for details.

---

## Attribution

Flutter Wireless ADB was originally created by Bharat Mallapur.

Forks and derivative works are welcome. If you redistribute modified versions, please preserve the original attribution notices and clearly mark your changes.

---

## Disclaimer

This extension is provided as-is, without warranty of any kind.

Use it at your own risk. The authors and contributors are not responsible for any defects, data loss, device issues, debugging failures, security issues, development interruptions, or any other direct or indirect damages arising from the use or inability to use this extension.

This project was substantially generated and/or assisted using AI coding tools, including Claude Code. The code has not been professionally audited. Users should review, test, and validate the extension before relying on it in any personal, educational, or production workflow.

This extension interacts with Android Debug Bridge (ADB), Android Wireless Debugging, VS Code, Flutter, and the local network environment. These systems may behave differently across devices, operating systems, Android versions, firewall settings, routers, and OEM implementations.

By installing or using this extension, you accept full responsibility for any risks associated with its use.
