import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  bestMatch,
  inspectReading,
  keyedDigest,
  keyFromBase64,
  networkKey,
  PART_KEYS,
  parseReading,
  sealReading,
  type Finding,
  type PartKey,
  type Parts,
  type Reading,
  type SealedReading,
  type Traits,
} from '../src/server.ts';

const KEY = Uint8Array.from({ length: 32 }, (_, index) => index);
const OTHER_KEY = Uint8Array.from({ length: 32 }, (_, index) => 255 - index);
const digest = (seed: string) => seed.padEnd(64, '0').slice(0, 64);

function parts(tag: string, omit: readonly PartKey[] = []): Parts {
  const out: Parts = {};
  for (const [index, key] of PART_KEYS.entries()) {
    if (!omit.includes(key)) out[key] = digest(`${tag}${index.toString(16)}`);
  }
  return out;
}

const phone: Traits = {
  battery: 57,
  os: 'android',
  platform: 'Linux armv81',
  gpuClass: 'mobile',
  touch: 5,
  pointer: 'coarse',
  hover: false,
  webdriver: false,
  uaPlatform: 'android',
  emulatorModel: false,
};

const reading = (tag = 'a', traits: Partial<Traits> | null = phone): Reading => ({
  recipe: 1,
  status: 'ok',
  parts: parts(tag),
  ...(traits ? { traits } : {}),
});

const T0 = 1_800_000_000_000;

test('keyFromBase64 accepts base64 and base64url and rejects other text', () => {
  const standard = keyFromBase64('AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8=');
  assert.deepEqual([...standard], [...KEY]);
  assert.deepEqual([...keyFromBase64('-_-_')], [0xfb, 0xff, 0xbf]);
  assert.deepEqual([...keyFromBase64('+/+/')], [0xfb, 0xff, 0xbf]);
  assert.deepEqual([...keyFromBase64('AAE')], [0, 1]);
  for (const bad of ['', '   ', 'not base64!', 'A', 'AAAAA']) {
    assert.throws(() => keyFromBase64(bad), RangeError, JSON.stringify(bad));
  }
});

test('a key shorter than 16 bytes is refused', async () => {
  await assert.rejects(keyedDigest(new Uint8Array(15), 'model', digest('a')), RangeError);
  await assert.rejects(sealReading(reading(), { key: new Uint8Array(8) }), RangeError);
  await assert.doesNotReject(keyedDigest(new Uint8Array(16), 'model', digest('a')));
});

test('keyed digests depend on the key, the part and the value', async () => {
  const base = await keyedDigest(KEY, 'model', digest('a'));
  assert.match(base, /^[0-9a-f]{64}$/);
  assert.equal(await keyedDigest(KEY, 'model', digest('a')), base);
  assert.notEqual(await keyedDigest(OTHER_KEY, 'model', digest('a')), base);
  assert.notEqual(await keyedDigest(KEY, 'fonts', digest('a')), base);
  assert.notEqual(await keyedDigest(KEY, 'model', digest('b')), base);
});

