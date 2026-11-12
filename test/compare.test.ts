import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  compare,
  DEFAULT_BANDS,
  DEFAULT_LIMITS,
  DEFAULT_WEIGHTS,
  PART_KEYS,
  pairContext,
  resolveScoring,
  type CompareOptions,
  type PartKey,
  type Parts,
} from '../src/score.ts';

const digest = (seed: string) => seed.padEnd(64, '0').slice(0, 64);

function parts(tag: string, omit: readonly PartKey[] = []): Parts {
  const out: Parts = {};
  for (const [index, key] of PART_KEYS.entries()) {
    if (!omit.includes(key)) out[key] = digest(`${tag}${index.toString(16)}`);
  }
  return out;
}

const withDifferent = (base: Parts, keys: readonly PartKey[]): Parts => {
  const out = { ...base };
  for (const key of keys) out[key] = digest(`ff${key.length.toString(16)}${key.charCodeAt(0).toString(16)}`);
  return out;
};

const A = parts('a');
const network = { sameNetwork: true };
const battery = { batteryDelta: 1, minutesApart: 5 };
const sum = (reasons: { points: number }[]) => reasons.reduce((total, reason) => total + reason.points, 0);

test('default weights total 100: 60 hardware, 12 settings, 20 network, 8 battery', () => {
  const part = (keys: readonly PartKey[]) => keys.reduce((total, key) => total + DEFAULT_WEIGHTS.parts[key], 0);
  assert.equal(part(PART_KEYS.slice(0, 6)), 60);
  assert.equal(part(PART_KEYS.slice(6)), 12);
  assert.equal(DEFAULT_WEIGHTS.network, 20);
  assert.equal(DEFAULT_WEIGHTS.battery, 8);
});

test('identical parts without context stop below the top band', () => {
  const result = compare(A, { ...A });
  assert.equal(result.score, 72);
  assert.equal(result.band, 'similar');
  assert.equal(result.corroborated, false);
  assert.equal(result.hardware, 60);
  assert.equal(result.settings, 12);
  assert.equal(result.coverage, 1);
});

test('worked scores', () => {
  const cases: [string, Parts, Parts, CompareOptions, number, string][] = [
    ['all equal + network', A, A, { context: network }, 92, 'strong'],
    ['all equal + battery', A, A, { context: battery }, 80, 'strong'],
    ['all equal + both', A, A, { context: { ...network, ...battery } }, 100, 'strong'],
    [
      'cross-browser, hardware and fonts equal, network',
      A,
      withDifferent(A, ['darkMode', 'localeFormat', 'audioDisplay']),
      { mode: 'crossBrowser', context: network },
      82,
      'strong',
    ],
    [
      'cross-browser, model missing on one side, network',
      A,
      parts('a', ['model']),
      { mode: 'crossBrowser', context: network },
      63,
      'similar',
    ],
    ['GPU image differs, network', A, withDifferent(A, ['gpuPixels']), { context: network }, 74, 'similar'],
    [
      'GPU image differs, network and battery',
      A,
      withDifferent(A, ['gpuPixels']),
      { context: { ...network, ...battery } },
      82,
      'strong',
    ],
    [
      'model differs, network and battery',
      A,
      withDifferent(A, ['model']),
      { context: { ...network, ...battery } },
      75,
      'similar',
    ],
    ['nothing in common', A, parts('b'), {}, 0, 'none'],
    ['nothing in common, same network', A, parts('b'), { context: network }, 20, 'none'],
  ];
  for (const [name, left, right, options, score, band] of cases) {
    const result = compare(left, right, options);
    assert.equal(result.score, score, name);
    assert.equal(result.band, band, name);
  }
});

test('the reasons always add up to the score', () => {
  const variants: [Parts, Parts, CompareOptions][] = [
    [A, A, {}],
    [A, A, { context: { ...network, ...battery } }],
    [A, parts('b'), {}],
    [A, parts('b'), { context: network }],
    [A, withDifferent(A, ['gpuPixels', 'physScreen', 'model']), { context: network }],
    [A, parts('a', ['model', 'rendererModel']), { mode: 'crossBrowser' }],
    [A, A, { limits: { uncorroboratedCap: 50 } }],
    [A, A, { weights: { network: 100, battery: 100 }, context: { ...network, ...battery } }],
    [{}, {}, {}],
  ];
  for (const [left, right, options] of variants) {
    const result = compare(left, right, options);
    assert.equal(sum(result.reasons), result.score);
    assert.ok(Number.isInteger(result.score) && result.score >= 0 && result.score <= 100);
  }
});

test('compare is symmetric', () => {
  const B = withDifferent(parts('a', ['fonts']), ['gpuPixels', 'osVersion']);
  for (const options of [{}, { context: network }, { mode: 'crossBrowser' as const }]) {
    assert.deepEqual(compare(A, B, options), compare(B, A, options));
  }
});

test('a missing part changes nothing, on either side', () => {
  const without = parts('a', ['model']);
  const result = compare(A, without);
  assert.equal(result.parts.model, 'missing');
  assert.equal(result.score, 72 - 19);
  assert.equal(result.coverage, Math.round(((72 - 19) / 72) * 100) / 100);
  assert.deepEqual(compare(without, A), result);
  assert.equal(compare(without, without).score, 72 - 19);
  assert.equal(compare(A, { ...A, model: '' }).parts.model, 'missing');
});

test('mismatches on stable parts subtract, others do not', () => {
  const stable = compare(A, withDifferent(A, ['gpuPixels', 'physScreen', 'model']));
  assert.equal(stable.score, 72 - 8 - 9 - 19 - 10 - 6 - 6);
  assert.deepEqual(
    stable.reasons.filter((reason) => reason.points < 0).map((reason) => reason.code),
    ['mismatch.gpuPixels', 'mismatch.physScreen', 'mismatch.model'],
  );
  const loose = compare(A, withDifferent(A, ['osVersion', 'fonts']));
  assert.equal(loose.score, 72 - 8 - 2);
  assert.equal(loose.parts.osVersion, 'mismatch');
});

