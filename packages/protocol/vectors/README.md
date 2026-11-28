# Protocol test vectors (v5)

Generated from `src/vectors.ts` with `npm run vectors -w @mirror-studio/protocol`. Do not edit by hand:
`src/vectors.test.ts` fails when these files differ from what the generator produces, and checks every case
against the zod schemas. The Kotlin client must pass the same cases.

## Message files

`session.json`, `control.json`, `pairing.json`, `slides.json`, `pointer-ink.json`, `messaging.json`, `hand.json`,
`polls.json`, `files.json`, `media.json`:

```jsonc
{
  "protocolVersion": 5,
  "area": "messaging",
  "valid": [
    // dir: which parser accepts it
    //   "handshake" = plain JSON before the handshake (info, hello, hello-reply, confirm, confirm-ok, reject)
    //   "client"    = client -> host, encrypted
    //   "server"    = host -> client, encrypted
    // parsed: present only when parsing changes the message (defaults filled in), e.g. present-start gets source "screen"
    { "name": "…", "dir": "client", "message": { "t": "…" }, "parsed": { } }
  ],
  "invalid": [
    // must be rejected by the parser of `dir`; `why` is informative only
    { "name": "…", "dir": "client", "message": { }, "why": "…" }
  ],
  "frames": { }   // only in files.json and media.json, see below
}
```

The host still applies permission rules on top of a schema-valid message (for example a `javascript:` link
parses but the host rejects it).

### Binary frames

`files.json` → `frames`:

- `valid[]`: `{ name, fileId, index, count, payloadHex, frameHex }`. Encoding the fields must give `frameHex`;
  parsing `frameHex` must give the fields back.
- `invalid[]`: `{ name, frameHex, why }`. Parsing must fail.

Layout: `[FILE_TAG=0x02 u8][fileId u32 BE][index u32 BE][count u32 BE][payload ≤ 49152]` (13-byte header).

`media.json` → `frames.valid[]`: `{ name, stream, seq, frameHex, pieces[] }` (MEDIA_TAG pieces, hex).

## handshake.json

A full handshake with fixed private keys, nonces, salt and code (production PBKDF2 cost, 200 000 iterations):

- `inputs`: code (as typed and normalized), iterations, `saltB64`, name, device, caps, both raw X25519 private keys
  (hex) and both nonces (`…B64`).
- `messages`: the exact `hello`, `helloReply`, `confirm`, `confirmOk` JSON objects on the wire.
- `derived`: public keys, `codeKey`, `dh`, `transcriptInput` (the JSON string hashed after `"MS2"`), `transcript`,
  `c2hKey`, `h2cKey`, `confirmKey`, `clientMac`, `hostMac` (hex).
- `sealed[]`: one frame each way, `{ direction, counter, keyHex, nonceHex, plaintext, frameHex }`.

The `$doc` field in the file spells out every formula.
