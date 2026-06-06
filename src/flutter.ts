import { execFile } from 'child_process';
import * as vscode from 'vscode';
import { CommandResult } from './types';

/**
 * Optional, best-effort integration with the Flutter CLI.
 *
 * This service NEVER touches Flutter extension internals. It only shells out to
 * `flutter devices` as a confirmation step. If Flutter is missing, ADB
 * connectivity still works — every method degrades gracefully.
 */
export class FlutterService {
  constructor(private readonly output: vscode.OutputChannel) {}

  /** Platform-aware flutter executable name. */
  private get flutterExecutableName(): string {
    return process.platform === 'win32' ? 'flutter.bat' : 'flutter';
  }

  /**
   * Resolve the flutter command: the configured path if set, otherwise the
   * bare name resolved via PATH.
   */
  private resolveFlutterCommand(): string {
    const configured = vscode.workspace
      .getConfiguration('flutterWirelessAdb')
      .get<string>('flutterPath', '')
      .trim();
    return configured || this.flutterExecutableName;
  }

  /** True if `flutter --version` runs successfully. */
  public async isAvailable(): Promise<boolean> {
    try {
      const result = await this.run(['--version']);
      return result.success;
    } catch {
      return false;
    }
  }

  /**
   * Run `flutter devices`. Returns the command result, or null if Flutter is
   * unavailable. Callers should treat null as "Flutter not installed".
   */
  public async listDevices(): Promise<CommandResult | null> {
    try {
      return await this.run(['devices']);
    } catch {
      return null;
    }
  }

  /** Low-level runner around execFile (no shell). */
  private run(args: string[]): Promise<CommandResult> {
    const command = this.resolveFlutterCommand();
    this.output.appendLine(`$ ${command} ${args.join(' ')}`);

    return new Promise<CommandResult>((resolve, reject) => {
      execFile(
        command,
        args,
        { timeout: 90_000, windowsHide: true },
        (error, stdout, stderr) => {
          const out = (stdout || '').trim();
          const err = (stderr || '').trim();
          if (error && (error as NodeJS.ErrnoException).code === 'ENOENT') {
            // flutter not installed / not on PATH.
            reject(error);
            return;
          }
          if (out) {
            this.output.appendLine(out);
          }
          if (err) {
            this.output.appendLine(`[stderr] ${err}`);
          }
          resolve({
            code: error ? 1 : 0,
            stdout: out,
            stderr: err,
            success: !error,
          });
        }
      );
    });
  }
}
