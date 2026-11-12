# Scoring

`compare(a, b, options)` turns two sets of part digests and a few facts about the pair into a score from 0 to 100, a band, and a list of reasons that add up to the score. This page describes the algorithm, where each default comes from, and how to change them.

## The algorithm

For each of the ten parts, in the order of `PART_KEYS`:

1. In `crossBrowser` mode, `darkMode`, `localeFormat` and `audioDisplay` are `ignored` and play no further role.
2. The part's weight is added to the available weight.
3. If the digest is absent or not a non-empty string on either side, the part is `missing`. Nothing else happens.
4. Otherwise the weight is added to the comparable weight. Equal digests are a `match` and add the part's weight. Different digests are a `mismatch` and subtract the part's penalty.

Then:

5. Device points are matches minus penalties, floored at 0. When the floor applies, a `floor.zero` reason carries the difference.
6. If `context.sameNetwork` is `true`, `weights.network` is added.
7. If the battery levels agree, `weights.battery` is added. Agreement needs all of: `batteryDelta` from 0 to `limits.batteryTolerance`, `minutesApart` from 0 to `limits.batteryWindowMinutes`, and matched hardware points of at least `limits.batteryMinHardware`.
8. The pair is `corroborated` when step 6 or step 7 added points.
9. The score is the sum, capped at 100 when corroborated and at `limits.uncorroboratedCap` when not. A cap that applies is recorded as `cap.max` or `cap.uncorroborated` with negative points.
10. The band is the highest threshold in `bands` that the score reaches.

`coverage` is the comparable weight divided by the available weight, rounded to two decimals. `hardware` and `settings` are the matched points in each group.

`compare` is symmetric. `score` always equals the sum of `reasons[].points`. A match or mismatch worth 0 points sets the part's state but adds no reason.

Both inputs must be in the same digest space: both straight from `collect()`, or both sealed with the same key. A mix compares as all mismatches.

## Defaults

### Part weights

| Part | Weight | Penalty | Group |
|---|---|---|---|
| `gpuPixels` | 8 | 10 | hardware |
| `glHardware` | 6 | 0 | hardware |
| `physScreen` | 9 | 6 | hardware |
| `model` | 19 | 6 | hardware |
| `osVersion` | 8 | 0 | hardware |
| `rendererModel` | 10 | 0 | hardware |
| `darkMode` | 2 | 0 | settings |
| `localeFormat` | 7 | 0 | settings |
| `fonts` | 2 | 0 | settings |
| `audioDisplay` | 1 | 0 | settings |
| Total | 72 | | 60 hardware, 12 settings |

