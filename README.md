# r-detect

r-detect answers one question: is this probably the same physical device as an earlier reading? It reads what a web page can see without a permission prompt, hashes it into ten parts, and scores two readings from 0 to 100 with a breakdown of where the points came from.

It is a similarity tool, not a device ID. Many devices of one model are identical on every part, so a high score on device parts alone means "indistinguishable", not "the same". The top band is only reachable when the network or a recent battery level agrees as well.

- Three entry points: `r-detect` (browser), `r-detect/score` (pure scoring), `r-detect/server` (validation, keyed sealing, matching).
- No runtime dependencies. ESM only. Types included.
- The library makes no network request and stores nothing. Transport and storage are yours.

r-detect is browser fingerprinting. Read [Privacy and security](#privacy-and-security) before you deploy it.

## Install

```sh
npm install r-detect
```

The browser entry needs a secure context (HTTPS or localhost). The server entry needs Node 20 or later, or any runtime with global WebCrypto.

## Quick start

In the browser, start the read early, keep the promise, and send the reading when you need it.

```js
import { collect } from 'r-detect';

const pending = collect();

export async function sendReading() {
  const reading = await pending;
  await fetch('/device', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(reading),
  });
}
```

On the server, validate the body, seal it with your key, and store only the sealed form. `db.readings` stands for your own storage.

```js
import { inspectReading, keyFromBase64, parseReading, sealReading } from 'r-detect/server';

// Decode the key once at startup and reuse the same array.
const key = keyFromBase64(process.env.R_DETECT_KEY);

// `body` is the JSON-parsed request body, already limited in size.
// `clientAddress` is the address your trusted edge saw, never a client-set header.
export async function receiveReading(body, clientAddress, accountId) {
  const reading = parseReading(body);
  if (reading === null) return null;

  const { findings, thin } = inspectReading(reading);
  const sealed = await sealReading(reading, { key, ip: clientAddress, keyId: 'k1' });

  await db.readings.insert({ accountId, sealed, findings, thin });
  return sealed;
}
```

Later, compare a new sealed reading with earlier ones and act on the band.

```js
import { bestMatch } from 'r-detect/server';

export async function checkDevice(sealed, accountId) {
  // One candidate per earlier browser or session, narrowed by time.
  // Leave out the reading you are checking.
  const rows = await db.readings.recentFromOtherAccounts(accountId, { hours: 24 });
  const { best } = bestMatch(sealed, rows.map((row) => row.sealed));
  if (best === null) return { band: 'none' };

  const { band, score, coverage, reasons } = best.result;
  if (band === 'strong') {
    // Device parts agree and network or battery backs them up. Review or add friction.
  } else if (band === 'similar') {
    // Could be the same device or another unit of the same model. Not identity.
  }
  return { band, score, coverage, reasons, matched: rows[best.index].accountId };
}
```

Generate the key with a cryptographic generator and keep it in a secret store:

```sh
node -e "console.log(require('node:crypto').randomBytes(32).toString('base64'))"
```

## How to read the result

`compare()` and `bestMatch()` return a `CompareResult`.

| Field | Meaning |
|---|---|
| `score` | Integer from 0 to 100. Always the sum of `reasons[].points`. |
| `band` | `none`, `weak`, `similar` or `strong`, from the thresholds below. |
| `corroborated` | `true` when same-network or battery agreement added points. |
| `coverage` | Share of the part weight that was present on both sides, from 0 to 1. |
| `hardware`, `settings` | Points from matching hardware parts and settings parts. |
| `parts` | Per part: `match`, `mismatch`, `missing` or `ignored`. |
| `reasons` | The breakdown: `{ code, points }` per line. |

Bands with the default thresholds:

| Band | Score | Meaning |
|---|---|---|
| `none` | 0 to 29 | No useful evidence, or stable parts contradict. |
| `weak` | 30 to 54 | Shares a hardware class and little more. |
| `similar` | 55 to 79 | Indistinguishable or nearly so by device parts. Could be the same device or another unit of the same model with the same settings. Never treat it as identity. |
| `strong` | 80 to 100 | Device parts agree, and the network, a recent battery level, or both corroborate. |

Read `corroborated` together with `coverage`. Low coverage means "could not tell", not "different device". A corroborated result with coverage 0 only says that two requests shared a network.

Reason codes are `match.<part>`, `mismatch.<part>`, `floor.zero`, `context.network`, `context.battery`, `cap.uncorroborated` and `cap.max`. Penalties and caps carry negative points. A pair equal on every part except `gpuPixels`, on the same network, scores 74:

```js
[
  { code: 'mismatch.gpuPixels', points: -10 },
  { code: 'match.glHardware', points: 6 },
  { code: 'match.physScreen', points: 9 },
  { code: 'match.model', points: 19 },
  { code: 'match.osVersion', points: 8 },
  { code: 'match.rendererModel', points: 10 },
  { code: 'match.darkMode', points: 2 },
  { code: 'match.localeFormat', points: 7 },
  { code: 'match.fonts', points: 2 },
  { code: 'match.audioDisplay', points: 1 },
  { code: 'context.network', points: 20 },
]
```

## The ten parts

Each part is one SHA-256 digest. A part the browser does not expose is left out of the reading.

| Part | Group | What is read | Weight | Mismatch penalty |
|---|---|---|---|---|
| `gpuPixels` | hardware | Pixels of a fixed 160x160 WebGL scene | 8 | 10 |
| `glHardware` | hardware | 13 WebGL limits and 12 shader precision formats | 6 | 0 |
| `physScreen` | hardware | Screen size in physical pixels, rounded and sorted | 9 | 6 |
| `model` | hardware | Device model from Client Hints or an Android user agent | 19 | 6 |
| `osVersion` | hardware | OS family and major version | 8 | 0 |
| `rendererModel` | hardware | GPU model, cleaned of wrapper and driver text | 10 | 0 |
| `darkMode` | settings | `prefers-color-scheme` | 2 | 0 |
| `localeFormat` | settings | Time zone, date format, number format, hour cycle | 7 | 0 |
| `fonts` | settings | Which of 82 candidate fonts are installed | 2 | 0 |
| `audioDisplay` | settings | Audio sample rate and channels, colour gamut, dynamic range | 1 | 0 |

A reading also carries ten plain traits (`battery`, `os`, `platform`, `gpuClass`, `touch`, `pointer`, `hover`, `webdriver`, `uaPlatform`, `emulatorModel`). They are not hashed and not scored, except that `battery` is used as corroboration. [docs/signals.md](docs/signals.md) specifies every part and trait, the hashing recipe and the known weak spots.

## API

### `r-detect`

```ts
collect(options?: CollectOptions | null): Promise<Reading>
```

Reads the parts and traits. The promise always resolves and never rejects. Each call reads everything again, so call it once per page load and keep the promise.

| Option | Default | Meaning |
|---|---|---|
| `parts` | all ten | Parts to read. A part that is not listed is not read at all. Unknown names are ignored. |
| `traits` | all ten | `false` reads none, an array reads only those. |
| `schedule` | `'idle'` | `'idle'` waits for two animation frames (at most 2 s, skipped in a hidden tab) and then for idle time. `'now'` starts immediately. |
| `timeoutMs` | `20000` | Upper bound for the whole read, waiting included. Clamped to 1000 to 60000. |
| `timings` | `false` | Adds whole milliseconds per step: one entry per part read, plus `traits`, `wait` and `total`. |

An option that cannot be used falls back to its default.

```ts
interface Reading {
  recipe: 1;
  status: 'ok' | 'timeout' | 'unsupported';
  parts: Partial<Record<PartKey, string>>;   // 64 lowercase hex characters each
  traits?: Partial<Traits>;                  // absent when traits are switched off
  timings?: Timings;                         // present only when requested
}
```

| Status | Meaning |
|---|---|
| `ok` | The read finished. Parts the browser does not expose are absent. |
| `timeout` | `timeoutMs` passed. The reading holds what was read up to then. |
| `unsupported` | No browser environment, or no `crypto.subtle` (an insecure context). No parts. |

`JSON.stringify(reading)` is the wire format. The entry also exports `RECIPE`, `PART_KEYS`, `HARDWARE_PARTS`, `SETTINGS_PARTS`, `TRAIT_KEYS` and the types `CollectOptions`, `Reading`, `ReadingStatus`, `Parts`, `PartKey`, `Traits`, `TraitKey`, `Timings`, `OsFamily`, `GpuClass`, `PointerKind`.

`collect()` constructs and closes one `AudioContext`, measures hidden text in the document body for the font probe, and keeps two WebGL contexts that later calls reuse. It writes no storage and makes no network request.

### `r-detect/score`

Pure functions with no browser or server dependency.

```ts
compare(a: Parts, b: Parts, options?: CompareOptions | null): CompareResult
pairContext(a: Context, b: Context): PairContext
resolveScoring(options?: ScoringOptions | null): Scoring
```

`compare` scores two sets of part digests. Both must be in the same digest space: both straight from `collect()`, or both sealed with the same key. A mix compares as all mismatches.

| Option | Default | Meaning |
|---|---|---|
| `mode` | `'full'` | `'crossBrowser'` leaves out `darkMode`, `localeFormat` and `audioDisplay`. |
| `context` | `{}` | `{ sameNetwork?, batteryDelta?, minutesApart? }`, usually from `pairContext`. |
| `weights` | `DEFAULT_WEIGHTS` | `{ parts?, penalties?, network?, battery? }`. Override any subset. |
| `limits` | `DEFAULT_LIMITS` | `{ uncorroboratedCap?, batteryTolerance?, batteryWindowMinutes?, batteryMinHardware?, networkCrowdMax? }` |
| `bands` | `DEFAULT_BANDS` | `{ weak?, similar?, strong? }` |

`pairContext` reduces two `{ network?, battery?, at? }` records to the pair facts. `network` is an opaque string and only equality matters. `at` is epoch milliseconds. Two batteries both at 100 give `batteryDelta: null`.

`resolveScoring` merges options over the defaults, validates them and returns `{ weights, limits, bands }`.

`compare` and `resolveScoring` throw `RangeError` on an invalid configuration: a weight, penalty, limit or band that is not an integer in its range, bands that do not satisfy `weak < similar < strong`, `limits.uncorroboratedCap` not below `bands.strong`, or an unknown `mode`.

Constants: `DEFAULT_WEIGHTS`, `DEFAULT_LIMITS`, `DEFAULT_BANDS` (all frozen), `RECIPE`, `PART_KEYS`, `HARDWARE_PARTS`, `SETTINGS_PARTS`. Types: `CompareOptions`, `CompareResult`, `Context`, `PairContext`, `Band`, `PartState`, `Reason`, `ReasonCode`, `Weights`, `Limits`, `Bands`, `Scoring`, `ScoringOptions`, `Parts`, `PartKey`.

### `r-detect/server`

Everything from `r-detect/score`, plus the functions below. The intended order is `parseReading`, `inspectReading`, `sealReading`, store, and later `bestMatch`.

```ts
parseReading(input: unknown): Reading | null
```

Validates untrusted JSON. Returns a fresh object with only known fields, or `null`. Never throws. A wrong `recipe`, an unknown status, an unknown part key or a malformed digest rejects the whole reading, and so does a known trait with an invalid value. Unknown trait keys and `timings` are dropped. `platform` and `uaPlatform` are cut to 32 characters and reduced to letters, digits, `_`, space and `. : / ( ) -`.

```ts
inspectReading(reading: Reading): Inspection
// { findings: Finding[], missing: PartKey[], thin: boolean, appleMobile: boolean }
```

Reports contradictions between a reading's own traits, the parts it lacks, and whether it is too thin to trust as distinct. It never changes a score. An empty `findings` list is not a clean result. Throws `TypeError` when the input is not a valid reading. The findings are listed in [docs/scoring.md](docs/scoring.md#inspection-findings).

```ts
sealReading(reading: Reading, options: SealOptions): Promise<SealedReading>
// { recipe, parts, battery, network, at, keyId? }
```

Re-hashes every part digest with HMAC-SHA256 under your key and derives the context that scoring needs. Rejects with `TypeError` when the input is not a valid reading and with `RangeError` when the key is unusable.

| Option | Default | Meaning |
|---|---|---|
| `key` | required | At least 16 bytes as a `Uint8Array` (32 recommended), or a `CryptoKey` imported for HMAC-SHA256 signing. |
| `ip` | none | The client address. Used only to derive `network`, never stored. |
| `allowPrivateNetworks` | `false` | By default a loopback, unspecified, private, link-local or carrier-internal address gives `network: null`. |
| `keyId` | none | A label for the key, stored with the reading. |
| `at` | `Date.now()` | Epoch milliseconds. Keep it a number when you read it back from storage. |

```ts
bestMatch<T extends SealedReading>(
  current: SealedReading,
  candidates: readonly T[],
  options?: BestMatchOptions | null,   // CompareOptions without `context`
): { best: { candidate: T, index: number, result: CompareResult } | null,
     networkCrowd: number, networkCounted: boolean }
```

Compares one sealed reading with a list and returns the highest score. Candidates with another recipe or another `keyId` are skipped. When more than `limits.networkCrowdMax` (default 3) candidates share the current network, the network is not counted for any candidate. Ties go to the corroborated result, then the more recent candidate, then the earlier position. `best` is `null` when no candidate could be compared. Throws `RangeError` on invalid options. The cost is linear in the number of candidates.

```ts
keyFromBase64(text: string): Uint8Array
keyedDigest(key: KeyInput, part: PartKey, clientDigest: string): Promise<string>
networkKey(key: KeyInput, ip: string): Promise<string | null>
```

`keyFromBase64` decodes base64 or base64url and throws `RangeError` on anything else. `keyedDigest` is the per-part step of `sealReading` and rejects with `RangeError` on an unknown part or a malformed digest. `networkKey` returns the keyed digest of an address's IPv4 /24 or IPv6 /48, or `null` when the text is not an address. It does not apply the private-address rule. That rule belongs to `sealReading`.

Each key `Uint8Array` is imported once and remembered for that array object. Create it once and reuse it. A new array per request imports the key every time.

The entry also exports `TRAIT_KEYS` and the types `SealOptions`, `SealedReading`, `BestMatch`, `BestMatchOptions`, `Match`, `Finding`, `Inspection`, `HmacKey`, `KeyInput`, and the reading types listed under `r-detect`.

## Cross-browser mode

Two browsers on one device share hardware but not always settings. In a field deployment, `localeFormat` stayed equal in 31% of pairs between an in-app browser and the main browser on the same device, `darkMode` in 71% and `audioDisplay` in 77%. The six hardware parts and `fonts` stayed equal in 89% to 100%.

`mode: 'crossBrowser'` ignores those three parts. The other seven total 62 points, so a pair needs network agreement to reach `strong`. With all seven equal and the same network the score is 82. A reading without `model` cannot reach `strong` in this mode with the default settings: the most it scores is 71, with network and battery both agreeing.

```js
const { best } = bestMatch(sealed, candidates, { mode: 'crossBrowser' });
```

## Tuning

Every weight, penalty, limit and band threshold can be overridden per call. Common changes:

| Situation | Setting |
|---|---|
| Clients may be hostile | `weights: { battery: 0 }` |
| Desktop or mixed-browser audience | `weights: { penalties: { gpuPixels: 0, physScreen: 0, model: 0 } }` |
| You never want the `strong` band | `bands: { strong: 101 }` |

The default part weights were measured on one population. If yours differs, learn weights from your own labelled pairs. [docs/scoring.md](docs/scoring.md) has the algorithm, the origin of every default, worked examples and the method.

## What it cannot do

- It cannot tell two units of the same model with the same settings apart. In a field deployment, 34% of browsers had at least one other browser identical on all ten parts.
- It cannot prove identity. A reading is supplied by the client and can be forged, copied or replayed.
- It does not survive a change of the things it reads. A major OS update changes `osVersion`, a GPU driver update can change `gpuPixels`, and a desktop window moved to another monitor changes `physScreen`.
- It reads less on browsers that restrict these APIs. `model` is absent on iOS and Firefox. `rendererModel` is absent where the browser hides the renderer. `gpuPixels` is dropped where the browser adds noise to reads.
- The weights assume the parts are independent. The three GPU parts are correlated, so the 60 hardware points overstate the evidence.

What the evidence covers:

| Area | State |
|---|---|
| Android, Chromium-based browsers and in-app browsers | Field deployment: 1,217 browsers over one week, 91% Android, 68% of readings from in-app browsers. This is where the default weights come from. |
| iOS | About 8% of that population. Not studied in depth. |
| Desktop | About 1% of that population. Not studied. |
| Firefox, privacy-hardened browsers | Not covered. |
| Stability over time | Measured up to 29 hours. Nothing beyond about a day. |
| Two labelled phones of the same model | Not tested. |
| This package's collector | Digests compared with the field-tested collector in Chromium, Chrome and WebKit builds on one desktop machine and identical for every part. No phone has run this package yet. |

## Privacy and security

The full statement is in [docs/privacy.md](docs/privacy.md). The short version:

- r-detect is browser fingerprinting. In some jurisdictions that requires disclosure and may require consent. Deciding that and informing users is your responsibility. This is not legal advice.
- The digests a browser sends are plain SHA-256 of values with few possible outcomes. Anyone who sees a reading can recover most of the values by trying the possibilities. Treat an unsealed reading as personal data.
- The same device produces the same client digests on every site that uses r-detect. Seal first, discard the original, and keep request bodies out of logs.
- The key protects stored digests against someone who has the database but not the key. It does not protect data in transit and protects nothing if it leaks with the data. Never return sealed digests to clients.
- Pass `sealReading` the client address your trusted edge saw. Never take it from a header the client can set.
- A score is evidence about cooperative browsers, never proof. Do not use a match as a login factor, to skip verification, or as the only ground for an irreversible action.
- Battery and network can both be influenced by the client. Where clients may be hostile, set `weights.battery` to 0 and decide deliberately how to treat `similar`.
- Always `parseReading` client input, reject `null`, and limit the request body size before parsing.

## Browser and runtime support

The published code is unbundled ES2022 modules.

| Environment | Requirement |
|---|---|
| Browser entry | A secure context, for `crypto.subtle`. Every other API is optional: a part whose API is absent is left out. |
| Score entry | Any ES2022 runtime. |
| Server entry | Node 20 or later, or a runtime with global `crypto.subtle`, `TextEncoder` and `atob`. |

Measured cost of a full read on one desktop machine: about 55 to 80 ms in Chromium, where the first `AudioContext` of a session can add a few hundred milliseconds, and about 870 ms in a WebKit build, where the font probe dominated. Phones have not been measured with this package. The field collector it was ported from ran on mid-range Android phones.

## Development

```sh
npm test            # node --test over test/*.test.ts
npm run typecheck   # tsc --noEmit
npm run vectors     # recompute the golden vectors and compare with test/vectors/recipe-1.json
npm run build       # dist/
npm run harness     # serve the harness page at http://127.0.0.1:8787/
```

The tests run the TypeScript sources directly and need a Node version that strips types. They were last run on Node 24.

The harness page reads the current browser twice with the built library and shows each digest, its duration and whether the repeat matched. Run `npm run build` first. `PORT` and `HOST` change where it listens. `collect()` needs a secure context, and a phone on the local network is not one, so put an HTTPS tunnel in front of the harness to test phones.

## Versioning

Two version numbers apply.

`RECIPE` (currently 1) is the hashing recipe and is carried in every reading. It changes when anything could change the digest of an unchanged device: the hashing format, a normalisation rule, the font candidate list, the probe text, the WebGL scene or the list of WebGL parameters. Readings from different recipes are never compared. Within one recipe the golden vectors in `test/vectors/recipe-1.json` only grow.

The package version follows semantic versioning. A change to the default weights, penalties, limits or bands is a breaking change, because scores change for the same inputs.

## License

MIT. Copyright (c) 2026 raeez alshamaly.
