import makeMdns from 'multicast-dns';
import { DiscoveredService, MdnsServiceRecord } from './types';
import { sanitizeHostPort } from './validate';

/**
 * mDNS discovery abstraction for Android Wireless Debugging.
 *
 * Two independent backends are RACED and the first usable result wins:
 *   1. multicast-dns — a pure-JS responder/browser bound to UDP 5353.
 *   2. adb's own mDNS — polled via `adb mdns services`.
 *
 * Racing both is deliberate: on some systems (notably Windows) adb already
 * binds 5353 for its own mDNS stack, which can starve multicast-dns; on others
 * adb's mDNS is disabled and multicast-dns is the only path. Whichever resolves
 * first is used.
 *
 * This module has NO dependency on the vscode API. It talks to adb through the
 * minimal {@link AdbMdnsProvider} interface and logs through {@link SimpleLogger},
 * so it is easy to substitute or test.
 */

/** Minimal logger so this module need not import vscode. */
export interface SimpleLogger {
  appendLine(message: string): void;
}

/** Minimal adb surface needed for the adb-mdns backend. */
export interface AdbMdnsProvider {
  mdnsServices(): Promise<MdnsServiceRecord[]>;
}

/** Options for a single discovery attempt. */
export interface DiscoverOptions {
  /** Service type to look for, e.g. "_adb-tls-pairing._tcp". */
  serviceType: string;
  /** Optional predicate to filter candidates (e.g. connect service by IP). */
  match?: (svc: DiscoveredService) => boolean;
  /**
   * Optional chooser applied to the full set of filtered candidates seen in one
   * adb-mdns poll (used by pairing to prefer a name match among several). When
   * omitted, the first candidate is used. Only the adb-mdns backend, which sees
   * all services at once, consults this; the multicast-dns fallback returns the
   * first event-matched service.
   */
  choose?: (candidates: DiscoveredService[]) => DiscoveredService | undefined;
  /** Overall timeout in milliseconds. */
  timeoutMs: number;
  /** Aborts discovery (e.g. when the user closes the QR panel). */
  signal: AbortSignal;
  /** adb backend for the adb-mdns path. */
  adb: AdbMdnsProvider;
  /** Logger for diagnostics. */
  logger: SimpleLogger;
}

/** Confidence in a chosen pairing service. */
export type PairingSelectionConfidence =
  | 'name-match'
  | 'sole-service'
  | 'ambiguous-first';

/** Result of {@link selectPairingService}. */
export interface PairingSelection {
  service: DiscoveredService;
  confidence: PairingSelectionConfidence;
}

/**
 * Choose among visible `_adb-tls-pairing` services. Prefers an instance name
 * that equals or contains the QR serviceName, but does NOT require it — across
 * OEMs the advertised name may differ. Selection rules:
 *   - a name match wins ('name-match');
 *   - otherwise a single visible service is accepted ('sole-service');
 *   - otherwise the first is used ('ambiguous-first') and the caller should
 *     surface the ambiguity.
 * Returns undefined when there are no candidates.
 */
export function selectPairingService(
  services: DiscoveredService[],
  preferredName: string
): PairingSelection | undefined {
  if (services.length === 0) {
    return undefined;
  }
  const named = services.find(
    (s) => s.name === preferredName || s.name.includes(preferredName)
  );
  if (named) {
    return { service: named, confidence: 'name-match' };
  }
  if (services.length === 1) {
    return { service: services[0], confidence: 'sole-service' };
  }
  return { service: services[0], confidence: 'ambiguous-first' };
}

const ADB_PAIRING_TYPE = '_adb-tls-pairing._tcp';
const ADB_CONNECT_TYPE = '_adb-tls-connect._tcp';
export { ADB_PAIRING_TYPE, ADB_CONNECT_TYPE };

/** Resolve after `ms`, or immediately if already aborted. */
function delay(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) {
      resolve();
      return;
    }
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      resolve();
    };
    signal.addEventListener('abort', onAbort, { once: true });
  });
}

/**
 * Discover a service, racing the multicast-dns and adb-mdns backends.
 * Resolves with the first match, or undefined on timeout/abort.
 */
export async function discoverService(
  opts: DiscoverOptions
): Promise<DiscoveredService | undefined> {
  // A combined abort signal: the caller's signal OR our own timeout.
  const controller = new AbortController();
  const onOuterAbort = () => controller.abort();
  opts.signal.addEventListener('abort', onOuterAbort, { once: true });
  const timeout = setTimeout(() => controller.abort(), opts.timeoutMs);

  const inner = controller.signal;

  // A promise that resolves to undefined when discovery is aborted/timed out,
  // used so a backend that only ever finds nothing doesn't hang the race.
  const abortedUndefined = new Promise<undefined>((resolve) => {
    if (inner.aborted) {
      resolve(undefined);
      return;
    }
    inner.addEventListener('abort', () => resolve(undefined), { once: true });
  });

  // Wrap each backend so that a "not found" (undefined) result does NOT win the
  // race — only a real match or the abort fallback resolves it.
  const onlyMatches = (
    p: Promise<DiscoveredService | undefined>
  ): Promise<DiscoveredService> =>
    p.then(
      (svc) =>
        svc ??
        (new Promise<DiscoveredService>(() => {
          /* never resolves; abortedUndefined handles termination */
        }))
    );

  const multicast = new MulticastDnsBackend(opts.logger);
  try {
    const result = await Promise.race<DiscoveredService | undefined>([
      onlyMatches(multicast.discover(opts.serviceType, opts.match, inner)),
      onlyMatches(
        pollAdbMdns(
          opts.adb,
          opts.serviceType,
          opts.match,
          opts.choose,
          inner,
          opts.logger
        )
      ),
      abortedUndefined,
    ]);
    if (result) {
      opts.logger.appendLine(
        `[mdns] resolved ${opts.serviceType} via ${result.source}: ` +
          `${result.address}:${result.port}`
      );
    } else {
      opts.logger.appendLine(`[mdns] no ${opts.serviceType} found before timeout`);
    }
    return result;
  } finally {
    clearTimeout(timeout);
    opts.signal.removeEventListener('abort', onOuterAbort);
    controller.abort(); // stop the losing backend
    multicast.dispose();
  }
}

