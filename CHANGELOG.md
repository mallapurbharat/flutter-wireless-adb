# Changelog

All notable changes to the **Flutter Wireless ADB** extension are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.2.0] - 2026-06-06

### Added

- **QR code pairing** (`Pair New Device with QR Code`): VS Code shows a QR code
  the phone scans from Android's *Wireless debugging → Pair device with QR code*.
  The extension then discovers the device over mDNS and pairs + connects
  automatically — no typing the pairing code or pairing port.
- mDNS discovery that **races** adb's own mDNS (`adb mdns services`) with a
  pure-JS `multicast-dns` browser, taking whichever resolves first and disposing
  the loser. The `_adb-tls-pairing` and (separate) `_adb-tls-connect` services
  are discovered independently; the connect service is matched by IP.
- Pairing-service selection that prefers the QR service name but accepts the sole
  visible pairing service when OEM naming differs, with confidence logging.
- Known devices now also store the **adb serial** and **last-connected time**.

### Changed

- Status bar quick menu now lists **Pair with QR Code** and **Pair with Pairing
  Code** separately.
- `.vscodeignore` no longer excludes `node_modules/**` — required so the
  unbundled VSIX ships its runtime dependencies (`qrcode-generator`,
  `multicast-dns`, `dns-packet`).

### Security

- QR passwords are generated with `crypto.randomBytes`, are hex-only
  (payload-safe), used once, never stored, and redacted from logs.

## [0.1.0] - 2026-06-06

### Added

- Initial MVP release.
- `Pair New Device` flow for Android 11+ Wireless Debugging (separate pairing
  and debug ports made explicit in the UI).
- `Connect Known Device` to reconnect a saved device without re-pairing.
- `Disconnect Device`, `List ADB Devices`, `Refresh Status`, `Open Settings`,
  and `Troubleshooting Help` commands.
- Status bar item with Connected / Disconnected / Checking / Not Found states
  and a click-through quick menu.
- Auto-detection of `adb` from the `adbPath` setting, `ANDROID_HOME`,
  `ANDROID_SDK_ROOT`, and the system `PATH`.
- Optional `flutter devices` confirmation after connecting.
- Persistent known-device store (IP, debug port, friendly name) — pairing codes
  are never stored.
- Output channel logging with the pairing code redacted.
- Unit tests for `adb devices` output parsing.

### Security

- No telemetry, no cloud service, no root required.
- All external commands run via `execFile` with argument arrays (no shell),
  preventing command injection.
