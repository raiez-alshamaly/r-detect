# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html). The hashing recipe has its own version number, `RECIPE`. See the Versioning section of the README.

## [0.1.0] - 2026-11-12

### Added

- `r-detect`: `collect()` reads ten hashed parts (`gpuPixels`, `glHardware`, `physScreen`, `model`, `osVersion`, `rendererModel`, `darkMode`, `localeFormat`, `fonts`, `audioDisplay`) and ten plain traits. It never rejects, and reports `ok`, `timeout` or `unsupported`.
- `collect()` options: `parts`, `traits`, `schedule` (`'idle'` or `'now'`), `timeoutMs` (default 20000) and `timings`.
- Hashing recipe 1: each part digest is the SHA-256 of `JSON.stringify([part, value])`. `RECIPE` is carried in every reading.
- `r-detect/score`: `compare()` returns a score from 0 to 100, a band (`none`, `weak`, `similar`, `strong`), `corroborated`, `coverage`, per-part states and a list of reasons that sum to the score.
- `mode: 'crossBrowser'`, which ignores `darkMode`, `localeFormat` and `audioDisplay`.
- `pairContext()` for same-network, battery and time facts about a pair, and `resolveScoring()` to merge and validate weights, limits and bands.
- `DEFAULT_WEIGHTS`, `DEFAULT_LIMITS` and `DEFAULT_BANDS`. Part weights are log-likelihood ratios measured on a field deployment of 1,217 browsers.
- `r-detect/server`: `parseReading()` validates untrusted input, `inspectReading()` reports contradictory traits, missing parts and thin readings, and `sealReading()` re-hashes part digests with HMAC-SHA256 under a secret key and derives a keyed network digest from the client address.
- `bestMatch()` compares one sealed reading with a list of candidates, with a crowd rule for shared networks and skipping of candidates sealed under another recipe or `keyId`.
- `keyedDigest()`, `networkKey()` (IPv4 /24, IPv6 /48) and `keyFromBase64()`.
- Golden vectors for recipe 1 in `test/vectors/recipe-1.json`, checked by `npm run vectors`.
- A browser harness page, served by `npm run harness`.
- Documentation: `docs/signals.md`, `docs/scoring.md` and `docs/privacy.md`.

[0.1.0]: https://github.com/raiez-alshamaly/r-detect/releases/tag/v0.1.0