test('a CryptoKey works the same as its raw bytes', async () => {
  const imported = await crypto.subtle.importKey('raw', KEY, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  assert.equal(await keyedDigest(imported, 'model', digest('a')), await keyedDigest(KEY, 'model', digest('a')));
});

test('networkKey groups addresses by /24 and /48', async () => {
  const same = async (a: string, b: string) => (await networkKey(KEY, a)) === (await networkKey(KEY, b));
  assert.ok(await same('203.0.113.1', '203.0.113.254'));
  assert.ok(!(await same('203.0.113.1', '203.0.114.1')));
  assert.ok(await same('2001:db8:12:1::1', '2001:db8:12:ffff::2'));
  assert.ok(!(await same('2001:db8:12::1', '2001:db8:13::1')));
  assert.ok(await same('::ffff:203.0.113.9', '203.0.113.200'));
  assert.ok(await same(' 203.0.113.1 ', '203.0.113.1'));
  for (const bad of ['', 'localhost', '1.2.3', '1.2.3.4.5', '256.1.1.1', 'fe80::1%eth0', ':::', '1::2::3', '1.2.3.4::', '1.2.3.4::5', '1:2:3:4:5:6:7', 'x'.repeat(200)]) {
    assert.equal(await networkKey(KEY, bad), null, JSON.stringify(bad));
  }
});

test('sealReading keys every part and derives the context', async () => {
  const sealed = await sealReading(reading(), { key: KEY, ip: '203.0.113.7', at: T0 });
  assert.equal(sealed.recipe, 1);
  assert.equal(sealed.at, T0);
  assert.equal(sealed.battery, 57);
  assert.equal(sealed.network, await networkKey(KEY, '203.0.113.7'));
  assert.deepEqual(Object.keys(sealed.parts).sort(), [...PART_KEYS].sort());
  for (const key of PART_KEYS) {
    assert.equal(sealed.parts[key], await keyedDigest(KEY, key, parts('a')[key] as string));
  }
  assert.deepEqual(Object.keys(sealed).sort(), ['at', 'battery', 'network', 'parts', 'recipe']);
});

test('sealReading leaves out what is absent', async () => {
  const partial: Reading = { recipe: 1, status: 'ok', parts: parts('a', ['model']), traits: { battery: null } };
  const sealed = await sealReading(partial, { key: KEY, ip: 'nonsense' });
  assert.equal(sealed.parts.model, undefined);
  assert.equal(Object.keys(sealed.parts).length, 9);
  assert.equal(sealed.battery, null);
  assert.equal(sealed.network, null);
  assert.ok(Math.abs(sealed.at - Date.now()) < 5000);
  assert.equal((await sealReading(reading('a', null), { key: KEY })).battery, null);
});

test('sealReading and inspectReading refuse input that is not a reading', async () => {
  const invalid: unknown[] = [
    null,
    { recipe: 1 },
    { recipe: 1, status: 'ok' },
    { recipe: 1, status: 'ok', parts: { fonts: 'not-a-digest' } },
    { recipe: 1, status: 'ok', parts: {}, traits: { battery: 140 } },
    { recipe: 1, status: 'ok', parts: {}, traits: { platform: { toString: 1 } } },
    { recipe: 1, status: 'ok', parts: {}, traits: { touch: '5' } },
  ];
  for (const input of invalid) {
    await assert.rejects(sealReading(input as Reading, { key: KEY }), TypeError, JSON.stringify(input));
    assert.throws(() => inspectReading(input as Reading), TypeError, JSON.stringify(input));
  }
});

test('a private or loopback address gives no network unless allowed', async () => {
  const hidden = ['127.0.0.1', '10.1.2.3', '172.16.0.9', '172.31.255.1', '192.168.1.20', '169.254.3.4', '100.64.0.1', '0.0.0.0', '::1', '::', 'fe80::1', 'fd12:3456::1', '::ffff:10.0.0.1'];
  for (const ip of hidden) {
    assert.equal((await sealReading(reading(), { key: KEY, ip })).network, null, ip);
  }
  const shown = ['203.0.113.7', '172.32.0.1', '100.128.0.1', '2001:db8::1', '::ffff:203.0.113.7'];
  for (const ip of shown) {
    assert.match((await sealReading(reading(), { key: KEY, ip })).network ?? '', /^[0-9a-f]{64}$/, ip);
  }
  const allowed = await sealReading(reading(), { key: KEY, ip: '10.1.2.3', allowPrivateNetworks: true });
  assert.equal(allowed.network, await networkKey(KEY, '10.1.2.3'));
});

test('a key id travels with the reading and separates key generations', async () => {
  const before = await sealReading(reading(), { key: KEY, keyId: 'k1', ip: '203.0.113.7', at: T0 });
  const after = await sealReading(reading(), { key: OTHER_KEY, keyId: 'k2', ip: '203.0.113.7', at: T0 });
  const unlabelled = await sealReading(reading(), { key: KEY, ip: '203.0.113.7', at: T0 });
  assert.equal(before.keyId, 'k1');
  assert.ok(!('keyId' in unlabelled));
  assert.equal(bestMatch(after, [before]).best, null);
  assert.equal(bestMatch(before, [unlabelled]).best, null);
  assert.equal(bestMatch(before, [{ ...before }]).best?.result.score, 100);
});

test('an imported key must be HMAC-SHA256, long enough and usable for signing', async () => {
  const make = (bytes: number, hash: string, usages: KeyUsage[]) =>
    crypto.subtle.importKey('raw', new Uint8Array(bytes).fill(7), { name: 'HMAC', hash }, false, usages);
  const d = digest('a');
  await assert.rejects(keyedDigest(await make(1, 'SHA-256', ['sign']), 'model', d), RangeError);
  await assert.rejects(keyedDigest(await make(32, 'SHA-1', ['sign']), 'model', d), RangeError);
  await assert.rejects(keyedDigest(await make(32, 'SHA-256', ['verify']), 'model', d), RangeError);
  for (const notKey of ['secret', null, undefined, {}, new ArrayBuffer(32)]) {
    await assert.rejects(keyedDigest(notKey as never, 'model', d), TypeError);
  }
  await assert.rejects(sealReading({ recipe: 1, status: 'ok', parts: {} }, { key: new Uint8Array(4) }), RangeError);
});

test('keyedDigest refuses unknown parts and malformed digests', async () => {
  await assert.rejects(keyedDigest(KEY, 'model:x' as never, digest('a')), RangeError);
  await assert.rejects(keyedDigest(KEY, 'model', 'x:y'), RangeError);
  await assert.rejects(keyedDigest(KEY, 'model', digest('a').toUpperCase()), RangeError);
});

test('keyFromBase64 refuses values that are not text', () => {
  for (const bad of [undefined, null, 5, 'A'.repeat(2000)]) {
    assert.throws(() => keyFromBase64(bad as never), RangeError);
  }
});

test('free-text traits are reduced to safe characters', () => {
  const parsed = parseReading({
    recipe: 1,
    status: 'ok',
    parts: {},
    traits: { platform: '<img src=x onerror=1>', uaPlatform: 'Chrome OS\n\u202e"' },
  });
  assert.deepEqual(parsed?.traits, { platform: 'img srcx onerror1', uaPlatform: 'chrome os' });
});

test('a digest repeated across parts is reported', () => {
  const same = digest('a');
  const forged: Reading = { recipe: 1, status: 'ok', parts: { model: same, fonts: same }, traits: phone };
  assert.deepEqual(inspectReading(forged).findings, ['repeatedDigest']);
});

test('a reading without parts is thin whatever it claims to be', () => {
  const iphone: Traits = { ...phone, os: 'ios', platform: 'iPhone', gpuClass: 'apple', uaPlatform: null };
  const inspection = inspectReading({ recipe: 1, status: 'ok', parts: {}, traits: iphone });
  assert.equal(inspection.appleMobile, true);
  assert.equal(inspection.thin, true);
});

test('an undefined trait counts as unknown', () => {
  const traits = { os: 'ios', uaPlatform: undefined } as Partial<Traits>;
  assert.deepEqual(inspectReading({ recipe: 1, status: 'ok', parts: parts('a'), traits }).findings, []);
});

test('two full batteries are not agreement', () => {
  const current = sealed('a', { battery: 100, at: T0 });
  const other = sealed('a', { battery: 100, at: T0 - 60_000 });
  assert.equal(bestMatch(current, [other]).best?.result.score, 72);
  const lower = sealed('a', { battery: 99, at: T0 - 60_000 });
  assert.equal(bestMatch(current, [lower]).best?.result.score, 80);
});

test('bestMatch tolerates damaged candidates and unusable times', () => {
  const current = sealed('a');
  const broken = [null, undefined, { ...sealed('a'), at: Number.NaN }, { ...sealed('a'), at: T0 - 5 }] as unknown as SealedReading[];
  const { best } = bestMatch(current, broken);
  assert.equal(best?.index, 3);
  assert.equal(bestMatch(current, [sealed('a')], null).best?.result.score, 72);
});

test('parseReading accepts what collect produces', () => {
  const input = { ...reading(), timings: { total: 40 } };
  const parsed = parseReading(JSON.parse(JSON.stringify(input)));
  assert.deepEqual(parsed, reading());
  assert.deepEqual(parseReading({ recipe: 1, status: 'unsupported', parts: {} }), {
    recipe: 1,
    status: 'unsupported',
    parts: {},
  });
  assert.deepEqual(parseReading({ recipe: 1, status: 'ok', parts: {}, traits: { battery: null, extra: 1 } })?.traits, {
    battery: null,
  });
  assert.equal(
    parseReading({ recipe: 1, status: 'ok', parts: {}, traits: { platform: 'p'.repeat(100) } })?.traits?.platform,
    'p'.repeat(32),
  );
});

test('parseReading rejects anything else', () => {
  const good = reading();
  const hostile: unknown[] = [
    null,
    undefined,
    42,
    'reading',
    [],
    {},
    { ...good, recipe: 2 },
    { ...good, recipe: '1' },
    { ...good, status: 'fine' },
    { ...good, parts: null },
    { ...good, parts: [] },
    { ...good, parts: { ...good.parts, extra: digest('a') } },
    { ...good, parts: { ...good.parts, model: digest('a').toUpperCase() } },
    { ...good, parts: { ...good.parts, model: digest('a').slice(1) } },
    { ...good, parts: { ...good.parts, model: 7 } },
    { ...good, parts: { ...good.parts, model: null } },
    { ...good, traits: 'none' },
    { ...good, traits: { ...phone, battery: 101 } },
    { ...good, traits: { ...phone, battery: 50.5 } },
    { ...good, traits: { ...phone, os: 'plan9' } },
    { ...good, traits: { ...phone, touch: -1 } },
    { ...good, traits: { ...phone, pointer: 'laser' } },
    { ...good, traits: { ...phone, hover: 'yes' } },
    { ...good, traits: { ...phone, platform: 5 } },
    JSON.parse('{"recipe":1,"status":"ok","parts":{"__proto__":{"model":"x"}}}'),
    new Proxy(
      {},
      {
        get() {
          throw new Error('trap');
        },
        has() {
          throw new Error('trap');
        },
        ownKeys() {
          throw new Error('trap');
        },
        getOwnPropertyDescriptor() {
          throw new Error('trap');
        },
      },
    ),
  ];
  for (const input of hostile) assert.equal(parseReading(input), null);
});

test('parseReading ignores inherited fields', () => {
  const inherited = Object.create({ recipe: 1, status: 'ok', parts: {} }) as unknown;
  assert.equal(parseReading(inherited), null);
});

function sealed(tag: string, overrides: Partial<SealedReading> = {}): SealedReading {
  return { recipe: 1, parts: parts(tag), battery: null, network: null, at: T0, ...overrides };
}

test('bestMatch picks the closest candidate', () => {
  const current = sealed('a', { network: 'n1' });
  const candidates = [
    sealed('b', { network: 'n2', at: T0 - 1000 }),
    sealed('a', { network: 'n2', at: T0 - 2000 }),
    sealed('a', { network: 'n1', at: T0 - 3000 }),
  ];
  const { best, networkCrowd, networkCounted } = bestMatch(current, candidates);
  assert.equal(best?.index, 2);
  assert.equal(best?.candidate, candidates[2]);
  assert.equal(best?.result.score, 92);
  assert.equal(networkCrowd, 1);
  assert.equal(networkCounted, true);
});

test('bestMatch returns null without comparable candidates', () => {
  assert.deepEqual(bestMatch(sealed('a'), []), { best: null, networkCrowd: 0, networkCounted: true });
  const future = { ...sealed('a'), recipe: 2 } as unknown as SealedReading;
  assert.equal(bestMatch(sealed('a'), [future]).best, null);
  assert.equal(bestMatch({ ...sealed('a'), recipe: 2 } as unknown as SealedReading, [sealed('a')]).best, null);
});

test('a crowded network is not evidence', () => {
  const current = sealed('a', { network: 'busy' });
  const strangers = ['b', 'c', 'd'].map((tag) => sealed(tag, { network: 'busy' }));
  const twin = sealed('a', { network: 'busy' });
  const quiet = bestMatch(current, [...strangers.slice(0, 2), twin]);
  assert.equal(quiet.networkCrowd, 3);
  assert.equal(quiet.networkCounted, true);
  assert.equal(quiet.best?.result.score, 92);
  const crowded = bestMatch(current, [...strangers, twin]);
  assert.equal(crowded.networkCrowd, 4);
  assert.equal(crowded.networkCounted, false);
  assert.equal(crowded.best?.result.score, 72);
  assert.equal(crowded.best?.result.corroborated, false);
  assert.equal(bestMatch(current, [...strangers, twin], { limits: { networkCrowdMax: 4 } }).best?.result.score, 92);
});

test('battery links two readings across networks', () => {
  const current = sealed('a', { network: 'wifi', battery: 57, at: T0 });
  const before = sealed('a', { network: 'mobile', battery: 58, at: T0 - 10 * 60_000 });
  assert.equal(bestMatch(current, [before]).best?.result.score, 80);
  const stale = sealed('a', { network: 'mobile', battery: 58, at: T0 - 20 * 60_000 });
  assert.equal(bestMatch(current, [stale]).best?.result.score, 72);
});

test('ties go to the corroborated, then the more recent, then the earlier candidate', () => {
  const current = sealed('a', { network: 'n1', battery: 50 });
  const plain = sealed('a', { at: T0 - 1000 });
  const recent = sealed('a', { at: T0 - 10 });
  assert.equal(bestMatch(current, [plain, recent]).best?.index, 1);
  assert.equal(bestMatch(current, [recent, plain]).best?.index, 0);
  assert.equal(bestMatch(current, [plain, { ...plain }]).best?.index, 0);
  // Same score of 20: one through the network, one through device parts.
  const onlyNetwork = sealed('b', { network: 'n1', at: T0 - 5000 });
  const onlyParts = sealed('c', { at: T0 - 10 });
  for (const key of ['gpuPixels', 'glHardware', 'physScreen', 'model', 'osVersion'] as const) {
    onlyParts.parts[key] = current.parts[key] as string;
  }
  const options = { weights: { parts: { gpuPixels: 4, glHardware: 4, physScreen: 4, model: 4, osVersion: 4 }, penalties: { gpuPixels: 0, physScreen: 0, model: 0 } } };
  const tie = bestMatch(current, [onlyParts, onlyNetwork], options);
  assert.equal(tie.best?.result.score, 20);
  assert.equal(tie.best?.index, 1);
});

test('bestMatch validates its options', () => {
  assert.throws(() => bestMatch(sealed('a'), [], { limits: { networkCrowdMax: -1 } }), RangeError);
});

test('an ordinary phone raises no findings', () => {
  assert.deepEqual(inspectReading(reading()), { findings: [], missing: [], thin: false, appleMobile: false });
});

test('each contradiction is reported by name', () => {
  const cases: [Partial<Traits>, Finding[]][] = [
    [{ webdriver: true }, ['automation']],
    [{ emulatorModel: true }, ['emulatorModel']],
    [{ platform: 'Linux x86_64' }, ['androidX86Platform']],
    [{ platform: 'Win32' }, ['androidX86Platform']],
    [{ gpuClass: 'desktop' }, ['androidDesktopGpu']],
    [{ gpuClass: 'software' }, ['androidDesktopGpu']],
    [{ touch: 0 }, ['androidNoTouch']],
    [{ pointer: 'fine', hover: true }, ['androidFinePointer']],
    [{ uaPlatform: 'windows' }, ['platformHintMismatch']],
    [{ os: 'ios', platform: 'iPhone', gpuClass: 'apple', uaPlatform: 'android' }, ['platformHintMismatch', 'appleMobileMismatch']],
    [{ os: 'ios', platform: 'iPhone', gpuClass: 'apple', uaPlatform: null, touch: 0 }, ['appleMobileMismatch']],
    [{ os: 'ios', platform: 'iPhone', gpuClass: 'mobile', uaPlatform: null }, ['appleMobileMismatch']],
    [{ os: 'mac', platform: 'MacIntel', gpuClass: 'desktop', uaPlatform: null, touch: 5 }, ['appleMobileMismatch']],
    [{ webdriver: true, emulatorModel: true, touch: 0 }, ['automation', 'emulatorModel', 'androidNoTouch']],
  ];
  for (const [traits, findings] of cases) {
    assert.deepEqual(inspectReading(reading('a', { ...phone, ...traits })).findings, findings, JSON.stringify(traits));
  }
});

test('honest variations are not findings', () => {
  const honest: Partial<Traits>[] = [
    { pointer: 'fine', hover: false },
    { pointer: 'coarse', hover: true },
    // Desktop-site mode on a phone: a desktop-looking user agent with an Android platform hint.
    { os: 'linux', uaPlatform: 'android' },
    { os: 'windows', platform: 'Win32', gpuClass: 'desktop', touch: 0, pointer: 'fine', hover: true, uaPlatform: 'windows' },
    { os: 'mac', platform: 'MacIntel', gpuClass: 'apple', touch: 0, pointer: 'fine', hover: true, uaPlatform: null },
    { os: 'ios', platform: 'iPad', gpuClass: 'hidden', uaPlatform: null, pointer: 'fine' },
  ];
  for (const traits of honest) {
    assert.deepEqual(inspectReading(reading('a', { ...phone, ...traits })).findings, [], JSON.stringify(traits));
  }
});

test('a missing trait never fires a rule', () => {
  const unknown: Partial<Traits>[] = [
    { webdriver: null },
    { emulatorModel: null },
    { platform: null },
    { gpuClass: null },
    { touch: null },
    { pointer: null, hover: true },
    { pointer: 'fine', hover: null },
    { uaPlatform: null },
    { os: null, touch: 0, gpuClass: 'desktop', platform: 'Win32', uaPlatform: 'windows' },
  ];
  for (const traits of unknown) {
    assert.deepEqual(inspectReading(reading('a', { ...phone, ...traits })).findings, [], JSON.stringify(traits));
  }
  assert.deepEqual(inspectReading(reading('a', null)).findings, []);
  assert.deepEqual(inspectReading(reading('a', {})).findings, []);
});

test('appleMobile needs every sign to agree', () => {
  const iphone: Traits = { ...phone, os: 'ios', platform: 'iPhone', gpuClass: 'apple', uaPlatform: null, touch: 5, pointer: 'coarse' };
  assert.equal(inspectReading(reading('a', iphone)).appleMobile, true);
  assert.equal(inspectReading(reading('a', { ...iphone, os: 'mac', platform: 'MacIntel' })).appleMobile, true);
  assert.equal(inspectReading(reading('a', { ...iphone, os: 'mac', platform: 'MacIntel', touch: 0 })).appleMobile, false);
  assert.equal(inspectReading(reading('a', { ...iphone, pointer: 'fine' })).appleMobile, false);
  assert.equal(inspectReading(reading('a', { ...iphone, gpuClass: 'hidden' })).appleMobile, false);
  assert.equal(inspectReading(reading('a', { ...iphone, touch: null })).appleMobile, false);
  assert.equal(inspectReading(reading('a', null)).appleMobile, false);
});

test('thin readings are flagged, except on Apple mobile devices', () => {
  const thin: Reading = { ...reading(), parts: parts('a', ['gpuPixels', 'glHardware']) };
  const inspection = inspectReading(thin);
  assert.deepEqual(inspection.missing, ['gpuPixels', 'glHardware']);
  assert.equal(inspection.thin, true);
  assert.equal(inspectReading({ ...reading(), parts: parts('a', ['gpuPixels', 'model', 'fonts']) }).thin, false);
  const iphone: Traits = { ...phone, os: 'ios', platform: 'iPhone', gpuClass: 'apple', uaPlatform: null };
  assert.equal(inspectReading({ ...thin, traits: iphone }).thin, false);
  assert.equal(inspectReading({ recipe: 1, status: 'unsupported', parts: {} }).thin, true);
});
