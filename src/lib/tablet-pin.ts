import { createHmac, randomBytes, scrypt as scryptCb, timingSafeEqual, type ScryptOptions } from "node:crypto"

// ─── TAB-4: per-person PIN on shared tablets (Gary, 2026-11-10) ──────────────
// docs/prompts/TAB-4_AUDIT.md, docs/prompts/TAB-4_PLAN.md.
//
// Node's built-in crypto only — no dependency (prompt § 5). Pure functions with
// an injectable clock, so scripts/verify-tab4-pin.ts drives every edge.
//
// TWO SECRETS, KEPT APART ON PURPOSE (Gary, Q4):
//
//   TABLET_PIN_PEPPER    mixed into every PIN hash. ROTATING IT INVALIDATES
//                        EVERY PIN IN EVERY ORG — every staff member then needs a
//                        manager to set a new one. Do not rotate it casually.
//   TABLET_TOKEN_SECRET  signs the 10-minute PIN token. Rotating it only ends
//                        the sessions open at that moment.
//
// EITHER MISSING = FAIL CLOSED. The /settings switch shows "not configured" and
// refuses to turn on, and while it is already on every PIN-required write and
// the verify route answer 503. A missing var never skips the check.

export const PIN_LENGTH = 4
export const PIN_RE = /^\d{4}$/
/** Q9: 5 wrong PINs lock that staff member for 5 minutes. */
export const PIN_MAX_ATTEMPTS = 5
export const PIN_LOCK_MS = 5 * 60 * 1000
/** Q8: the token lasts 10 minutes, renewed by every successful write. */
export const PIN_TOKEN_TTL_MS = 10 * 60 * 1000

export const PIN_NOT_CONFIGURED =
  "PINs aren't set up in this environment yet, so nothing can be recorded by name. Ask an admin."

export type PinEnv = { ok: true; pepper: string; tokenSecret: string } | { ok: false; missing: string[] }

/** Reads both secrets. `env` is injectable for the fixture. */
export function pinEnv(env: Record<string, string | undefined> = process.env): PinEnv {
  const pepper = env.TABLET_PIN_PEPPER?.trim() ?? ""
  const tokenSecret = env.TABLET_TOKEN_SECRET?.trim() ?? ""
  const missing = [!pepper && "TABLET_PIN_PEPPER", !tokenSecret && "TABLET_TOKEN_SECRET"].filter(
    (m): m is string => !!m
  )
  return missing.length ? { ok: false, missing } : { ok: true, pepper, tokenSecret }
}

// ─── Hashing ──────────────────────────────────────────────────────────────────

const SCRYPT = { N: 16384, r: 8, p: 1, keylen: 32 } as const

function scrypt(password: Buffer, salt: Buffer, keylen: number, opts: ScryptOptions): Promise<Buffer> {
  return new Promise((resolve, reject) =>
    scryptCb(password, salt, keylen, opts, (err, key) => (err ? reject(err) : resolve(key)))
  )
}

/** The pepper is mixed in by HMAC first, so a leaked database alone cannot be
 *  brute-forced across the 10,000 possible PINs. */
function peppered(pin: string, pepper: string): Buffer {
  return createHmac("sha256", pepper).update(pin).digest()
}

/** "scrypt$N$r$p$salt$hash" — parameters travel with the hash, so they can be
 *  raised later without a migration. */
export async function hashPin(pin: string, pepper: string): Promise<string> {
  if (!PIN_RE.test(pin)) throw new Error("A PIN is exactly 4 digits")
  const salt = randomBytes(16)
  const key = await scrypt(peppered(pin, pepper), salt, SCRYPT.keylen, { N: SCRYPT.N, r: SCRYPT.r, p: SCRYPT.p })
  return ["scrypt", SCRYPT.N, SCRYPT.r, SCRYPT.p, salt.toString("base64"), key.toString("base64")].join("$")
}

/** Constant-time compare (crypto.timingSafeEqual). A malformed stored value is
 *  a mismatch, never a throw. */
export async function verifyPinHash(pin: string, stored: string, pepper: string): Promise<boolean> {
  if (!PIN_RE.test(pin)) return false
  const parts = stored.split("$")
  if (parts.length !== 6 || parts[0] !== "scrypt") return false
  const [N, r, p] = parts.slice(1, 4).map(Number)
  if (![N, r, p].every((n) => Number.isInteger(n) && n > 0)) return false
  const salt = Buffer.from(parts[4], "base64")
  const expected = Buffer.from(parts[5], "base64")
  if (salt.length === 0 || expected.length === 0) return false
  const actual = await scrypt(peppered(pin, pepper), salt, expected.length, { N, r, p })
  return actual.length === expected.length && timingSafeEqual(actual, expected)
}

// ─── The token ────────────────────────────────────────────────────────────────
// base64url(payload).base64url(HMAC-SHA256(payload)). Never stored; expiry is
// the only revocation. Bound to the person, the store, the org AND the login
// (Q8), so it cannot be replayed for someone else, somewhere else, or from
// another account.

export type PinTokenClaims = { staffId: string; storeId: string; orgId: string; userId: string }
type Payload = { s: string; st: string; o: string; u: string; exp: number }

function b64url(buf: Buffer): string {
  return buf.toString("base64url")
}

function sign(body: string, secret: string): Buffer {
  return createHmac("sha256", secret).update(body).digest()
}

export function signPinToken(claims: PinTokenClaims, secret: string, now: number = Date.now()): string {
  const payload: Payload = { s: claims.staffId, st: claims.storeId, o: claims.orgId, u: claims.userId, exp: now + PIN_TOKEN_TTL_MS }
  const body = b64url(Buffer.from(JSON.stringify(payload)))
  return `${body}.${b64url(sign(body, secret))}`
}

export type PinTokenCheck = { ok: true } | { ok: false; reason: "missing" | "malformed" | "signature" | "expired" | "mismatch" }

/** Signature (crypto.timingSafeEqual), then expiry, then EVERY claim —
 *  person, store, org and login. A valid signature alone proves nothing. */
export function verifyPinToken(
  token: unknown,
  expected: PinTokenClaims,
  secret: string,
  now: number = Date.now()
): PinTokenCheck {
  if (typeof token !== "string" || token === "") return { ok: false, reason: "missing" }
  const parts = token.split(".")
  if (parts.length !== 2 || !parts[0] || !parts[1]) return { ok: false, reason: "malformed" }
  const [body, sig] = parts
  const want = sign(body, secret)
  const got = Buffer.from(sig, "base64url")
  if (got.length !== want.length || !timingSafeEqual(got, want)) return { ok: false, reason: "signature" }

  let payload: Payload
  try {
    payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as Payload
  } catch {
    return { ok: false, reason: "malformed" }
  }
  if (typeof payload?.exp !== "number" || payload.exp <= now) return { ok: false, reason: "expired" }
  if (
    payload.s !== expected.staffId ||
    payload.st !== expected.storeId ||
    payload.o !== expected.orgId ||
    payload.u !== expected.userId
  ) {
    return { ok: false, reason: "mismatch" }
  }
  return { ok: true }
}

/** Minutes left on a lock, rounded up, for the refusal sentence. */
export function lockMinutesLeft(lockedUntil: Date, now: number = Date.now()): number {
  return Math.max(1, Math.ceil((lockedUntil.getTime() - now) / 60000))
}
