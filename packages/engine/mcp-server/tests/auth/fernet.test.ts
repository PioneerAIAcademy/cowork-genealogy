import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import { decrypt, encrypt } from "../../src/auth/fernet.js";

// The shared vector. `apps/server/tests/test_proto_grants.py` reads this same
// file and decrypts it with `grants.decrypt`; this file decrypts it with
// `src/auth/fernet.ts`. It was generated ONCE by Python, because
// `cryptography.fernet` is the reference implementation and this module has to
// agree with it, not the other way round.
//
// NEITHER SIDE MAY REGENERATE IT. A vector one side rewrites when it disagrees
// is not a cross-language check, it is a loopback: the two implementations
// could drift together and both suites would stay green. If this fails, the
// implementation is wrong, not the fixture.
const VECTOR = JSON.parse(
  readFileSync(join(import.meta.dirname, "../fixtures/fernet-vector.json"), "utf-8"),
) as { key: string; plaintext: string; token: string };

describe("fernet decrypt agrees with Python's cryptography.fernet", () => {
  it("decrypts the shared vector", () => {
    expect(decrypt(VECTOR.token, VECTOR.key)).toBe(VECTOR.plaintext);
  });

  it("carries non-ASCII through as utf-8", () => {
    // The vector's plaintext is deliberately non-ASCII: a latin-1 or ascii
    // decode on either side would pass every ASCII token and corrupt real
    // FamilySearch tokens only in production.
    expect(VECTOR.plaintext).not.toMatch(/^[\x00-\x7f]*$/);
    expect(decrypt(VECTOR.token, VECTOR.key)).toBe(VECTOR.plaintext);
  });
});

describe("fernet decrypt soft-fails rather than throwing", () => {
  // grants.decrypt returns None on anything undecryptable and callers treat
  // that as "refuse". A throw here would be a 500 at the door instead of a 401.
  it.each([
    ["another key", () => decrypt(VECTOR.token, "a-different-key-entirely")],
    ["not base64 at all", () => decrypt("!!!not base64!!!", VECTOR.key)],
    ["empty string", () => decrypt("", VECTOR.key)],
    ["null", () => decrypt(null, VECTOR.key)],
    ["undefined", () => decrypt(undefined, VECTOR.key)],
    ["a plaintext value never encrypted", () => decrypt("fs-access-token", VECTOR.key)],
  ])("answers null for %s", (_label, run) => {
    expect(run()).toBeNull();
  });

  it("answers null for a token whose version byte is not 0x80", () => {
    const raw = Buffer.from(VECTOR.token, "base64url");
    raw[0] = 0x79;
    expect(decrypt(raw.toString("base64url"), VECTOR.key)).toBeNull();
  });

  it("answers null for a token one byte short of the overhead", () => {
    // 1 + 8 + 16 + 32 = 57. Below that the subarrays would overlap and the HMAC
    // would be compared against bytes that are also the ciphertext.
    const short = Buffer.alloc(56, 0x80);
    expect(decrypt(short.toString("base64url"), VECTOR.key)).toBeNull();
  });

  it("answers null when the ciphertext is tampered with but the length is right", () => {
    const raw = Buffer.from(VECTOR.token, "base64url");
    // Flip a bit inside the ciphertext, leaving version, timestamp, IV and the
    // HMAC's own bytes intact: only the HMAC check can catch this.
    raw[30] ^= 0x01;
    expect(decrypt(raw.toString("base64url"), VECTOR.key)).toBeNull();
  });

  it("answers null when the HMAC is tampered with", () => {
    const raw = Buffer.from(VECTOR.token, "base64url");
    raw[raw.length - 1] ^= 0x01;
    expect(decrypt(raw.toString("base64url"), VECTOR.key)).toBeNull();
  });
});

describe("fernet encrypt (tests and dev/ only)", () => {
  it("round-trips, and a second encryption of one plaintext differs", () => {
    const token = encrypt("seeded-token", VECTOR.key);
    expect(decrypt(token, VECTOR.key)).toBe("seeded-token");
    // Random IV per call — which is why the shared vector is checked by
    // DECRYPTING a fixed token, never by re-encrypting and comparing.
    expect(encrypt("seeded-token", VECTOR.key)).not.toBe(token);
  });

  // The Node-only round trip above passes with or without padding, so it is
  // NOT what proves Python can read these. This is: Python's Fernet decodes
  // with `base64.urlsafe_b64decode`, which REQUIRES correct padding and raises
  // without it. Node's `toString("base64url")` strips it, so an unpadded token
  // is one `cryptography` cannot read at all -- caught only by encrypting in
  // Node and decrypting in Python, which the first version of this module
  // failed.
  it("pads to a multiple of 4, which Python's urlsafe_b64decode requires", () => {
    for (const plaintext of ["a", "ab", "abc", "abcd", "x".repeat(31), "x".repeat(32)]) {
      const token = encrypt(plaintext, VECTOR.key);
      expect(token.length % 4, `'${plaintext.slice(0, 8)}' is not padded`).toBe(0);
      expect(decrypt(token, VECTOR.key)).toBe(plaintext);
    }
    // The committed vector, written by Python, is padded the same way.
    expect(VECTOR.token.length % 4).toBe(0);
  });

  it("produces a token Python's decrypt can read (the smoke's seeding path)", () => {
    // Asserted on the Python side by test_proto_grants.py, which re-reads the
    // fixture; here we can only pin the shape it must have.
    const raw = Buffer.from(encrypt("seeded-token", VECTOR.key), "base64url");
    expect(raw[0]).toBe(0x80);
    expect(raw.length).toBeGreaterThanOrEqual(57);
  });
});
