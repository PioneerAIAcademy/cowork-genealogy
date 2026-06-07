import { randomBytes, createHash } from "node:crypto";

export interface PKCEPair {
  codeVerifier: string;
  codeChallenge: string;
}

function toBase64Url(buf: Buffer): string {
  return buf
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

export function generatePKCE(): PKCEPair {
  const codeVerifier = toBase64Url(randomBytes(32));
  const codeChallenge = toBase64Url(
    createHash("sha256").update(codeVerifier).digest()
  );
  return { codeVerifier, codeChallenge };
}

export function generateState(): string {
  return randomBytes(16).toString("hex");
}
