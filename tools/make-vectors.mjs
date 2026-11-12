// Golden vectors for hashing recipe 1.
//
//   node tools/make-vectors.mjs           write test/vectors/recipe-1.json
//   node tools/make-vectors.mjs --check   fail if the file differs from a fresh computation
//
// Digests are computed here with node:crypto and never with the library, so the
// file is an independent statement of what the recipe produces. Within one
// recipe version this file only grows: existing cases are never edited.

import { createHash, createHmac } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const FILE = fileURLToPath(new URL('../test/vectors/recipe-1.json', import.meta.url));

const sha256 = (data) => createHash('sha256').update(data).digest('hex');
const hmac = (key, message) => createHmac('sha256', key).update(message, 'utf8').digest('hex');

// Key bytes 0x00..0x1f.
const KEY = Buffer.from(Array.from({ length: 32 }, (_, index) => index));
const keyBase64 = KEY.toString('base64');

const partValues = [
  ['darkMode', 'dark'],
  ['darkMode', 'light'],
  ['physScreen', [1080, 2400]],
  ['physScreen', [1440, 2560]],
  ['model', 'redmi note 14'],
  ['model', 'sm-a546b'],
  ['osVersion', 'android:16'],
  ['osVersion', 'ios:19'],
  ['osVersion', 'windows:15'],
  ['rendererModel', 'mali-g57 mc2'],
  ['rendererModel', 'intel(r) iris(r) xe graphics'],
  ['fonts', []],
  ['fonts', ['Arial', 'Noto Sans', 'Roboto']],
  ['localeFormat', ['Europe/Berlin', '2.1.2020, 04:04:05', '1.234.567,891', 'h23']],
  // Arabic-Indic digits and separators, as an Arabic locale formats them.
  [
    'localeFormat',
    [
      'Asia/Riyadh',
      '\u0662\u200f/\u0661\u200f/\u0662\u0660\u0662\u0660\u060c \u0666:\u0660\u0664:\u0660\u0665 \u0635',
      '\u0661\u066c\u0662\u0663\u0664\u066c\u0665\u0666\u0667\u066b\u0668\u0669\u0661',
      'h12',
    ],
  ],
  // A narrow no-break space before the day period, as recent ICU versions emit.
  ['localeFormat', ['America/New_York', '1/1/2020, 10:04:05\u202fPM', '1,234,567.891', 'h12']],
  ['localeFormat', [null, '1/2/2020, 3:04:05 AM', '1,234,567.891', null]],
  ['audioDisplay', [48000, 2, 'srgb', 'standard']],
  ['audioDisplay', [44100, 2, 'p3', 'high']],
  ['audioDisplay', [48000, 2, null, null]],
  [
    'glHardware',
    [
      16384,
      [16384, 16384],
      [1, 1],
      [1, 1024],
      30,
      16,
      16,
      8,
      8,
      8,
      8,
      24,
      0,
      [
        '127/127/23', '127/127/23', '127/127/23', '31/30/0', '31/30/0', '31/30/0',
        '127/127/23', '127/127/23', '127/127/23', '31/30/0', '31/30/0', '31/30/0',
      ],
    ],
  ],
  // Fractional limits and a missing precision format.
  [
    'glHardware',
    [
      8192,
      [8192, 8192],
      [1, 7.375],
      [0.125, 8191.875],
      15,
      16,
      4,
      8,
      8,
      8,
      8,
      24,
      8,
      [
        '127/127/23', '127/127/23', '127/127/23', '15/14/0', '15/14/0', '31/30/0',
        '15/15/10', '15/15/10', null, '15/14/0', '15/14/0', '15/14/0',
      ],
    ],
  ],
];

