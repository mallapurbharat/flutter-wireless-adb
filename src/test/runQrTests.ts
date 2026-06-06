/**
 * Dependency-light tests for QR payload construction, secret redaction, and
 * pairing-service selection logic. Runs under plain Node via `npm test`.
 *
 * Note: importing ../mdns pulls in multicast-dns, but that module only opens a
 * socket when makeMdns() is called — selectPairingService is pure, so importing
 * is safe and binds no ports.
 */
import * as assert from 'assert';
import {
  buildQrPayload,
  createQrSession,
  redactPassword,
  redactQrPayload,
} from '../qrPairing';
import { selectPairingService } from '../mdns';
import { DiscoveredService } from '../types';

let failures = 0;

function test(name: string, fn: () => void): void {
  try {
    fn();
    console.log(`  ok - ${name}`);
  } catch (err) {
    failures++;
    console.error(`  FAIL - ${name}`);
    console.error(`    ${(err as Error).message}`);
  }
}

// --- payload construction ---

test('buildQrPayload produces the AOSP WIFI:T:ADB format', () => {
  assert.strictEqual(
    buildQrPayload('ADB_WIFI_ab12', 'deadbeef'),
    'WIFI:T:ADB;S:ADB_WIFI_ab12;P:deadbeef;;'
  );
});

test('buildQrPayload rejects delimiter characters', () => {
  assert.throws(() => buildQrPayload('bad;name', 'pw'));
  assert.throws(() => buildQrPayload('name', 'pa:ss'));
});

// --- session charset safety ---

test('createQrSession generates payload-safe, delimiter-free values', () => {
  for (let i = 0; i < 50; i++) {
    const s = createQrSession();
    assert.match(s.serviceName, /^ADB_WIFI_[0-9a-f]+$/, 'serviceName charset');
    assert.match(s.password, /^[0-9a-f]+$/, 'password charset');
    // No QR-breaking characters anywhere.
    assert.ok(!/[;:,\\"'\s]/.test(s.serviceName));
    assert.ok(!/[;:,\\"'\s]/.test(s.password));
    assert.strictEqual(
      s.payload,
      `WIFI:T:ADB;S:${s.serviceName};P:${s.password};;`
    );
  }
});

test('createQrSession passwords differ between sessions', () => {
  assert.notStrictEqual(createQrSession().password, createQrSession().password);
});

// --- redaction ---

test('redactPassword hides every occurrence of the secret', () => {
  const pw = 'deadbeef';
  const text = `paired using ${pw}; retry with ${pw}`;
  const out = redactPassword(text, pw);
  assert.ok(!out.includes(pw));
  assert.strictEqual(out, 'paired using ******; retry with ******');
});

test('redactQrPayload masks only the P: field', () => {
  const out = redactQrPayload('WIFI:T:ADB;S:ADB_WIFI_ab12;P:deadbeef;;');
  assert.strictEqual(out, 'WIFI:T:ADB;S:ADB_WIFI_ab12;P:<redacted>;;');
  assert.ok(out.includes('ADB_WIFI_ab12'));
  assert.ok(!out.includes('deadbeef'));
});

// --- pairing-service selection ---

function svc(name: string, address = '192.168.1.42', port = 37155): DiscoveredService {
  return { name, serviceType: '_adb-tls-pairing._tcp', address, port, source: 'adb-mdns' };
}

test('selection: exact serviceName match wins', () => {
  const chosen = selectPairingService(
    [svc('adb-xyz'), svc('ADB_WIFI_target')],
    'ADB_WIFI_target'
  );
  assert.ok(chosen);
  assert.strictEqual(chosen!.confidence, 'name-match');
  assert.strictEqual(chosen!.service.name, 'ADB_WIFI_target');
});

test('selection: a single non-matching service is accepted', () => {
  const chosen = selectPairingService([svc('adb-oem-guid')], 'ADB_WIFI_target');
  assert.ok(chosen);
  assert.strictEqual(chosen!.confidence, 'sole-service');
});

test('selection: multiple non-matching services fall back to first (ambiguous)', () => {
  const chosen = selectPairingService(
    [svc('adb-a'), svc('adb-b')],
    'ADB_WIFI_target'
  );
  assert.ok(chosen);
  assert.strictEqual(chosen!.confidence, 'ambiguous-first');
  assert.strictEqual(chosen!.service.name, 'adb-a');
});

test('selection: no candidates returns undefined', () => {
  assert.strictEqual(selectPairingService([], 'ADB_WIFI_target'), undefined);
});

console.log('');
if (failures > 0) {
  console.error(`\n${failures} QR test(s) failed.`);
  process.exit(1);
} else {
  console.log('\nAll QR tests passed.');
}
