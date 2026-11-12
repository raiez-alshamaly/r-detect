import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

import { partDigest, sha256Hex } from '../src/collect/hash.ts';
import * as values from '../src/collect/values.ts';
import { keyFromBase64 } from '../src/server/key.ts';
import { networkKey } from '../src/server/network.ts';
import { keyedDigest } from '../src/server/seal.ts';
import type { PartKey } from '../src/shared/types.ts';

interface Vectors {
  recipe: number;
  partDigest: { part: string; value: unknown; json: string; digest: string }[];
  gpuPixels: { length: number; bufferSha256: string; digest: string }[];
  keyed: { keyBase64: string; part: PartKey; clientDigest: string; digest: string }[];
  network: { keyBase64: string; ip: string; digest: string | null }[];
  normalise: { fn: string; args: unknown[]; undefinedArgs: number[]; out: unknown }[];
}

const vectors = JSON.parse(
  readFileSync(new URL('./vectors/recipe-1.json', import.meta.url), 'utf8'),
) as Vectors;

test('the vectors are for recipe 1', () => {
  assert.equal(vectors.recipe, 1);
});

test('part digests match the recipe', async () => {
  for (const { part, value, json, digest } of vectors.partDigest) {
    assert.equal(JSON.stringify([part, value]), json, `serialisation of ${part}`);
    assert.equal(await partDigest(part, value), digest, json);
  }
});

test('the GPU image is hashed twice: the buffer, then the part', async () => {
  for (const { length, bufferSha256, digest } of vectors.gpuPixels) {
    const pixels = Uint8Array.from({ length }, (_, index) => (index * 7) % 256);
    const inner = await sha256Hex(pixels);
    assert.equal(inner, bufferSha256);
    assert.equal(await partDigest('gpuPixels', inner), digest);
  }
});

test('keyed digests match the recipe', async () => {
  for (const { keyBase64, part, clientDigest, digest } of vectors.keyed) {
    assert.equal(await keyedDigest(keyFromBase64(keyBase64), part, clientDigest), digest);
  }
});

test('network keys match the recipe', async () => {
  for (const { keyBase64, ip, digest } of vectors.network) {
    assert.equal(await networkKey(keyFromBase64(keyBase64), ip), digest, JSON.stringify(ip));
  }
});

test('normalisers produce the recorded values', () => {
  const functions = values as unknown as Record<string, (...args: unknown[]) => unknown>;
  for (const { fn, args, undefinedArgs, out } of vectors.normalise) {
    const call = args.map((arg, index) => (undefinedArgs.includes(index) ? undefined : arg));
    const run = functions[fn];
    assert.ok(run, `unknown normaliser ${fn}`);
    assert.deepEqual(run(...call), out, `${fn}(${JSON.stringify(args)})`);
  }
});