// Raw text in, hashed value out, for every normaliser in src/collect/values.ts.
const normalise = [
  { fn: 'rendererModel', args: ['ANGLE (ARM, Mali-G57 MC2, OpenGL ES 3.2)', false], out: 'mali-g57 mc2' },
  { fn: 'rendererModel', args: ['Mali-G57 MC2', false], out: 'mali-g57 mc2' },
  {
    fn: 'rendererModel',
    args: ['ANGLE (Intel, Intel(R) Iris(R) Xe Graphics (0x000046A8) Direct3D11 vs_5_0 ps_5_0, D3D11)', false],
    out: 'intel(r) iris(r) xe graphics',
  },
  {
    fn: 'rendererModel',
    args: ['ANGLE (Qualcomm, Adreno (TM) 619, OpenGL ES 3.2)', false],
    out: 'adreno (tm) 619',
  },
  { fn: 'rendererModel', args: ['Adreno (TM) 619', false], out: 'adreno (tm) 619' },
  { fn: 'rendererModel', args: ['  PowerVR   Rogue GE8320 ', false], out: 'powervr rogue ge8320' },
  { fn: 'rendererModel', args: ['Apple GPU', true], out: null },
  { fn: 'rendererModel', args: ['Mali-G57 MC2', true], out: null },
  { fn: 'rendererModel', args: [undefined, false], out: null },
  { fn: 'isHiddenRenderer', args: ['Apple GPU', false], out: true },
  { fn: 'isHiddenRenderer', args: [' WebKit WebGL ', false], out: true },
  { fn: 'isHiddenRenderer', args: ['Mozilla', false], out: true },
  { fn: 'isHiddenRenderer', args: ['Mali-G57 MC2', false], out: false },
  { fn: 'isHiddenRenderer', args: ['Mali-G57 MC2', true], out: true },
  { fn: 'isHiddenRenderer', args: [undefined, false], out: false },
  { fn: 'gpuClass', args: ['ANGLE (ARM, Mali-G57 MC2, OpenGL ES 3.2)', false], out: 'mobile' },
  { fn: 'gpuClass', args: ['ANGLE (NVIDIA, NVIDIA GeForce RTX 3060 Direct3D11 vs_5_0 ps_5_0, D3D11)', false], out: 'desktop' },
  { fn: 'gpuClass', args: ['NVIDIA Tegra', false], out: 'mobile' },
  { fn: 'gpuClass', args: ['ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero) (0x0000C0DE)), SwiftShader driver)', false], out: 'software' },
  { fn: 'gpuClass', args: ['Apple GPU', true], out: 'apple' },
  { fn: 'gpuClass', args: ['Mozilla', true], out: 'hidden' },
  { fn: 'gpuClass', args: ['Some Unknown Chip', false], out: 'other' },
  { fn: 'gpuClass', args: [undefined, false], out: null },
  { fn: 'physScreen', args: [384, 854, 2.8125], out: [1080, 2400] },
  { fn: 'physScreen', args: [378, 840, 2.857142857142857], out: [1080, 2400] },
  { fn: 'physScreen', args: [2560, 1440, 1], out: [1440, 2560] },
  { fn: 'physScreen', args: [0, 800, 2], out: null },
  { fn: 'physScreen', args: [360, 800, 0], out: null },
  {
    fn: 'deviceModel',
    args: ['', 'Mozilla/5.0 (Linux; Android 16; Redmi Note 14 Build/AP3A.240905.015) AppleWebKit/537.36'],
    out: 'redmi note 14',
  },
  // A locale token between the version and the model hides the model from this rule.
  {
    fn: 'deviceModel',
    args: [undefined, 'Mozilla/5.0 (Linux; U; Android 16; en-us; Redmi Note 14 Build/AP3A.240905.015) AppleWebKit/537.36'],
    out: null,
  },
  { fn: 'deviceModel', args: [' 24117RN76G ', 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36'], out: '24117rn76g' },
  { fn: 'deviceModel', args: [undefined, 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36'], out: null },
  { fn: 'deviceModel', args: [undefined, 'Mozilla/5.0 (Linux; Android 13; SM-A546B) AppleWebKit/537.36'], out: 'sm-a546b' },
  { fn: 'deviceModel', args: [undefined, 'Mozilla/5.0 (iPhone; CPU iPhone OS 19_0 like Mac OS X) AppleWebKit/605.1.15'], out: null },
  { fn: 'emulatorModel', args: ['sdk_gphone64_x86_64'], out: true },
  { fn: 'emulatorModel', args: ['generic_x86'], out: true },
  { fn: 'emulatorModel', args: ['redmi note 14'], out: false },
  { fn: 'emulatorModel', args: [null], out: null },
  { fn: 'osVersion', args: ['Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36', 'Android', '16.0.0'], out: 'android:16' },
  { fn: 'osVersion', args: ['Mozilla/5.0 (Linux; Android 13; SM-A546B) AppleWebKit/537.36', undefined, undefined], out: 'android:13' },
  { fn: 'osVersion', args: ['Mozilla/5.0 (iPhone; CPU iPhone OS 19_0 like Mac OS X) AppleWebKit/605.1.15', undefined, undefined], out: 'ios:19' },
  { fn: 'osVersion', args: ['Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36', 'Windows', '15.0.0'], out: 'windows:15' },
  { fn: 'osVersion', args: ['Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:140.0) Gecko/20100101 Firefox/140.0', undefined, undefined], out: null },
  { fn: 'osFamily', args: ['Mozilla/5.0 (Linux; Android 13; SM-A546B) AppleWebKit/537.36'], out: 'android' },
  { fn: 'osFamily', args: ['Mozilla/5.0 (iPad; CPU OS 18_0 like Mac OS X) AppleWebKit/605.1.15'], out: 'ios' },
  { fn: 'osFamily', args: ['Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15'], out: 'mac' },
  { fn: 'osFamily', args: ['Mozilla/5.0 (X11; CrOS x86_64 14541.0.0) AppleWebKit/537.36'], out: 'cros' },
  { fn: 'osFamily', args: ['Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36'], out: 'linux' },
  { fn: 'osFamily', args: [''], out: 'other' },
];

const networks = [
  ['203.0.113.77', 'net:203.0.113.0'],
  ['203.0.113.1', 'net:203.0.113.0'],
  ['10.0.0.255', 'net:10.0.0.0'],
  ['2001:db8:12:3456::1', 'net:2001:db8:12::/48'],
  ['2001:0DB8:0012:0000:0000:0000:0000:0001', 'net:2001:db8:12::/48'],
  ['::1', 'net:0:0:0::/48'],
  ['::ffff:203.0.113.77', 'net:203.0.113.0'],
  ['fe80::1%eth0', null],
  ['203.0.113', null],
  ['203.0.113.256', null],
  ['not an address', null],
  ['', null],
];

function build() {
  const pixels = Buffer.from(Uint8Array.from({ length: 160 * 160 * 4 }, (_, index) => (index * 7) % 256));
  const bufferSha256 = sha256(pixels);
  const partDigest = partValues.map(([part, value]) => {
    const json = JSON.stringify([part, value]);
    return { part, value, json, digest: sha256(Buffer.from(json, 'utf8')) };
  });
  return {
    recipe: 1,
    partDigest,
    gpuPixels: [
      {
        fill: 'byte[i] = (i * 7) % 256',
        length: pixels.length,
        bufferSha256,
        digest: sha256(Buffer.from(JSON.stringify(['gpuPixels', bufferSha256]), 'utf8')),
      },
    ],
    keyed: partDigest.slice(0, 6).map(({ part, digest }) => {
      const message = `part:${part}:${digest}`;
      return { keyBase64, part, clientDigest: digest, message, digest: hmac(KEY, message) };
    }),
    network: networks.map(([ip, message]) => ({
      keyBase64,
      ip,
      message,
      digest: message === null ? null : hmac(KEY, message),
    })),
    // JSON has no `undefined`: such arguments are stored as null and listed by position.
    normalise: normalise.map((entry) => ({
      ...entry,
      args: entry.args.map((arg) => (arg === undefined ? null : arg)),
      undefinedArgs: entry.args.flatMap((arg, index) => (arg === undefined ? [index] : [])),
    })),
  };
}

// Non-ASCII characters are written as Unicode escapes so the file stays plain ASCII.
const ascii = (text) =>
  text.replace(/[^ -~\n]/g, (char) => `\\u${char.charCodeAt(0).toString(16).padStart(4, '0')}`);
const fresh = `${ascii(JSON.stringify(build(), null, 2))}\n`;

if (process.argv.includes('--check')) {
  const stored = readFileSync(FILE, 'utf8').replace(/\r\n/g, '\n');
  if (stored !== fresh) {
    console.error('test/vectors/recipe-1.json does not match a fresh computation.');
    process.exit(1);
  }
  console.log('vectors: ok');
} else {
  writeFileSync(FILE, fresh);
  console.log(`wrote ${FILE}`);
}
