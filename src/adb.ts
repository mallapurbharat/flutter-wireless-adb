import { execFile } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as vscode from 'vscode';
import { AdbDevice, CommandResult, MdnsServiceRecord } from './types';
import { parseAdbDevices, parseMdnsServices } from './parse';

/** Options controlling a single adb command invocation. */
interface RunOptions {
  /** Transform args before logging (e.g. to redact secrets). */
  redactArgs?: (args: string[]) => string[];
  /** Extra environment variables merged over process.env. */
  env?: NodeJS.ProcessEnv;
  /** Override the default 60s timeout. */
  timeoutMs?: number;
}

/**
 * Thrown when no usable adb executable can be located.
 */
export class AdbNotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AdbNotFoundError';
  }
}

/**
 * Wraps interaction with the Android Debug Bridge (adb) executable.
 *
 * All commands run via execFile with an argument array — never via a shell
 * string — to avoid command injection from user-supplied IPs/ports/codes.
 */
export class AdbService {
  /** Cached path to the resolved adb executable. */
  private cachedAdbPath: string | undefined;

  constructor(private readonly output: vscode.OutputChannel) {}

  /** The executable filename, platform-aware. */
  private get adbExecutableName(): string {
    return process.platform === 'win32' ? 'adb.exe' : 'adb';
  }

  /**
   * Clears the cached adb path. Call when the user changes the adbPath setting.
   */
  public invalidateCache(): void {
    this.cachedAdbPath = undefined;
  }

  /**
   * Locate the adb executable using, in priority order:
   *   1. the `flutterWirelessAdb.adbPath` setting
   *   2. ANDROID_HOME/platform-tools/adb
   *   3. ANDROID_SDK_ROOT/platform-tools/adb
   *   4. the system PATH
   *
   * The resolved path is cached. Throws AdbNotFoundError if nothing works.
   */
  public async findAdb(): Promise<string> {
    if (this.cachedAdbPath) {
      return this.cachedAdbPath;
    }

    const candidates: string[] = [];

    // 1. Explicit user setting.
    const configured = vscode.workspace
      .getConfiguration('flutterWirelessAdb')
      .get<string>('adbPath', '')
      .trim();
    if (configured) {
      candidates.push(configured);
    }

    // 2 & 3. SDK environment variables.
    for (const envVar of ['ANDROID_HOME', 'ANDROID_SDK_ROOT']) {
      const root = process.env[envVar];
      if (root) {
        candidates.push(
          path.join(root, 'platform-tools', this.adbExecutableName)
        );
      }
    }

    // Try each concrete file candidate.
    for (const candidate of candidates) {
      if (await this.isExecutableFile(candidate)) {
        this.output.appendLine(`Found adb: ${candidate}`);
        this.cachedAdbPath = candidate;
        return candidate;
      }
    }

    // 4. Fall back to PATH: rely on the OS resolving the bare name. We verify
    // by actually invoking `adb version`.
    const bareName = this.adbExecutableName;
    if (await this.canRun(bareName)) {
      this.output.appendLine(`Found adb on PATH: ${bareName}`);
      this.cachedAdbPath = bareName;
      return bareName;
    }

    throw new AdbNotFoundError(
      'Could not locate adb. Set "flutterWirelessAdb.adbPath", or add Android ' +
        'SDK platform-tools to your PATH (or set ANDROID_HOME / ANDROID_SDK_ROOT).'
    );
  }

  /** True if the given path exists and is a file we can execute. */
  private async isExecutableFile(filePath: string): Promise<boolean> {
    try {
      const stat = await fs.promises.stat(filePath);
      if (!stat.isFile()) {
        return false;
      }
      // On POSIX, also require the execute bit; on Windows, existence is enough.
      if (process.platform !== 'win32') {
        await fs.promises.access(filePath, fs.constants.X_OK);
      }
      return true;
    } catch {
      return false;
    }
  }

  /** True if `<command> version` runs successfully (used for PATH probing). */
  private async canRun(command: string): Promise<boolean> {
    try {
      const result = await this.run(command, ['version']);
      return result.success;
    } catch {
      return false;
    }
  }

  /**
   * Run an arbitrary adb invocation and return the captured result.
   * `redactArgs` lets callers hide sensitive args (e.g. pairing codes) in logs.
   */
  private runAdb(
    args: string[],
    opts?: RunOptions
  ): Promise<CommandResult> {
    return this.findAdb().then((adbPath) => this.run(adbPath, args, opts));
  }

