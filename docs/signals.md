# Signals

A reading has two kinds of content. Parts are hashed in the browser and compared by equality. Traits are plain values that are never hashed and never scored, except that `battery` serves as corroboration.

This page specifies hashing recipe 1 closely enough to reimplement it, describes what each part and trait reads, and lists the measurements and known weak spots.

## Recipe 1

`RECIPE` is `1` and is carried in every reading as `recipe`. Digests are only comparable with digests from the same recipe.

### Part digest

```
digest = lowercase_hex( SHA-256( UTF-8( JSON.stringify([partName, value]) ) ) )
```

`partName` is the part key exactly as spelled in the table below. `value` is the normalised value for that part. `JSON.stringify` is called with no replacer and no indentation, so there is no whitespace in the hashed text. `null` entries inside a value are kept as `null`.

The part name is inside the hashed text, so equal values of different parts never share a digest.

```
["darkMode","dark"]
4b4c383b32e37b4886340448d1f92a3d5a03eaba578f7ec81c3ee442938ceba0
```

### GPU image

`gpuPixels` is hashed twice. The raw RGBA buffer (160 x 160 x 4 = 102,400 bytes, in the row order `readPixels` returns) is hashed first, and the hex result becomes the part's value:

```
bufferHex = lowercase_hex( SHA-256( pixels ) )
digest    = lowercase_hex( SHA-256( UTF-8( JSON.stringify(["gpuPixels", bufferHex]) ) ) )
```

### Keyed digest

`sealReading` replaces every client digest with a keyed one:

```
keyed = lowercase_hex( HMAC-SHA256( key, UTF-8( "part:" + partName + ":" + clientDigest ) ) )
```

### Network digest

```
network = lowercase_hex( HMAC-SHA256( key, UTF-8( "net:" + networkText ) ) )
```

| Address | `networkText` | Example |
|---|---|---|
| IPv4 | First three octets in decimal, then `.0` (the /24) | `203.0.113.77` gives `203.0.113.0` |
| IPv6 | First three 16-bit groups in lowercase hex without leading zeros, then `::/48` | `2001:0DB8:0012::1` gives `2001:db8:12::/48` |
| IPv4-mapped IPv6 | Treated as the IPv4 address | `::ffff:203.0.113.77` gives `203.0.113.0` |

Surrounding whitespace is trimmed. Text longer than 64 characters, an IPv6 address with a zone id (`%eth0`), and anything else that does not parse gives no network.

### What counts as a recipe change

Anything that could change the digest of an unchanged device is a recipe change and needs a new `RECIPE` number: the hashing format, any normalisation rule, the font candidate list, the probe text and font size, the canvas size, context attributes, clear colour, shader text and vertex data of the GPU image, and the list and order of WebGL parameters.

A change that only affects scores (default weights, penalties, limits, bands) is not a recipe change. It is a breaking change of the package version.

## Parts

| Part | Group | Value that is hashed |
|---|---|---|
| `gpuPixels` | hardware | Hex SHA-256 of the pixel buffer |
| `glHardware` | hardware | Array of 14 entries: 13 limits, then an array of 12 precision strings |
| `physScreen` | hardware | `[shorter, longer]` in physical pixels |
| `model` | hardware | Lowercase model string |
| `osVersion` | hardware | `android:<major>`, `ios:<major>` or `windows:<major>` |
| `rendererModel` | hardware | Lowercase GPU model string |
| `darkMode` | settings | `"dark"` or `"light"` |
| `localeFormat` | settings | `[timeZone, dateText, numberText, hourCycle]` |
| `fonts` | settings | Sorted array of detected font names |
| `audioDisplay` | settings | `[sampleRate, maxChannelCount, colorGamut, dynamicRange]` |

A part whose read throws, or whose value is `null` or `undefined`, is left out of the reading. Absent means "not readable" and scores nothing.

### gpuPixels

A 160x160 canvas with a WebGL context created with `{ preserveDrawingBuffer: true }`. The scene is one full-viewport triangle strip (`-1,-1  1,-1  -1,1  1,1`) drawn with this program:

```glsl
// vertex
attribute vec2 p; varying vec2 v; void main(){ v=p; gl_Position=vec4(p,0.0,1.0); }

// fragment
precision highp float; varying vec2 v; void main(){ float a=sin(v.x*37.0)*cos(v.y*29.0); float b=fract(sin(dot(v,vec2(12.9898,78.233)))*43758.5453); gl_FragColor=vec4(0.5+0.5*a, b, 0.5+0.5*sin(a*b*91.0), 1.0); }
```

The exact pixels depend on how the GPU and its driver evaluate the trigonometric functions, not on the browser.

Before drawing, the canvas is cleared to the colour (17, 83, 149, 255) and a 4x4 block is read back. The scene is then drawn and read twice. The part is dropped when:

- the solid colour does not read back exactly, which means the browser adds noise to reads,
- the two draws differ,
- the work takes longer than 1500 ms, or
- the context is unavailable, lost or reports an error.

A dropped image is "no information", never "a different device". The context is kept and reused by later calls.

### glHardware

Read from a separate WebGL context created with default attributes. Thirteen `getParameter` values in this order, with typed arrays converted to plain arrays:

`MAX_RENDERBUFFER_SIZE`, `MAX_VIEWPORT_DIMS`, `ALIASED_LINE_WIDTH_RANGE`, `ALIASED_POINT_SIZE_RANGE`, `MAX_VARYING_VECTORS`, `MAX_TEXTURE_IMAGE_UNITS`, `MAX_VERTEX_TEXTURE_IMAGE_UNITS`, `RED_BITS`, `GREEN_BITS`, `BLUE_BITS`, `ALPHA_BITS`, `DEPTH_BITS`, `STENCIL_BITS`

The fourteenth entry is an array of twelve strings `rangeMin/rangeMax/precision` from `getShaderPrecisionFormat`, for `VERTEX_SHADER` and then `FRAGMENT_SHADER`, each with `LOW_FLOAT`, `MEDIUM_FLOAT`, `HIGH_FLOAT`, `LOW_INT`, `MEDIUM_INT`, `HIGH_INT`. A format the browser does not return is `null`.

### physScreen

`screen.width` and `screen.height` are each multiplied by `devicePixelRatio`, rounded to the nearest multiple of 8, and the pair is sorted ascending. Browsers on one phone report different CSS sizes and ratios for the same panel, and the product is stable: `384 x 854` at ratio `2.8125` and `378 x 840` at ratio `2.857142857142857` both give `[1080, 2400]`. A non-positive width, height or ratio gives no part.

### model

The `model` value of `navigator.userAgentData.getHighEntropyValues(['model', 'platformVersion'])`, trimmed and lowercased, when it is a non-empty string. The call is given 1000 ms.

Otherwise the model token of an Android user agent, matched by `/Android [^;)]*; ([^;)]+?)(?: Build\/|\))/i`, trimmed and lowercased. The placeholder `K` of reduced user agents is not a model and gives no part.

### osVersion

| Platform | Source | Value |
|---|---|---|
| Android | Major of the Client Hints `platformVersion` when `userAgentData.platform` is `Android`, otherwise `Android <n>` in the user agent | `android:16` |
| iOS | `OS <n>_` in the user agent | `ios:19` |
| Windows | Major of the Client Hints `platformVersion` when `userAgentData.platform` is `Windows` | `windows:15` |

Other platforms, and Windows browsers without Client Hints, give no part.

### rendererModel

The renderer string is `UNMASKED_RENDERER_WEBGL` when the `WEBGL_debug_renderer_info` extension is available, otherwise `RENDERER`. It is cleaned so that two browsers describing one GPU differently give the same value:

1. Trim. If it starts with `ANGLE (`, remove that prefix and the first comma-separated field (the vendor).
2. Remove a trailing ` Direct3D...`, `, OpenGL ES...`, ` vs_...` and a trailing hex device id such as `(0x000046A8)`.
3. If the text ends with `)` and has more closing than opening parentheses, drop the last character.
4. Collapse whitespace, trim, lowercase.

`ANGLE (ARM, Mali-G57 MC2, OpenGL ES 3.2)` and `Mali-G57 MC2` both give `mali-g57 mc2`.

