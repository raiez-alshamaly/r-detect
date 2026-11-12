import assert from 'node:assert/strict';
import { test } from 'node:test';

test('the three entry points import outside a browser', async () => {
  const browser = await import('../src/index.ts');
  const score = await import('../src/score.ts');
  const server = await import('../src/server.ts');
  assert.equal(typeof browser.collect, 'function');
  assert.equal(typeof score.compare, 'function');
  assert.equal(typeof server.sealReading, 'function');
  assert.equal(browser.RECIPE, 1);
  assert.equal(browser.PART_KEYS.length, 10);
  assert.equal(browser.TRAIT_KEYS.length, 10);
});

test('the server entry re-exports the scorer', async () => {
  const score = await import('../src/score.ts');
  const server = await import('../src/server.ts');
  for (const name of Object.keys(score)) assert.ok(name in server, name);
});

test('collect resolves "unsupported" outside a browser', async () => {
  const { collect } = await import('../src/index.ts');
  assert.deepEqual(await collect({ traits: false }), { recipe: 1, status: 'unsupported', parts: {} });
  const reading = await collect({ traits: ['battery', 'os'], timings: true });
  assert.equal(reading.status, 'unsupported');
  assert.deepEqual(reading.parts, {});
  assert.deepEqual(reading.traits, { battery: null, os: null });
  assert.deepEqual(reading.timings, { total: 0 });
});

test('collect ignores unknown part and trait names', async () => {
  const { collect } = await import('../src/index.ts');
  const reading = await collect({
    parts: ['model', 'nonsense' as never],
    traits: ['touch', 'nonsense' as never],
  });
  assert.deepEqual(reading.traits, { touch: null });
});
