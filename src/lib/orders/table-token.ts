/**
 * Signed table tokens — the value a table's QR actually encodes.
 *
 * SECURITY: a table's tab is opened on a plain GET to /menu/<token>. If that
 * segment were the raw label ("5", "Patio-A") anyone could guess it and open /
 * order on a table they're not sitting at, or spray arbitrary labels to litter
 * the floor with phantom tabs. So the QR encodes `<label>.<hmac>` instead: the
 * label is recovered only when the HMAC (keyed by a server-only secret) checks
 * out. A guessed or tampered segment fails verification and opens nothing.
 *
 * The label is NOT secret (it's printed on the card as "Table 5"); the token
 * only proves the URL was minted by us — i.e. that whoever scanned it scanned a
 * real, staff-printed code. Reproducing a valid token still requires physically
 * obtaining that table's QR, which is inherent to any scan-to-order flow.
 *
 * Server-only: pulls SUPABASE... no — its own secret, TABLE_TOKEN_SECRET. Never
 * import from client code (it would try to read a non-PUBLIC env var, which
 * Astro leaves undefined in the browser anyway).
 */
import { createHmac, timingSafeEqual } from "node:crypto";

/** base64url of the HMAC, kept to 128 bits — ample against forgery here. */
const SIG_LEN = 22;

function secret(): string | null {
  const s = import.meta.env.TABLE_TOKEN_SECRET;
  return typeof s === "string" && s.length >= 16 ? s : null;
}

/** True when a signing secret is configured — QR generation needs this. */
export function tableTokensConfigured(): boolean {
  return secret() !== null;
}

function b64url(buf: Buffer): string {
  return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function sign(label: string, key: string): string {
  return b64url(createHmac("sha256", key).update(label).digest()).slice(0, SIG_LEN);
}

/**
 * The QR token for a table label: `<label-b64url>.<sig>`. Throws if no secret is
 * configured (staff must set TABLE_TOKEN_SECRET before printing codes) — failing
 * loudly here beats silently minting unverifiable codes.
 */
export function signTableToken(label: string): string {
  const key = secret();
  if (!key) {
    throw new Error("TABLE_TOKEN_SECRET is not set — cannot mint table QR codes.");
  }
  const clean = label.trim();
  const encoded = b64url(Buffer.from(clean, "utf8"));
  return `${encoded}.${sign(clean, key)}`;
}

/**
 * Recover the table label from a token, or null if it's missing, malformed, or
 * the signature doesn't verify (guessed label, tampered token, or no secret
 * configured → fail closed). Constant-time signature comparison.
 */
export function verifyTableToken(token: string | null | undefined): string | null {
  const key = secret();
  if (!key || !token) return null;

  const dot = token.lastIndexOf(".");
  if (dot <= 0) return null;

  const encoded = token.slice(0, dot);
  const sig = token.slice(dot + 1);

  let label: string;
  try {
    const padded = encoded.replace(/-/g, "+").replace(/_/g, "/");
    label = Buffer.from(padded, "base64").toString("utf8");
  } catch {
    return null;
  }
  if (!label) return null;

  const expected = sign(label, key);
  // Length-guard before timingSafeEqual (it throws on length mismatch).
  if (sig.length !== expected.length) return null;
  const ok = timingSafeEqual(Buffer.from(sig), Buffer.from(expected));
  return ok ? label : null;
}
