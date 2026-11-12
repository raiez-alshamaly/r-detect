// Runs collect() against a minimal stand-in for a browser. It checks the
// control flow: what is read, what is skipped, timeouts and cleanup. The real
// reads are checked in real browsers with the harness page.

import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';

import { collect } from '../src/index.ts';

interface Env {
  calls: string[];
  body: { children: Set<unknown> };
}

const GLOBALS = ['window', 'document', 'navigator', 'screen', 'matchMedia', 'requestAnimationFrame'] as const;
const saved = new Map<string, PropertyDescriptor | undefined>();

function define(name: string, value: unknown): void {
  if (!saved.has(name)) saved.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
  Object.defineProperty(globalThis, name, { value, configurable: true, writable: true });
}

afterEach(() => {
  for (const [name, descriptor] of saved) {
    if (descriptor) Object.defineProperty(globalThis, name, descriptor);
    else delete (globalThis as Record<string, unknown>)[name];
  }
  saved.clear();
});

function install(overrides: { frames?: boolean; hidden?: boolean; stallFonts?: boolean } = {}): Env {
  const calls: string[] = [];
  const body = { children: new Set<unknown>() };

  const element = (tag: string) => {
    const node = {
      tag,
      style: { cssText: '', fontFamily: '' },
      textContent: '',
      width: 0,
      height: 0,
      children: new Set<unknown>(),
      get offsetWidth() {
        if (overrides.stallFonts) calls.push('measure');
        return node.style.fontFamily.includes('Roboto') ? 120 : 100;
      },
      offsetHeight: 80,
      appendChild(child: unknown) {
        node.children.add(child);
        return child;
      },
      removeChild(child: unknown) {
        node.children.delete(child);
        return child;
      },
      remove() {
        body.children.delete(node);
      },
      getContext(kind: string) {
        calls.push(`context:${kind}`);
        return null;
      },
    };
    calls.push(`create:${tag}`);
    return node;
  };

  define('window', { devicePixelRatio: 2.75 });
  define('document', {
    visibilityState: overrides.hidden ? 'hidden' : 'visible',
    createElement: element,
    body: {
      appendChild(child: unknown) {
        body.children.add(child);
      },
    },
  });
  define('navigator', {
    userAgent: 'Mozilla/5.0 (Linux; Android 13; SM-A546B) AppleWebKit/537.36',
    platform: 'Linux armv81',
    maxTouchPoints: 5000,
    webdriver: false,
    getBattery() {
      calls.push('battery');
      return Promise.resolve({ level: 0.57 });
    },
  });
  define('screen', { width: 393, height: 873 });
  define('matchMedia', (query: string) => {
    calls.push(`media:${query}`);
    return { matches: query === '(pointer: coarse)' };
  });
  if (overrides.frames === false) {
    define('requestAnimationFrame', () => {
      calls.push('frame');
      return 0;
    });
  } else {
    define('requestAnimationFrame', (run: () => void) => setTimeout(run, 0));
  }
  if (overrides.stallFonts) {
    // Each yield takes 400 ms, so the font probe cannot finish inside the bound.
    define(
      'MessageChannel',
      class {
        port1: { onmessage: null | (() => void); close(): void } = { onmessage: null, close() {} };
        port2 = { postMessage: () => setTimeout(() => this.port1.onmessage?.(), 400) };
      },
    );
  }
  return { calls, body };
}

test('a full read hashes what the environment exposes and cleans up', async () => {
  const env = install();
  const reading = await collect({ timings: true });
  assert.equal(reading.status, 'ok');
  assert.deepEqual(Object.keys(reading.parts).sort(), ['darkMode', 'fonts', 'localeFormat', 'model', 'osVersion', 'physScreen']);
  for (const digest of Object.values(reading.parts)) assert.match(digest, /^[0-9a-f]{64}$/);
  assert.deepEqual(reading.traits, {
    battery: 57,
    os: 'android',
    platform: 'Linux armv81',
    gpuClass: null,
    touch: 256,
    pointer: 'coarse',
    hover: false,
    webdriver: false,
    uaPlatform: null,
    emulatorModel: false,
  });
  assert.equal(env.body.children.size, 0, 'the font probe box is removed');
  assert.equal(typeof reading.timings?.total, 'number');
  assert.equal(typeof reading.timings?.wait, 'number');
});

test('two reads of one environment give the same digests', async () => {
  install();
  const first = await collect({ schedule: 'now', traits: false });
  const second = await collect({ schedule: 'now', traits: false });
  assert.deepEqual(first, second);
  assert.ok(!('traits' in first));
});

test('a part that is not selected is not read', async () => {
  const env = install();
  const reading = await collect({ schedule: 'now', parts: ['darkMode'], traits: false });
  assert.deepEqual(Object.keys(reading.parts), ['darkMode']);
  assert.deepEqual(env.calls, ['media:(prefers-color-scheme: dark)']);
});

test('only the selected traits are read', async () => {
  const env = install();
  const reading = await collect({ schedule: 'now', parts: [], traits: ['battery'] });
  assert.deepEqual(reading, { recipe: 1, status: 'ok', parts: {}, traits: { battery: 57 } });
  assert.deepEqual(env.calls, ['battery']);
});

test('the total bound returns what was read so far', async () => {
  install({ stallFonts: true });
  const started = Date.now();
  const reading = await collect({ schedule: 'now', timeoutMs: 1000 });
  const elapsed = Date.now() - started;
  assert.equal(reading.status, 'timeout');
  assert.ok(elapsed >= 950 && elapsed < 1500, `resolved after ${elapsed} ms`);
  assert.ok(reading.parts.darkMode && reading.parts.physScreen && reading.parts.localeFormat);
  assert.equal(reading.parts.fonts, undefined);
  const snapshot = JSON.stringify(reading);
  await new Promise((resolve) => setTimeout(resolve, 900));
  assert.equal(JSON.stringify(reading), snapshot, 'late work does not change the returned reading');
});

test('a hidden tab does not wait for animation frames', async () => {
  const env = install({ hidden: true, frames: false });
  const reading = await collect({ parts: ['darkMode'], traits: false, timings: true });
  assert.equal(reading.status, 'ok');
  assert.ok(!env.calls.includes('frame'));
  assert.ok((reading.timings?.wait ?? 9999) < 500);
});

test('frames that never fire delay the start by two seconds at most', async () => {
  install({ frames: false });
  const reading = await collect({ parts: ['darkMode'], traits: false, timings: true });
  assert.equal(reading.status, 'ok');
  const wait = reading.timings?.wait ?? 0;
  assert.ok(wait >= 1900 && wait < 3000, `waited ${wait} ms`);
});

test('without crypto.subtle the reading is unsupported but keeps its traits', async () => {
  install();
  define('crypto', {});
  const reading = await collect({ schedule: 'now', traits: ['os', 'touch'] });
  assert.deepEqual(reading, { recipe: 1, status: 'unsupported', parts: {}, traits: { os: 'android', touch: 256 } });
});

test('unusable options fall back to the defaults', async () => {
  install();
  const hostile = {
    get parts(): never {
      throw new Error('trap');
    },
  };
  for (const options of [null, hostile, { timeoutMs: Number.NaN }, { schedule: 'later' }]) {
    const reading = await collect(options as never);
    assert.equal(reading.status, 'ok');
    assert.equal(Object.keys(reading.traits ?? {}).length, 10);
  }
});
