# Privacy and security

r-detect is browser fingerprinting. It reads device and browser characteristics without a permission prompt in order to recognise a device. This page states what is collected, what leaves the device, what the key does and does not protect, how readings can be abused, and what the integrator must provide.

The library stores nothing and makes no network request. Transport over HTTPS, storage, access control and deletion are the integrator's.

## What is collected

`collect()` reads ten parts and ten traits. [signals.md](signals.md) lists the exact source of each.

| Kind | Content | Form |
|---|---|---|
| Parts | GPU image, WebGL limits, screen size, device model, OS version, GPU model, dark-mode setting, time zone and locale format, installed fonts, audio and display values | One SHA-256 digest each |
| Traits | Battery level, OS family, `navigator.platform`, GPU class, touch points, pointer type, hover, `navigator.webdriver`, Client Hints platform, whether the model looks like an emulator | Plain values |

Nothing is read that needs a permission prompt. The reads construct and close one `AudioContext`, measure hidden text for the font probe and use two off-screen WebGL canvases. `collect()` writes no cookie and no storage.

## What leaves the device

Only what the integrator's page sends. The reading is plain JSON.

The digests are plain SHA-256 of values with few possible outcomes. Anyone who sees a reading can recover the dark-mode setting, OS version, screen size, device model, GPU model, time zone and locale format, audio and display values and most font sets by hashing the possibilities and comparing. Treat an unsealed reading as personal data, not anonymous data.

The same device produces the same client digests on every site that uses r-detect. An unsealed reading can therefore be matched across sites and systems.

- Do not store, log or share unsealed readings. Seal first and discard the original.
- Keep the request body out of access logs and error reports.

The ten traits travel as plain text. `sealReading` keeps only `battery`. The others are stored only if you store them. `parseReading` cuts `platform` and `uaPlatform` to 32 characters and reduces them to a safe character set. Still escape them when you display them.

## What the key protects

`sealReading` replaces every part digest with an HMAC-SHA256 under your key and derives a keyed digest of the client's network. It uses the address only for that and does not keep it.

The key protects stored values against someone who has the database but not the key: they cannot recover the underlying values by enumeration, and they cannot match your records against other systems.

The key does not:

- protect data in transit,
- make records unlinkable inside your own database, since equal devices still give equal sealed digests,
- protect anything if it leaks together with the data.

The network digest is still personal data. With the key, all IPv4 /24 networks can be enumerated quickly.

Never return sealed digests to clients.

### Key handling

Use a random 32-byte key from a cryptographic generator. Keep it in a secret store. Use a different key per environment.

```sh
node -e "console.log(require('node:crypto').randomBytes(32).toString('base64'))"
```

```js
import { keyFromBase64 } from 'r-detect/server';

const key = keyFromBase64(process.env.R_DETECT_KEY);   // once, at startup
```

`sealReading` refuses keys shorter than 16 bytes. It also accepts a `CryptoKey` imported for HMAC-SHA256 signing.

Changing the key makes earlier sealed readings incomparable with new ones. Give each key a `keyId` when sealing. `bestMatch` then skips readings sealed under another key instead of comparing them as mismatches.

The key in `test/vectors/recipe-1.json` is public. Never use it.

### The client address

Pass `sealReading` the real client address as seen by your trusted edge. A proxy's address or a loopback address would put every visitor on one network. By default `sealReading` returns `network: null` for loopback, unspecified, private, link-local and carrier-internal addresses, which guards the common case of reading the proxy's address by mistake. `allowPrivateNetworks: true` turns that guard off for deployments where such addresses really are the clients'.

Never take the address from a header the client can set.

## Forgery and abuse

A reading is supplied by the client. It can be forged, copied from another device or replayed. Any website can compute a visitor's reading, so a reading is not a secret that only the device knows.

A score is evidence about cooperative browsers, never proof of identity. Do not use a match:

- as a login factor,
- to skip a verification step,
- as the sole ground for an irreversible action.

Both corroboration signals can be influenced by the client. The battery level is client-supplied. A network can be crowded or avoided. A hostile client can:

- stay below `strong` by omitting the battery level and changing network,
- reach `strong` against a stranger with the same model by submitting many readings with different battery values. With the default tolerance of 2, about 21 readings cover every level.

Where clients may be hostile, set `weights.battery` to 0 and decide deliberately how to treat `similar`.

`inspectReading` catches careless automation only. A client that omits traits or sends consistent false ones raises no finding. An empty findings list is not a clean result.

Read `corroborated` together with `coverage`. Low coverage means "could not tell", not "different device". A corroborated result with coverage 0 only says that two requests shared a network.

## Integrator checklist

Input:

- Limit the request body size before parsing it.
- Pass every client reading through `parseReading` and reject `null`.
- Seal with `sealReading`, then discard the unsealed reading.
- Keep request bodies out of access logs and error reports.

Address and key:

- Take the client address from your trusted edge, never from a client-set header.
- Generate a random 32-byte key, keep it in a secret store, and use a different one per environment.
- Set a `keyId` and change it whenever the key changes.
- Never return sealed digests to clients.

Abuse:

- Rate limit the endpoint that receives readings, per address, account and network.
- Add a bot check where abuse matters.
- Cap the number of stored readings per account.
- Set `weights.battery` to 0 where clients may be hostile.
- Do not let a match alone trigger an irreversible action.

Data:

- Serve the page and the endpoint over HTTPS.
- Restrict access to stored readings.
- Set a retention period and delete sealed readings when it ends.
- Tell users what is collected and why, as the law that applies to you requires.

## Legal notice

In some jurisdictions, reading information from a user's device for this purpose requires disclosure and may require consent. Examples are the EU and UK rules on reading information from a user's device, and data-protection law. Deciding whether that applies to your use, and informing users, is the integrator's responsibility.

This page is not legal advice.
