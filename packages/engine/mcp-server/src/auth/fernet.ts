// Fernet, the half of it this server needs: decrypting the FamilySearch access
// token and the OpenRouter key the web tier wrote (self-hosted beta E1).
//
// Not a general Fernet library and not a dependency: ~60 lines of `node:crypto`
// against a spec that has not changed since 2013, versus a package in the
// production tree of an artifact that ships to desktops. The ONE thing that
// matters is that it agrees with Python's `cryptography.fernet` byte for byte,
// which is pinned by a vector both suites read (`tests/fixtures/fernet-vector.json`
// — `apps/server/tests/test_proto_grants.py` decrypts it with `grants.decrypt`,
// `tests/auth/fernet.test.ts` with this module). Neither side may regenerate it.
//
// The key derivation is the alpha's, mirrored from `apps/server/proto/grants.py`
// `fernet()`: urlsafe-base64 of the sha256 of the configured string, so any
// strong random value works as the key. All tiers must agree byte for byte.
//
// No TTL is applied, because `grants.decrypt` passes none.

import { createDecipheriv, createCipheriv, createHmac, createHash, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * The development key, byte for byte the same string as
 * `apps/server/proto/grants.py`'s `DEV_FS_TOKEN_ENC_KEY`. Compose passes
 * `\${FS_TOKEN_ENC_KEY:-}` to web and worker, so every tier must fall back to
 * the SAME value or they encrypt under different keys and read each other as
 * undecryptable. Public in this repository on purpose, which is why an https
 * issuer refuses to start on it (`src/http.ts`).
 */
export const DEV_FS_TOKEN_ENC_KEY = "dev-insecure-fs-token-key-change-me";

/** 0x80. The only version `cryptography.fernet` writes or accepts. */
const VERSION = 0x80;
const VERSION_LEN = 1;
const TIMESTAMP_LEN = 8;
const IV_LEN = 16;
const HMAC_LEN = 32;
/** Everything but the ciphertext: a token shorter than this cannot be one. */
const OVERHEAD = VERSION_LEN + TIMESTAMP_LEN + IV_LEN + HMAC_LEN;

/** The 32 key bytes: the first 16 sign, the last 16 encrypt (Fernet's split). */
function keyBytes(key: string): { signing: Buffer; encryption: Buffer } {
  // grants.py: Fernet(urlsafe_b64encode(sha256(key.encode()).digest())).
  // That base64 string IS the Fernet key; decoding it returns the same 32 bytes
  // the sha256 produced, so derive them directly rather than round-tripping.
  const raw = createHash("sha256").update(key, "utf8").digest();
  return { signing: raw.subarray(0, 16), encryption: raw.subarray(16, 32) };
}

/**
 * The plaintext, or `null` when the value was written under another key, is not
 * a Fernet token at all, or fails its HMAC.
 *
 * Soft-fails like `grants.decrypt`, and for the same reason: a caller treats
 * `null` as undecryptable and refuses. **Never use a null as plaintext.**
 */
export function decrypt(value: string | null | undefined, key: string): string | null {
  if (typeof value !== "string" || value === "") return null;

  let token: Buffer;
  try {
    token = Buffer.from(value, "base64url");
  } catch {
    return null;
  }
  // A short buffer would make the subarrays below overlap and the HMAC compare
  // against the wrong bytes, so length is checked before anything is read.
  if (token.length < OVERHEAD) return null;
  if (token[0] !== VERSION) return null;

  const signed = token.subarray(0, token.length - HMAC_LEN);
  const mac = token.subarray(token.length - HMAC_LEN);
  const { signing, encryption } = keyBytes(key);

  // Verified BEFORE decrypting: the HMAC is what says these bytes are ours, and
  // feeding unauthenticated ciphertext to the cipher is the padding-oracle
  // shape. Constant-time, so a wrong key leaks nothing through timing.
  const expected = createHmac("sha256", signing).update(signed).digest();
  if (expected.length !== mac.length || !timingSafeEqual(expected, mac)) return null;

  const iv = token.subarray(VERSION_LEN + TIMESTAMP_LEN, VERSION_LEN + TIMESTAMP_LEN + IV_LEN);
  const ciphertext = token.subarray(VERSION_LEN + TIMESTAMP_LEN + IV_LEN, token.length - HMAC_LEN);
  // No TTL: the timestamp is authenticated by the HMAC above and then ignored,
  // as `grants.decrypt` ignores it.
  try {
    const decipher = createDecipheriv("aes-128-cbc", encryption, iv);
    const out = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    return out.toString("utf8");
  } catch {
    // Bad PKCS7 padding on a token whose HMAC somehow verified; not reachable
    // with a correct key, and still not plaintext.
    return null;
  }
}

/**
 * The inverse, for TESTS AND `dev/` ONLY — the smoke seeds an encrypted
 * FamilySearch token (`dev/smoke-http.ts`), and the shared vector is checked by
 * decrypting, never by re-encrypting (CBC+IV means two encryptions of one
 * plaintext differ, so a round-trip proves nothing about agreeing with Python).
 *
 * Nothing in `src/` outside this module calls it: the server only ever reads
 * what the web tier wrote.
 */
export function encrypt(plaintext: string, key: string, now: Date = new Date()): string {
  const { signing, encryption } = keyBytes(key);
  const iv = randomBytes(IV_LEN);

  const timestamp = Buffer.alloc(TIMESTAMP_LEN);
  timestamp.writeBigUInt64BE(BigInt(Math.floor(now.getTime() / 1000)));

  const cipher = createCipheriv("aes-128-cbc", encryption, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);

  const signed = Buffer.concat([Buffer.from([VERSION]), timestamp, iv, ciphertext]);
  const mac = createHmac("sha256", signing).update(signed).digest();
  // PADDED urlsafe base64. Node's "base64url" strips the `=`, but Python's
  // Fernet decodes with `base64.urlsafe_b64decode`, which REQUIRES correct
  // padding and raises without it -- so an unpadded token is one `cryptography`
  // cannot read at all. Decrypting is unaffected (Node tolerates both), which
  // is exactly why this only shows up encrypting: the Node-only round trip in
  // the test below passes either way.
  const raw = Buffer.concat([signed, mac]).toString("base64url");
  return raw + "=".repeat((4 - (raw.length % 4)) % 4);
}