  /**
   * Low-level command runner around execFile. Never uses a shell.
   */
  private run(
    command: string,
    args: string[],
    opts?: RunOptions
  ): Promise<CommandResult> {
    const loggedArgs = opts?.redactArgs ? opts.redactArgs(args) : args;
    this.output.appendLine(`$ ${command} ${loggedArgs.join(' ')}`);

    return new Promise<CommandResult>((resolve) => {
      execFile(
        command,
        args,
        {
          timeout: opts?.timeoutMs ?? 60_000,
          windowsHide: true,
          env: opts?.env ? { ...process.env, ...opts.env } : undefined,
        },
        (error, stdout, stderr) => {
          const out = (stdout || '').trim();
          const err = (stderr || '').trim();
          // execFile sets error.code to the exit code (number) or a string
          // (e.g. 'ENOENT'). Normalize to number | null.
          let code: number | null = 0;
          if (error) {
            code =
              typeof (error as NodeJS.ErrnoException).code === 'number'
                ? ((error as unknown as { code: number }).code)
                : null;
          }
          const result: CommandResult = {
            code,
            stdout: out,
            stderr: err,
            success: !error,
          };
          if (out) {
            this.output.appendLine(out);
          }
          if (err) {
            this.output.appendLine(`[stderr] ${err}`);
          }
          resolve(result);
        }
      );
    });
  }

  /** Return adb's version string, or throw if adb cannot be found. */
  public async getVersion(): Promise<string> {
    const result = await this.runAdb(['version']);
    return result.stdout || result.stderr;
  }

  /**
   * Pair with a device using Android 11+ Wireless Debugging.
   * The pairing port is DIFFERENT from the debug/connect port.
   *
   * The pairing code is passed as an argument array element (no shell) and is
   * redacted from the output channel.
   */
  public async pair(
    ip: string,
    port: number,
    code: string
  ): Promise<CommandResult> {
    return this.runAdb(['pair', `${ip}:${port}`, code], {
      // Redact the pairing code/password (last arg) from logs.
      redactArgs: (args) => args.slice(0, -1).concat('******'),
    });
  }

  /**
   * Connect to a device on its debug/connect port.
   * adb reports failures on stdout (exit code 0), so callers should inspect
   * the returned stdout for "failed"/"cannot".
   */
  public async connect(ip: string, port: number): Promise<CommandResult> {
    return this.runAdb(['connect', `${ip}:${port}`]);
  }

  /** Disconnect a specific serial (e.g. "192.168.1.42:5555"). */
  public async disconnect(serial: string): Promise<CommandResult> {
    return this.runAdb(['disconnect', serial]);
  }

  /** Parse `adb devices` and return the list of devices. */
  public async listDevices(): Promise<AdbDevice[]> {
    const result = await this.runAdb(['devices']);
    return AdbService.parseDevices(result.stdout);
  }

  /**
   * Check whether adb's mDNS backend is available (`adb mdns check`).
   * Returns true only when the daemon reports it is usable.
   */
  public async mdnsCheck(): Promise<boolean> {
    try {
      const result = await this.runAdb(['mdns', 'check'], {
        env: this.mdnsEnv(),
        timeoutMs: 15_000,
      });
      const text = `${result.stdout}\n${result.stderr}`;
      // Success prints e.g. "mdns daemon version [10453.0]".
      // Failure prints "ERROR: ..." or "mdns daemon unavailable".
      if (!result.success) {
        return false;
      }
      return !/unavailable|disabled|error/i.test(text);
    } catch {
      return false;
    }
  }

  /** Discover services via `adb mdns services`, parsed into records. */
  public async mdnsServices(): Promise<MdnsServiceRecord[]> {
    const result = await this.runAdb(['mdns', 'services'], {
      env: this.mdnsEnv(),
      timeoutMs: 15_000,
    });
    return parseMdnsServices(result.stdout);
  }

  /**
   * Environment for mDNS subcommands. The openscreen backend (bundled in
   * modern platform-tools) is the one that supports `adb mdns services`;
   * requesting it improves reliability across adb builds without harming
   * setups where it is already the default.
   */
  private mdnsEnv(): NodeJS.ProcessEnv {
    return {
      ADB_MDNS_OPENSCREEN: process.env.ADB_MDNS_OPENSCREEN ?? '1',
    };
  }

  /**
   * Parse the textual output of `adb devices` robustly. Delegates to the
   * vscode-free {@link parseAdbDevices} so the logic stays unit-testable.
   */
  public static parseDevices(raw: string): AdbDevice[] {
    return parseAdbDevices(raw);
  }

  /** Directory of the resolved adb, useful for diagnostics. */
  public async getAdbDir(): Promise<string> {
    const adbPath = await this.findAdb();
    // If it's a bare name resolved from PATH, there's no meaningful directory.
    return path.dirname(adbPath) === '.' ? os.homedir() : path.dirname(adbPath);
  }
}
