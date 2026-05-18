import { createHash, randomBytes } from "node:crypto";

const VERIFIER_CHARS =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~";

/** RFC 7636 code verifier (43–128 unreserved characters). */
export function generateCodeVerifier(): string {
  const bytes = randomBytes(32);
  let verifier = "";
  for (let i = 0; i < bytes.length; i += 1) {
    verifier += VERIFIER_CHARS[bytes[i]! % VERIFIER_CHARS.length];
  }
  while (verifier.length < 43) {
    verifier += VERIFIER_CHARS[randomBytes(1)[0]! % VERIFIER_CHARS.length];
  }
  return verifier.slice(0, 128);
}

/** S256 code challenge from verifier. */
export function codeChallengeFromVerifier(verifier: string): string {
  return createHash("sha256")
    .update(verifier)
    .digest("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

export function generateOAuthState(): string {
  return randomBytes(24).toString("base64url");
}
