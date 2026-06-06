/**
 * Minimal, dependency-free test runner for the pure parsing logic.
 *
 * Runs under plain Node (no VS Code test host) because parse.ts has no
 * dependency on the vscode API. Invoked via `npm test`.
 *
 * Exits with code 1 if any assertion fails.
 */
import * as assert from 'assert';
import { parseAdbDevices, parseMdnsServices } from '../parse';

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

test('parses a single wireless device in "device" state', () => {
  const out = ['List of devices attached', '192.168.1.42:5555\tdevice'].join(
    '\n'
  );
  const devices = parseAdbDevices(out);
  assert.strictEqual(devices.length, 1);
  assert.strictEqual(devices[0].serial, '192.168.1.42:5555');
  assert.strictEqual(devices[0].state, 'device');
  assert.strictEqual(devices[0].isWireless, true);
  assert.strictEqual(devices[0].ip, '192.168.1.42');
  assert.strictEqual(devices[0].port, 5555);
});

test('ignores the header and blank lines', () => {
  const out = 'List of devices attached\n\n\n';
  assert.strictEqual(parseAdbDevices(out).length, 0);
});

test('ignores daemon chatter lines', () => {
  const out = [
    '* daemon not running; starting now at tcp:5037',
    '* daemon started successfully',
    'List of devices attached',
    '192.168.1.10:39000\tdevice',
  ].join('\n');
  const devices = parseAdbDevices(out);
  assert.strictEqual(devices.length, 1);
  assert.strictEqual(devices[0].port, 39000);
});

test('handles offline / unauthorized / unknown states', () => {
  const out = [
    'List of devices attached',
    '192.168.1.5:5555\toffline',
    'emulator-5554\tunauthorized',
    'weirdserial\tbananas',
  ].join('\n');
  const devices = parseAdbDevices(out);
  assert.strictEqual(devices.length, 3);
  assert.strictEqual(devices[0].state, 'offline');
  assert.strictEqual(devices[1].state, 'unauthorized');
  assert.strictEqual(devices[1].isWireless, false);
  assert.strictEqual(devices[2].state, 'unknown');
});

test('distinguishes USB serials from wireless ip:port serials', () => {
  const out = [
    'List of devices attached',
    'R3CN30XXXX\tdevice',
    '10.0.0.2:5555\tdevice',
  ].join('\n');
  const devices = parseAdbDevices(out);
  assert.strictEqual(devices[0].isWireless, false);
  assert.strictEqual(devices[0].ip, undefined);
  assert.strictEqual(devices[1].isWireless, true);
  assert.strictEqual(devices[1].ip, '10.0.0.2');
});

test('handles extra columns with multiple spaces', () => {
  const out =
    'List of devices attached\n' +
    '192.168.1.42:5555      device product:foo model:bar';
  const devices = parseAdbDevices(out);
  assert.strictEqual(devices.length, 1);
  assert.strictEqual(devices[0].state, 'device');
});

test('handles CRLF line endings', () => {
  const out =
    'List of devices attached\r\n192.168.1.42:5555\tdevice\r\n';
  const devices = parseAdbDevices(out);
  assert.strictEqual(devices.length, 1);
  assert.strictEqual(devices[0].serial, '192.168.1.42:5555');
});

// --- adb mdns services parsing ---

test('parses adb mdns pairing and connect services', () => {
  const out = [
    'List of discovered mdns services',
    'adb-39281749-RvBHvL\t_adb-tls-connect._tcp.\t192.168.1.42:42801',
    'ADB_WIFI_abc123\t_adb-tls-pairing._tcp.\t192.168.1.42:37155',
  ].join('\n');
  const services = parseMdnsServices(out);
  assert.strictEqual(services.length, 2);
  assert.strictEqual(services[0].serviceType, '_adb-tls-connect._tcp');
  assert.strictEqual(services[0].ip, '192.168.1.42');
  assert.strictEqual(services[0].port, 42801);
  assert.strictEqual(services[1].serviceType, '_adb-tls-pairing._tcp');
  assert.strictEqual(services[1].name, 'ADB_WIFI_abc123');
  assert.strictEqual(services[1].port, 37155);
});

test('mdns: ignores header and "No services" line', () => {
  assert.strictEqual(parseMdnsServices('List of discovered mdns services').length, 0);
  assert.strictEqual(parseMdnsServices('No mdns services found.').length, 0);
});

test('mdns: skips non-adb service types', () => {
  const out = [
    'List of discovered mdns services',
    'somePrinter\t_ipp._tcp.\t192.168.1.9:631',
    'ADB_WIFI_x\t_adb-tls-pairing._tcp.\t192.168.1.42:37155',
  ].join('\n');
  const services = parseMdnsServices(out);
  assert.strictEqual(services.length, 1);
  assert.strictEqual(services[0].name, 'ADB_WIFI_x');
});

test('mdns: normalizes trailing .local and dot on the type', () => {
  const out =
    'List of discovered mdns services\n' +
    'adb-foo\t_adb-tls-connect._tcp.local.\t10.0.0.5:5555';
  const services = parseMdnsServices(out);
  assert.strictEqual(services[0].serviceType, '_adb-tls-connect._tcp');
});

test('mdns: tolerates a record without an address', () => {
  const out =
    'List of discovered mdns services\n' + 'ADB_WIFI_y\t_adb-tls-pairing._tcp.';
  const services = parseMdnsServices(out);
  assert.strictEqual(services.length, 1);
  assert.strictEqual(services[0].ip, undefined);
  assert.strictEqual(services[0].port, undefined);
});

console.log('');
if (failures > 0) {
  console.error(`\n${failures} test(s) failed.`);
  process.exit(1);
} else {
  console.log('\nAll parsing tests passed.');
}