test('penalties never push the score below zero', () => {
  const result = compare(A, parts('b'), {
    weights: { penalties: { gpuPixels: 50, model: 50, physScreen: 0 } },
  });
  assert.equal(result.score, 0);
  assert.deepEqual(result.reasons.at(-1), { code: 'floor.zero', points: 100 });
});

test('without context the score never passes the cap', () => {
  const result = compare(A, A, { limits: { uncorroboratedCap: 60 } });
  assert.equal(result.score, 60);
  assert.deepEqual(result.reasons.at(-1), { code: 'cap.uncorroborated', points: -12 });
  const lifted = compare(A, A, { limits: { uncorroboratedCap: 60 }, context: network });
  assert.equal(lifted.score, 92);
});

test('the score stops at 100', () => {
  const result = compare(A, A, { weights: { network: 60 }, context: network });
  assert.equal(result.score, 100);
  assert.deepEqual(result.reasons.at(-1), { code: 'cap.max', points: -32 });
});

test('battery counts only when close, recent and backed by hardware', () => {
  const score = (context: CompareOptions['context'], other: Parts = A) => compare(A, other, { context }).score;
  assert.equal(score({ batteryDelta: 2, minutesApart: 15 }), 80);
  assert.equal(score({ batteryDelta: 3, minutesApart: 5 }), 72);
  assert.equal(score({ batteryDelta: 1, minutesApart: 16 }), 72);
  assert.equal(score({ batteryDelta: null, minutesApart: 5 }), 72);
  assert.equal(score({ batteryDelta: 1, minutesApart: null }), 72);
  assert.equal(score({ batteryDelta: 1 }), 72);
  // Hardware 60 - 19 - 9 = 32 matched points, below the 40 required.
  const weakHardware = parts('a', ['model', 'physScreen']);
  assert.equal(compare(A, weakHardware, { context: battery }).corroborated, false);
});

test('cross-browser mode ignores the three browser-dependent parts', () => {
  const other = withDifferent(A, ['darkMode', 'localeFormat', 'audioDisplay']);
  const result = compare(A, other, { mode: 'crossBrowser' });
  assert.equal(result.score, 62);
  assert.equal(result.coverage, 1);
  assert.equal(result.parts.darkMode, 'ignored');
  assert.equal(result.parts.localeFormat, 'ignored');
  assert.equal(result.parts.audioDisplay, 'ignored');
  assert.equal(result.parts.fonts, 'match');
  assert.equal(compare(A, other).score, 62);
});

test('weights can be overridden one at a time', () => {
  const result = compare(A, A, { weights: { parts: { model: 0, gpuPixels: 20 } } });
  assert.equal(result.score, 72 - 19 - 8 + 20);
  assert.ok(!result.reasons.some((reason) => reason.code === 'match.model'));
  assert.equal(DEFAULT_WEIGHTS.parts.model, 19, 'defaults are not mutated');
});

test('bands follow the thresholds', () => {
  assert.equal(compare(A, parts('a', ['model', 'rendererModel', 'localeFormat', 'osVersion'])).band, 'none');
  assert.equal(compare(A, parts('a', ['model', 'rendererModel'])).band, 'weak');
  assert.equal(compare(A, A, { bands: { strong: 101 }, context: { ...network, ...battery } }).band, 'similar');
});

test('invalid configurations throw RangeError', () => {
  const invalid: CompareOptions[] = [
    { weights: { parts: { model: -1 } } },
    { weights: { parts: { model: 1.5 } } },
    { weights: { parts: { model: Number.NaN } } },
    { weights: { penalties: { model: 101 } } },
    { weights: { network: 101 } },
    { weights: { battery: -1 } },
    { limits: { batteryTolerance: 101 } },
    { limits: { batteryWindowMinutes: 0 } },
    { limits: { batteryMinHardware: -1 } },
    { limits: { networkCrowdMax: -1 } },
    { limits: { uncorroboratedCap: 80 } },
    { limits: { uncorroboratedCap: 101 } },
    { bands: { weak: 0 } },
    { bands: { weak: 60 } },
    { bands: { similar: 80 } },
    { bands: { strong: 102 } },
  ];
  for (const options of invalid) {
    assert.throws(() => compare(A, A, options), RangeError, JSON.stringify(options));
  }
});

test('resolveScoring returns the defaults untouched', () => {
  const { weights, limits, bands } = resolveScoring();
  assert.deepEqual(weights, DEFAULT_WEIGHTS);
  assert.deepEqual(limits, DEFAULT_LIMITS);
  assert.deepEqual(bands, DEFAULT_BANDS);
  assert.notEqual(weights.parts, DEFAULT_WEIGHTS.parts);
});

test('pairContext reduces two contexts to the pair facts', () => {
  const now = 1_800_000_000_000;
  assert.deepEqual(
    pairContext({ network: 'n1', battery: 57, at: now }, { network: 'n1', battery: 55, at: now - 90_000 }),
    { sameNetwork: true, batteryDelta: 2, minutesApart: 1.5 },
  );
  assert.deepEqual(pairContext({ network: 'n1' }, { network: 'n2' }), {
    sameNetwork: false,
    batteryDelta: null,
    minutesApart: null,
  });
  assert.equal(pairContext({ network: null }, { network: null }).sameNetwork, false);
  assert.equal(pairContext({ network: '' }, { network: '' }).sameNetwork, false);
  assert.equal(pairContext({ at: 5 }, { at: 60_005 }).minutesApart, 1);
});