The part is absent when the renderer is hidden: the string is exactly `Apple GPU`, `Mozilla`, `WebKit WebGL` or `WebKit`, or `navigator` has a `brave` property.

### darkMode

`"dark"` when `matchMedia('(prefers-color-scheme: dark)')` matches, otherwise `"light"`.

### localeFormat

Four entries:

1. `Intl.DateTimeFormat().resolvedOptions().timeZone`, or `null`
2. `new Date(Date.UTC(2020, 0, 2, 3, 4, 5)).toLocaleString()`
3. `(1234567.891).toLocaleString()`
4. `hourCycle` from `new Intl.DateTimeFormat(undefined, { hour: 'numeric' }).resolvedOptions()`, or `null`

The inputs are fixed, so the output depends only on the system's settings. Example: `["Europe/Berlin","2.1.2020, 04:04:05","1.234.567,891","h23"]`.

### fonts

Each of 82 candidate font names is tested by measuring text. The candidate list is in `src/collect/fonts.ts` and covers system fonts of the common desktop and mobile platforms, vendor interface fonts, and widely installed office and developer fonts.

The probe text is `mmmmmmmmmmlliWWW` followed by the four Arabic letters U+0639 U+0631 U+0628 U+064A and `123`, set at 72px in a hidden `span`. The text is first measured in `monospace`, `serif` and `sans-serif`. A candidate counts as installed when `'<name>',<generic>` measures a different `offsetWidth` or `offsetHeight` from the generic family alone, for any of the three. The value is the sorted array of installed names.

Candidates are measured four at a time with a yield in between. The probe gives no part when the document has no body, when it runs longer than 3000 ms, or when the overall `collect()` timeout fires.

### audioDisplay

Four entries:

1. `sampleRate` of a new `AudioContext` (or `webkitAudioContext`)
2. `destination.maxChannelCount` of that context
3. The first of `rec2020`, `p3`, `srgb` for which `(color-gamut: <value>)` matches, or `null`
4. The first of `high`, `standard` for which `(dynamic-range: <value>)` matches, or `null`

The context is closed immediately. No audio is played or recorded. Without an `AudioContext` constructor there is no part.

## Traits

Traits travel as plain values. `null` means unknown. The collector sets all requested traits to `null` first and fills in what it can read.

| Trait | Type | Source |
|---|---|---|
| `battery` | integer 0 to 100 | `navigator.getBattery()`, `level` times 100, rounded. The call is given 1000 ms. |
| `os` | `android`, `ios`, `windows`, `cros`, `mac`, `linux`, `other` | First match in the user agent, tested in that order. |
| `platform` | string, at most 32 characters | `navigator.platform` |
| `gpuClass` | `software`, `mobile`, `desktop`, `apple`, `hidden`, `other` | Family of the renderer string, tested in that order. `hidden` when no family matches and the renderer is hidden. |
| `touch` | integer 0 to 256 | `navigator.maxTouchPoints` |
| `pointer` | `coarse`, `fine`, `none` | The first `(pointer: <value>)` media query that matches. |
| `hover` | boolean | `(hover: hover)` |
| `webdriver` | boolean | `navigator.webdriver` |
| `uaPlatform` | string, at most 32 characters | `navigator.userAgentData.platform`, lowercased |
| `emulatorModel` | boolean | Whether the model string matches a list of emulator names. The model text itself is never included. |

`sealReading` keeps `battery` and nothing else. `inspectReading` reads the others to look for contradictions.

## Field evidence

The default weights come from one field deployment: 1,217 distinct browsers over one week, 91% Android, about 8% iOS and about 1% desktop. 68% of readings were taken inside social apps' in-app browsers.

| Part | Distinct values | Two different browsers equal | Same browser, hours apart | In-app and main browser, same device |
|---|---|---|---|---|
| `gpuPixels` | 32 | 12.2% | 100% | 100% |
| `glHardware` | 22 | 20.9% | 100% | 89% |
| `physScreen` | 68 | 11.3% | 100% | 100% |
| `model` | 292 | 0.8% | 100% | 100% |
| `osVersion` | 20 | 12.7% | 99.8% | 97.5% |
| `rendererModel` | 74 | 8.0% | 100% | 96% |
| `fonts` | 19 | 66% | 100% | 99% |
| `darkMode` | 2 | 56% | 99.6% | 71% |
| `audioDisplay` | 8 | 70% | 98.5% | 77% |
| `localeFormat` | 76 | 18% | 100% | 31% |

