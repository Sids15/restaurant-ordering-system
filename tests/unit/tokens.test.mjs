/**
 * UNIT — the two secrets a guest's device carries.
 *
 * A signed table token says "this QR was printed by us"; a session token says
 * "this device belongs to that tab". Both are the whole of the guest-side
 * security model, so they get tested as adversarially as a unit test can:
 * forged signatures, truncated tokens, swapped labels, and the encoding tricks
 * that turn a validator into a decorative one.
 *
 * Mirrors src/lib/orders/table-token.ts and the hashing in tabs.ts, with the
 * mirror pinned to the source the way money.test.mjs is.
 */
import { readFileSync } from "node:fs";
import { createHmac, createHash, timingSafeEqual } from "node:crypto";
import { suite, is, ok, isNot, note, finish } from "../harness.mjs";

const TOKEN_SRC = readFileSync("src/lib/orders/table-token.ts", "utf8");
const TABS_SRC = readFileSync("src/lib/orders/tabs.ts", "utf8");

suite("UNIT · table tokens and session tokens");

// --- The mirror is honest ----------------------------------------------------
const SIG_LEN = Number(/const SIG_LEN = (\d+)/.exec(TOKEN_SRC)?.[1]);
is("mirror's signature length matches the source", SIG_LEN, 22);
ok(
  "the source still compares signatures in constant time",
  TOKEN_SRC.includes("timingSafeEqual"),
  "table-token.ts stopped using timingSafeEqual — a byte-by-byte compare leaks the signature",
);
ok(
  "the source still fails closed with no secret",
  /if \(!key \|\| !token\) return null;/.test(TOKEN_SRC),
  "verifyTableToken no longer returns null when unconfigured",
);
ok(
  "session tokens are stored as a SHA-256 hash",
  /createHash\("sha256"\)/.test(TABS_SRC),
  "tabs.ts is not hashing session tokens",
);
ok(
  "session tokens are 24 random bytes",
  /new Uint8Array\(24\)/.test(TABS_SRC) && /crypto\.getRandomValues/.test(TABS_SRC),
  "session token entropy changed",
);

// --- The mirror --------------------------------------------------------------
const SECRET = "test-secret-at-least-sixteen-chars-long";
const b64url = (buf) =>
  buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const sign = (label, key) =>
  b64url(createHmac("sha256", key).update(label).digest()).slice(0, SIG_LEN);

function signTableToken(label, key = SECRET) {
  const clean = label.trim();
  return `${b64url(Buffer.from(clean, "utf8"))}.${sign(clean, key)}`;
}

function verifyTableToken(token, key = SECRET) {
  if (!key || !token) return null;
  const dot = token.lastIndexOf(".");
  if (dot <= 0) return null;
  const encoded = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  let label;
  try {
    label = Buffer.from(encoded.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8");
  } catch {
    return null;
  }
  if (!label) return null;
  const expected = sign(label, key);
  if (sig.length !== expected.length) return null;
  return timingSafeEqual(Buffer.from(sig), Buffer.from(expected)) ? label : null;
}

// --- Round trip --------------------------------------------------------------
for (const label of ["5", "12", "Patio", "Patio A", "Table 1", "बाहर", "A-7"]) {
  is(`"${label}" survives a round trip`, verifyTableToken(signTableToken(label)), label);
}

// --- Forgery -----------------------------------------------------------------
note("everything below is an attempt to open a table without the secret");

const good = signTableToken("5");
const [encoded, signature] = good.split(".");

is("a guessed raw label opens nothing", verifyTableToken("5"), null);
is("a plausible-looking label opens nothing", verifyTableToken("Table5"), null);
is("no signature at all", verifyTableToken(encoded), null);
is("an empty signature", verifyTableToken(`${encoded}.`), null);
is("a wrong signature of the right length", verifyTableToken(`${encoded}.${"A".repeat(SIG_LEN)}`), null);
is("a truncated signature", verifyTableToken(`${encoded}.${signature.slice(0, -1)}`), null);
is("an extended signature", verifyTableToken(`${encoded}.${signature}A`), null);
is("a flipped character in the signature", verifyTableToken(`${encoded}.${(signature[0] === "A" ? "B" : "A") + signature.slice(1)}`), null);

// The interesting one: take a valid signature for table 5 and staple it to a
// different label. This is what a guest who wants someone else's bill tries.
const other = b64url(Buffer.from("12", "utf8"));
is("another table's label with this table's signature", verifyTableToken(`${other}.${signature}`), null);

// And a token minted with a different secret — a stale printed QR from before a
// rotation, or one made by someone who does not have the key.
is("a token signed with a different secret", verifyTableToken(signTableToken("5", "a-completely-different-secret")), null);

is("nothing", verifyTableToken(""), null);
is("null", verifyTableToken(null), null);
is("a bare dot", verifyTableToken("."), null);
is("only a dot and a signature", verifyTableToken(`.${signature}`), null);
is("garbage", verifyTableToken("../../etc/passwd"), null);

// With no secret configured, verification must refuse everything rather than
// accept anything — a misconfigured server should not become an open door.
is("with no secret, a valid token still fails", verifyTableToken(good, ""), null);

// --- Session tokens ----------------------------------------------------------
const hashSessionToken = (t) => createHash("sha256").update(t).digest("hex");
const newToken = () => {
  const bytes = new Uint8Array(24);
  globalThis.crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
};

const t1 = newToken();
is("a session token is 48 hex characters (192 bits)", t1.length, 48);
ok("it is hex", /^[0-9a-f]+$/.test(t1), t1);

// 500 tokens, no collisions — a weak generator shows up here.
const many = new Set(Array.from({ length: 500 }, newToken));
is("500 tokens are all distinct", many.size, 500);

const h = hashSessionToken(t1);
is("the hash is 64 hex characters", h.length, 64);
is("hashing is deterministic", hashSessionToken(t1), h);
isNot("the hash is not the token", h, t1);
isNot("a different token hashes differently", hashSessionToken(newToken()), h);

// The property the whole change rests on: what is stored cannot be replayed.
ok(
  "the stored value cannot be used as a token",
  hashSessionToken(h) !== h,
  "hashing the stored hash returns it — that would make the stored value a working credential",
);

finish();