The weights are log-likelihood ratios measured on a field deployment of 1,217 browsers (see [signals.md](signals.md#field-evidence)). For each part:

```
bits = log2( P(equal | same device) / P(equal | different devices) )
```

The numerator is the share of same-browser pairs, hours apart, in which the part stayed equal. The denominator is the chance that two different browsers had the same value. The bits are scaled so the ten parts total 72 and rounded to integers.

| Part | P(equal, same) | P(equal, different) | Bits | Scaled | Weight |
|---|---|---|---|---|---|
| `gpuPixels` | 1.000 | 0.122 | 3.04 | 8.27 | 8 |
| `glHardware` | 1.000 | 0.209 | 2.26 | 6.15 | 6 |
| `physScreen` | 1.000 | 0.113 | 3.15 | 8.57 | 9 |
| `model` | 1.000 | 0.008 | 6.97 | 18.98 | 19 |
| `osVersion` | 0.998 | 0.127 | 2.97 | 8.11 | 8 |
| `rendererModel` | 1.000 | 0.080 | 3.64 | 9.93 | 10 |
| `darkMode` | 0.996 | 0.56 | 0.83 | 2.26 | 2 |
| `localeFormat` | 1.000 | 0.18 | 2.47 | 6.74 | 7 |
| `fonts` | 1.000 | 0.66 | 0.60 | 1.63 | 2 |
| `audioDisplay` | 0.985 | 0.70 | 0.49 | 1.34 | 1 |

Two limits of this method apply to the defaults:

- The weights assume the parts are independent. `gpuPixels`, `glHardware` and `rendererModel` all follow the GPU and are correlated, so the 60 hardware points overstate the evidence.
- The different-browser figures are upper bounds, because that population includes some people who cleared their cookies. The population was 91% Android. The weights may not suit a desktop or iOS audience.

### Other weights and limits

These numbers are judgement, not measurements.

| Setting | Default | Meaning |
|---|---|---|
| `weights.network` | 20 | Points for the same network. |
| `weights.battery` | 8 | Points for battery agreement. |
| `weights.penalties.gpuPixels` | 10 | Points removed on mismatch. |
| `weights.penalties.physScreen` | 6 | Points removed on mismatch. |
| `weights.penalties.model` | 6 | Points removed on mismatch. |
| `limits.uncorroboratedCap` | 79 | Highest score without network or battery agreement. |
| `limits.batteryTolerance` | 2 | Largest battery difference, in points of charge, that counts as agreement. |
| `limits.batteryWindowMinutes` | 15 | Longest time between two readings for battery levels to be compared. |
| `limits.batteryMinHardware` | 40 | Matched hardware points a pair needs before battery agreement counts. |
| `limits.networkCrowdMax` | 3 | `bestMatch` only. Above this many candidates on one network, the network is not counted. |
| `bands.weak` | 30 | |
| `bands.similar` | 55 | |
| `bands.strong` | 80 | |

The field measurements that informed the judgement:

- Network: 95% of same-device hand-offs about a minute apart shared the /24, and 22% of browsers changed their /24 within hours. Over minutes the same device usually stays on one network. Over hours a different network says little.
- Battery: of 23 same-device pairs read within 15 minutes, 22 were within 2 points.

With the default weights the ten parts total 72, so the cap of 79 is never reached. It exists so that raised part weights cannot move an uncorroborated pair into `strong`. `resolveScoring` enforces `limits.uncorroboratedCap < bands.strong`.

### Valid ranges

All values are integers. `null` and `undefined` overrides fall back to the default. Anything else outside these ranges throws `RangeError`.

| Setting | Range |
|---|---|
| `weights.parts.*`, `weights.penalties.*`, `weights.network`, `weights.battery` | 0 to 100 |
| `limits.uncorroboratedCap`, `limits.batteryTolerance`, `limits.batteryMinHardware` | 0 to 100 |
| `limits.batteryWindowMinutes` | 1 to 1440 |
| `limits.networkCrowdMax` | 0 to 100000 |
| `bands.weak`, `bands.similar` | 1 to 100 |
| `bands.strong` | 1 to 101 |

Also required: `bands.weak < bands.similar < bands.strong` and `limits.uncorroboratedCap < bands.strong`.

## Bands

| Band | Default range | Meaning |
|---|---|---|
| `none` | 0 to 29 | No useful evidence, or stable parts contradict. |
| `weak` | 30 to 54 | Shares a hardware class and little more. |
| `similar` | 55 to 79 | Indistinguishable or nearly so by device parts. Could be the same device or another unit of the same model with the same settings. Never treat it as identity. |
| `strong` | 80 to 100 | Device parts agree, and the network, a recent battery level, or both corroborate. |

In the field deployment, 34% of browsers had at least one other browser identical on all ten parts. That is why device parts alone stop at `similar`.

## Worked examples

Default settings. "Battery" means a difference of 1 point, 5 minutes apart.

| Pair | Context | Score | Band |
|---|---|---|---|
| All ten parts equal | none | 72 | similar |
| All ten parts equal | same network | 92 | strong |
| All ten parts equal | battery | 80 | strong |
| All ten parts equal | same network, battery | 100 | strong |
| `crossBrowser`: six hardware parts and `fonts` equal | same network | 82 | strong |
| `crossBrowser`: same, `model` missing on one side | same network | 63 | similar |
| `crossBrowser`: same, `model` missing on one side | same network, battery | 71 | similar |
| All equal except `gpuPixels` | same network | 74 | similar |
| All equal except `gpuPixels` | same network, battery | 82 | strong |
| Different `model`, all else equal | same network, battery | 75 | similar |
| Nothing in common | none | 0 | none |
| Nothing in common | same network | 20 | none |

The last row is `corroborated: true` with a score of 20. Corroboration says where points came from, not that the pair is a match.

## Mismatch policy

A mismatch on `gpuPixels`, `physScreen` or `model` subtracts points. It does not veto the pair.

These three parts never differed for the same device in the field data: zero mismatches in 481 same-browser pairs and in 121 in-app and main browser pairs. Zero observed in samples of that size still allows a true mismatch rate of roughly 0.6% and 2.5%. A veto would also turn every driver update or resolution change into a certain miss. A penalty lets strong agreement elsewhere outweigh one changed part: all equal except `gpuPixels`, with network and battery agreeing, still scores 82.

Mismatches on the other seven parts cost nothing beyond the lost weight. They change for ordinary reasons: an OS update, a switch to dark mode, a different browser.

## Missing parts

A part that is absent on either side scores zero and is not renormalised. The remaining parts keep their weights and the maximum reachable score drops.

In the field deployment 84% of readings had all ten parts, 4% missed one and 12% missed two. The common absences were `model` (present in 84%) and `rendererModel` (present in 88%).

The consequences with default settings:

- Without `model`, a full-mode pair with everything else equal scores 53 alone, 73 with the same network, and 81 with network and battery.
- Without `model` in `crossBrowser` mode, the most a pair scores is 71. It cannot reach `strong`.
- Without `model` and `rendererModel`, matched hardware is 31. That is below `limits.batteryMinHardware`, so battery agreement does not count.

Use `coverage` to tell "different" from "could not compare". A score of 43 with coverage 0.6 is a pair that agreed on everything it could be compared on.

## Context

`compare` takes three facts about the pair. `pairContext(a, b)` derives them from two records of `{ network, battery, at }`, and `bestMatch` does this for you from sealed readings.

### Network

`sameNetwork` is `true` when both `network` values are the same non-empty string. `sealReading` derives the value from the IPv4 /24 or IPv6 /48 of the client address. A loopback, unspecified, private, link-local or carrier-internal address gives `network: null` unless `allowPrivateNetworks` is set, because such an address is almost always a proxy's and would put every visitor on one network.

### Crowd rule

`bestMatch` counts the comparable candidates that share the current reading's network. When that count is above `limits.networkCrowdMax` (default 3), the network is treated as a carrier gateway, an office or a campus, and it is not counted for any candidate. The result reports `networkCrowd` and `networkCounted`.

Pass one candidate per earlier browser or session. Repeated readings of one device would crowd its own network. The rule only exists in `bestMatch`. If you call `compare` yourself, apply your own.

### Battery

Battery agreement counts when the two levels differ by at most 2 points, the readings are at most 15 minutes apart, and at least 40 hardware points matched. `pairContext` returns `batteryDelta: null` when both levels are 100, because phones left on charge all read 100.

The battery level comes from the client and is available only where the browser has `navigator.getBattery()`.

## Cross-browser mode

`mode: 'crossBrowser'` ignores `darkMode`, `localeFormat` and `audioDisplay`. Between an in-app browser and the main browser on the same device, these stayed equal in 71%, 31% and 77% of field pairs, while the six hardware parts and `fonts` stayed equal in 89% to 100%.

The remaining seven parts total 62 points. A pair cannot reach `strong` on parts and battery alone (62 + 8 = 70). It needs the same network.

Use this mode when the earlier reading may come from a different browser on the same device, for example a link opened inside an app and then in the main browser. Use `full` when both readings come from the same browser.

## Tuning

Options are passed per call to `compare` or `bestMatch`. Anything you do not set keeps its default.

```js
import { bestMatch } from 'r-detect/server';

const { best } = bestMatch(current, candidates, {
  weights: { battery: 0, penalties: { gpuPixels: 0, physScreen: 0, model: 0 } },
});
```

| Change | When |
|---|---|
| `weights.battery: 0` | Clients may be hostile. The battery level is client-supplied, and about 21 readings with different levels cover every value within the tolerance. |
| Penalties set to 0 | Desktop or mixed-browser audiences. A window moved to another monitor changes `physScreen`, and the stability of these parts was measured on a mostly Android population. |
| `bands.strong: 101` | You never want a `strong` result. Scores stop at 100, so the band is switched off. |

Changing weights changes what the bands mean. After any change, rerun your own labelled pairs and check where same-device and different-device scores fall.

### Learning weights from labelled pairs

The defaults describe one population. To fit your own:

1. Collect pairs you can label with confidence. Same-device pairs: two readings from one logged-in session, or from one browser that kept a first-party cookie. Different-device pairs: readings from browsers known to be distinct.
2. For each part, count how often it is equal in each set, over the pairs where both sides have the part.
3. Compute `log2(P(equal | same device) / P(equal | different devices))` for each part.
4. Scale so the parts total the device budget you want (72 by default) and round to integers.
5. Check the result on pairs that were not used for fitting.

This reproduces the defaults from the table above:

```js
const measured = {
  gpuPixels: [1, 0.122],
  glHardware: [1, 0.209],
  physScreen: [1, 0.113],
  model: [1, 0.008],
  osVersion: [0.998, 0.127],
  rendererModel: [1, 0.08],
  darkMode: [0.996, 0.56],
  localeFormat: [1, 0.18],
  fonts: [1, 0.66],
  audioDisplay: [0.985, 0.7],
};

const bits = Object.entries(measured).map(([part, [same, different]]) => [
  part,
  Math.log2(same / different),
]);
const total = bits.reduce((sum, [, value]) => sum + value, 0);
const parts = Object.fromEntries(bits.map(([part, value]) => [part, Math.round((value * 72) / total)]));
// { gpuPixels: 8, glHardware: 6, physScreen: 9, model: 19, osVersion: 8,
//   rendererModel: 10, darkMode: 2, localeFormat: 7, fonts: 2, audioDisplay: 1 }
```

Pass the result as `weights.parts`. Rounding can make the total differ from the budget by a point or two. A part that is equal less often for the same device than for different devices gives negative bits. Set it to 0, since weights cannot be negative.

A part that is always equal for different devices carries no information and gets 0. A part that was never equal for different devices in your sample has an infinite ratio. Use a floor for the denominator, such as one over the number of pairs.

## Inspection findings

`inspectReading(reading)` looks for traits that contradict each other. It returns `{ findings, missing, thin, appleMobile }` and never changes a score. What to do with a finding is your decision.

A rule fires only when every trait it reads is present. A missing trait is unknown, not suspicious.

| Finding | Fires when | Honest causes |
|---|---|---|
| `automation` | `webdriver` is `true` | Your own tests and monitoring. Any automated browser that does not hide the flag. |
| `emulatorModel` | The model name matched the emulator list | A developer testing in an emulator. |
| `androidX86Platform` | `os` is `android` and `platform` contains `x86`, `i686`, `i386`, `amd64` or `win` | x86 Android tablets and laptops. |
| `androidDesktopGpu` | `os` is `android` and `gpuClass` is `desktop` or `software` | x86 Android devices with a desktop GPU family. A browser that falls back to software rendering. |
| `androidNoTouch` | `os` is `android` and `touch` is 0 | An Android device without a touchscreen. |
| `androidFinePointer` | `os` is `android`, `pointer` is `fine` and `hover` is `true` | A mouse or trackpad attached to a phone or tablet. |
| `platformHintMismatch` | `uaPlatform` is present and either `os` is `android` with a hint of `windows`, `macos`, `linux` or `chrome os`, or `os` is `ios` | A user-agent override. Device emulation in developer tools. |
| `appleMobileMismatch` | The reading claims an iPhone or iPad (`os` is `ios`, or `os` is `mac` with platform `MacIntel` and more than one touch point) while `touch` is 0, `gpuClass` is `desktop`, `software` or `mobile`, or an iOS user agent carries `uaPlatform` | A user-agent override. Device emulation in developer tools. |
| `repeatedDigest` | Two parts carry the same digest | None. The part name is inside every hash, so two parts cannot share a digest. |

Desktop-site mode on an Android phone is not a finding. The user agent then looks like desktop Linux while `uaPlatform` still says `android`, and no rule reads that combination as a contradiction.

The other fields:

| Field | Meaning |
|---|---|
| `missing` | The parts the reading does not carry. |
| `thin` | The reading has no parts at all, or it lacks two or more of `gpuPixels`, `physScreen`, `glHardware` and `osVersion` and is not an Apple mobile device. A thin reading matches almost nothing and should not be trusted to be distinct. |
| `appleMobile` | Every trait agrees that this is an iPhone or iPad: an iOS user agent with an `iPhone`, `iPad` or `iPod` platform (or a Mac user agent with `MacIntel` and more than one touch point), no `uaPlatform`, `gpuClass` of `apple`, at least one touch point and a coarse pointer. Such devices expose little by design, so they are exempt from `thin`. |

An empty `findings` list is not a clean result. A client that sends no traits, or consistent false ones, raises nothing. The rules catch careless automation only.