How to read the columns:

- "Two different browsers equal" is the chance that two different browsers in the population had the same value. These figures are upper bounds, because the different-browser pairs include some people who cleared their cookies and were counted twice.
- "Same browser, hours apart" is 481 pairs, up to 29 hours apart.
- "In-app and main browser" is 121 pairs. They were inferred to be the same device from a hand-off within about a minute on the same network. They were not labelled by hand.

Other measurements from the same deployment:

- With all ten parts, 34% of browsers had at least one other browser identical on every part.
- 84% of readings had all ten parts, 4% missed one and 12% missed two. `model` was present in 84% of readings and `rendererModel` in 88%.
- The collector timed out in 7 of 9,628 readings. None was unsupported.

A separate lab check on two devices, one laptop and one phone, found the GPU image identical across three browsers on each device, including one privacy browser that randomises 2D canvas reads. Two devices do not make a general result.

### What the evidence does not cover

- iOS in any depth, desktop, Firefox and privacy-hardened browsers.
- Drift beyond about a day.
- Two labelled phones of the same model.
- Phones running this package. Its digests were compared with the field-tested collector in Chromium, Chrome and WebKit builds on one desktop machine and were identical for every part.

## Weak spots

| Part | Weak spot |
|---|---|
| `model` | Absent when the browser gives neither Client Hints nor a model in the user agent: iOS, Firefox, and reduced user agents without hints. The user-agent rule does not find a model placed after a locale token (`Android 16; en-us; <model>`). |
| `rendererModel` | Absent when the browser hides the renderer. |
| `gpuPixels` | Dropped when the browser adds noise to reads, when two draws differ, or when the work takes over 1500 ms. A driver update can change the image. |
| `glHardware` | Stayed equal in 89% of in-app and main browser pairs, the lowest of the hardware parts. |
| `physScreen` | On a desktop it follows the monitor the window is on. A resolution change alters it. |
| `osVersion` | Changes on a major OS update. Absent outside Android, iOS and Windows with Client Hints. |
| `fonts` | Web fonts loaded by the page under a candidate name count as installed. Page CSS that applies to `span` can change the measurement. Cancelled after 3000 ms. Only 19 distinct values in the field. |
| `localeFormat` | Stayed equal in only 31% of in-app and main browser pairs. |
| `darkMode`, `audioDisplay` | Few distinct values, and they stayed equal in 71% and 77% of in-app and main browser pairs. |

Two things affect every part:

- A page that defines `Array.prototype.toJSON` changes the output of `JSON.stringify` and therefore every digest.
- Without a secure context there is no `crypto.subtle` and the reading is `unsupported`.

The audio read constructs an `AudioContext` before any user gesture. Some browsers may log an autoplay warning in the console for that. This has not been verified.

## Golden vectors

`test/vectors/recipe-1.json` holds reference inputs and outputs for recipe 1. `tools/make-vectors.mjs` computes them with `node:crypto` and never with the library, so the file is an independent statement of what the recipe produces.

| Section | Entries | Content |
|---|---|---|
| `partDigest` | 22 | `part`, `value`, the exact `json` text and its `digest` |
| `gpuPixels` | 1 | A synthetic 102,400-byte buffer, its `bufferSha256` and the part `digest` |
| `keyed` | 6 | `part`, `clientDigest`, the HMAC `message` and its `digest` |
| `network` | 12 | `ip`, the HMAC `message` (or `null` for invalid input) and its `digest` |
| `normalise` | 49 | Raw input and expected output for every normaliser in `src/collect/values.ts` |

```sh
npm run vectors
```

This recomputes the file and fails if it differs from the stored one. `npm test` checks the library against the same file. Within one recipe the file only grows: existing cases are never edited.

The key used in the vectors is published in that file. Never use it for real data.
