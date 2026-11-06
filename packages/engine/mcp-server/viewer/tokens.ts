// Signed links to one page image. The key lives only in this process, so a
// restart voids every link, and a link names one image for ten minutes.
import { createHmac, timingSafeEqual } from "node:crypto";

/** Electron's IMAGE_REF_PATTERN. */
export const IMAGE_REF_PATTERN = /^images\/[A-Za-z0-9._-]+\.jpg$/;
export const IMAGE_TOKEN_TTL_MS = 10 * 60_000;

export interface ImageClaim {
  /** The project's path relative to the root. */
  rel: string;
  ref: string;
  expiresAt: number;
}

export interface ImageTokens {
  sign(rel: string, ref: string): { token: string; expiresAt: number };
  /** The claim of a token with a good signature that has not expired, else null. */
  verify(token: string): ImageClaim | null;
}

export function imageTokens(key: Uint8Array, now: () => number): ImageTokens {
  const mac = (payload: string): string => createHmac("sha256", key).update(payload).digest("base64url");
  return {
    sign(rel, ref) {
      const expiresAt = now() + IMAGE_TOKEN_TTL_MS;
      const claim: ImageClaim = { rel, ref, expiresAt };
      const payload = Buffer.from(JSON.stringify(claim), "utf8").toString("base64url");
      return { token: `${payload}.${mac(payload)}`, expiresAt };
    },
    verify(token) {
      const [payload, signature, ...extra] = token.split(".");
      if (!payload || !signature || extra.length > 0) return null;
      const given = Buffer.from(signature, "utf8");
      const wanted = Buffer.from(mac(payload), "utf8");
      if (given.length !== wanted.length || !timingSafeEqual(given, wanted)) return null;
      const claim = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as ImageClaim;
      return now() < claim.expiresAt ? claim : null;
    },
  };
}