/**
 * Poll `adb mdns services` until a matching service appears or the signal
 * aborts. IPv4 only.
 */
async function pollAdbMdns(
  adb: AdbMdnsProvider,
  serviceType: string,
  match: ((svc: DiscoveredService) => boolean) | undefined,
  choose: ((candidates: DiscoveredService[]) => DiscoveredService | undefined) | undefined,
  signal: AbortSignal,
  logger: SimpleLogger
): Promise<DiscoveredService | undefined> {
  while (!signal.aborted) {
    let records: MdnsServiceRecord[] = [];
    try {
      records = await adb.mdnsServices();
    } catch (err) {
      logger.appendLine(`[mdns] adb mdns services failed: ${String(err)}`);
    }
    // Build the set of valid, filtered candidates from this poll.
    const candidates: DiscoveredService[] = [];
    for (const r of records) {
      if (!r.serviceType.includes(serviceType)) {
        continue;
      }
      const clean = sanitizeHostPort(r.ip, r.port);
      if (!clean) {
        continue;
      }
      const svc: DiscoveredService = {
        name: r.name,
        serviceType,
        address: clean.host,
        port: clean.port,
        source: 'adb-mdns',
      };
      if (!match || match(svc)) {
        candidates.push(svc);
      }
    }
    if (candidates.length > 0) {
      const chosen = choose ? choose(candidates) : candidates[0];
      if (chosen) {
        return chosen;
      }
    }
    await delay(1500, signal);
  }
  return undefined;
}

/** multicast-dns browser/responder backend. */
class MulticastDnsBackend {
  private mdns: ReturnType<typeof makeMdns> | undefined;

  constructor(private readonly logger: SimpleLogger) {}

  /**
   * Browse for `<serviceType>.local` and resolve the first service whose SRV +
   * A records are known (and that satisfies `match`). IPv4 only — AAAA records
   * are ignored in this MVP.
   */
  discover(
    serviceType: string,
    match: ((svc: DiscoveredService) => boolean) | undefined,
    signal: AbortSignal
  ): Promise<DiscoveredService | undefined> {
    const fqdn = `${serviceType}.local`;
    let mdns: ReturnType<typeof makeMdns>;
    try {
      mdns = makeMdns();
    } catch (err) {
      // Binding 5353 can fail (permissions/another binder). Degrade gracefully;
      // the adb-mdns backend may still succeed.
      this.logger.appendLine(`[mdns] multicast-dns unavailable: ${String(err)}`);
      return Promise.resolve(undefined);
    }
    this.mdns = mdns;

    return new Promise<DiscoveredService | undefined>((resolve) => {
      // Accumulate records across responses; SRV and A may arrive separately.
      const srvByInstance = new Map<string, { port: number; target: string }>();
      const addrByHost = new Map<string, string>();
      let settled = false;

      const finish = (svc: DiscoveredService | undefined) => {
        if (settled) {
          return;
        }
        settled = true;
        cleanup();
        resolve(svc);
      };

      const tryMatch = () => {
        for (const [instance, srv] of srvByInstance) {
          if (!instance.endsWith(fqdn)) {
            continue;
          }
          const address = addrByHost.get(srv.target);
          if (!address) {
            continue;
          }
          const clean = sanitizeHostPort(address, srv.port);
          if (!clean) {
            continue;
          }
          const name = instance.slice(
            0,
            Math.max(0, instance.length - (fqdn.length + 1))
          );
          const svc: DiscoveredService = {
            name,
            serviceType,
            host: srv.target,
            address: clean.host,
            port: clean.port,
            source: 'multicast-dns',
          };
          if (!match || match(svc)) {
            finish(svc);
            return;
          }
        }
      };

      const onResponse = (response: {
        answers: MdnsRecord[];
        additionals: MdnsRecord[];
      }) => {
        const all = [...response.answers, ...response.additionals];
        for (const rec of all) {
          if (rec.type === 'SRV' && typeof rec.data === 'object') {
            const data = rec.data as { port: number; target: string };
            srvByInstance.set(rec.name, {
              port: data.port,
              target: data.target,
            });
          } else if (rec.type === 'A' && typeof rec.data === 'string') {
            addrByHost.set(rec.name, rec.data);
          }
          // AAAA (IPv6) records are intentionally ignored in this MVP.
        }
        tryMatch();
      };

      const query = () => {
        try {
          mdns.query(fqdn, 'PTR');
        } catch (err) {
          this.logger.appendLine(`[mdns] query failed: ${String(err)}`);
        }
      };

      const interval = setInterval(query, 2000);
      const onAbort = () => finish(undefined);

      const cleanup = () => {
        clearInterval(interval);
        mdns.removeListener('response', onResponse as never);
        signal.removeEventListener('abort', onAbort);
      };

      mdns.on('response', onResponse as never);
      signal.addEventListener('abort', onAbort, { once: true });
      query();
    });
  }

  dispose(): void {
    try {
      this.mdns?.destroy();
    } catch {
      /* ignore */
    }
    this.mdns = undefined;
  }
}

/** Minimal shape of a multicast-dns answer record we care about. */
interface MdnsRecord {
  name: string;
  type: string;
  data: unknown;
}
