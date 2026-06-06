import * as vscode from 'vscode';
import qrcode from 'qrcode-generator';

/**
 * A small WebviewPanel that renders the pairing QR code and a live status line.
 *
 * The webview has scripts DISABLED and a strict CSP (only inline styles and
 * data: images). It is display-only — the phone scans the code. The
 * cancellation path is simply closing the panel, which fires `onCancel`.
 */
export class QrPanel {
  private readonly panel: vscode.WebviewPanel;
  private readonly qrDataUrl: string;
  private statusText = 'Waiting for your phone to scan the code…';
  private disposed = false;

  /**
   * @param payload  The QR payload string to encode.
   * @param onCancel Invoked once when the panel is closed by the user.
   */
  constructor(payload: string, private readonly onCancel: () => void) {
    this.qrDataUrl = QrPanel.renderQr(payload);
    this.panel = vscode.window.createWebviewPanel(
      'flutterWirelessAdbQr',
      'Pair with QR Code',
      vscode.ViewColumn.Active,
      { enableScripts: false, retainContextWhenHidden: true }
    );
    this.panel.onDidDispose(() => {
      if (!this.disposed) {
        this.disposed = true;
        this.onCancel();
      }
    });
    this.render();
  }

  /** Encode the payload as a GIF data URL using qrcode-generator (zero deps). */
  private static renderQr(payload: string): string {
    const qr = qrcode(0, 'M'); // type 0 = auto-size, 'M' error correction
    qr.addData(payload);
    qr.make();
    // cellSize 8 px, 4-module quiet zone — crisp and reliably scannable.
    return qr.createDataURL(8, 4);
  }

  /** Update the status line shown beneath the QR code. */
  setStatus(text: string): void {
    this.statusText = text;
    this.render();
  }

  /** Bring the panel to the foreground. */
  reveal(): void {
    if (!this.disposed) {
      this.panel.reveal();
    }
  }

  /** Programmatically close the panel (does not re-fire onCancel). */
  dispose(): void {
    this.disposed = true;
    this.panel.dispose();
  }

  private render(): void {
    if (!this.disposed) {
      this.panel.webview.html = this.html();
    }
  }

  private html(): string {
    const status = escapeHtml(this.statusText);
    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta http-equiv="Content-Security-Policy"
  content="default-src 'none'; img-src data:; style-src 'unsafe-inline';" />
<style>
  body {
    font-family: var(--vscode-font-family);
    color: var(--vscode-foreground);
    padding: 24px;
    text-align: center;
  }
  h2 { margin-top: 0; }
  .qr {
    background: #ffffff;
    display: inline-block;
    padding: 16px;
    border-radius: 10px;
    line-height: 0;
  }
  .qr img { width: 260px; height: 260px; image-rendering: pixelated; }
  ol { text-align: left; max-width: 460px; margin: 20px auto; line-height: 1.6; }
  .status {
    margin-top: 18px;
    font-weight: 600;
    font-size: 14px;
  }
  .hint { color: var(--vscode-descriptionForeground); font-size: 12px; margin-top: 8px; }
</style>
</head>
<body>
  <h2>Pair with QR Code</h2>
  <div class="qr"><img src="${this.qrDataUrl}" alt="Pairing QR code" /></div>
  <ol>
    <li>On your phone: <b>Settings → Developer options → Wireless debugging</b>.</li>
    <li>Tap <b>Pair device with QR code</b>.</li>
    <li>Point the camera at the code above.</li>
    <li>Keep the phone's pairing dialog open until pairing finishes.</li>
  </ol>
  <div class="status">${status}</div>
  <div class="hint">Close this panel to cancel. The pairing secret is temporary and never stored.</div>
</body>
</html>`;
  }
}

/** Escape a string for safe interpolation into HTML text. */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
