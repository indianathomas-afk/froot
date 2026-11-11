import { PIN_NOT_CONFIGURED, pinEnv, signPinToken, verifyPinToken } from "@/lib/tablet-pin"

// TAB-4 — THE GATE ON EVERY WRITE THAT RECORDS A PERSON (Gary, 2026-11-10).
//
// Applies when the org switch is on AND the login is a STORE login (Q2a), in
// either view: the view is a per-device cookie anyone can flip, the role is not
// (docs/prompts/TAB-4_AUDIT.md, headline finding). Personal logins are never
// asked — the login already records the person.
//
// Callers (docs/prompts/TAB-4_PLAN.md § 2a — the exact list, Q7):
//   POST /api/checklists/[id]/task-log            (tick branch only)
//   POST /api/calendar/occurrences/[id]/complete
// Each calls this AFTER resolving the staff member under CHK-15's rules
// (src/lib/task-log-staff.ts) and BEFORE writing anything.
//
// PURE — no database — so scripts/verify-tab4-pin.ts runs it directly.

export type PinGateCode = "pin_not_configured" | "name_required" | "pin_required"

export type PinGateResult =
  | { ok: true; freshToken: string | null }
  | { ok: false; status: number; code: PinGateCode; error: string }

export const PIN_NAME_REQUIRED =
  "Choose your name and enter your PIN. Team Member and Manager can't be used while PINs are required."
export const PIN_TOKEN_REQUIRED =
  "Your PIN check has run out or doesn't match this name. Enter your PIN again."

export function pinGateApplies(org: { tabletPinRequired: boolean }, role: string | null | undefined): boolean {
  return org.tabletPinRequired && role === "STORE"
}

export function checkPinGate(args: {
  org: { id: string; tabletPinRequired: boolean }
  role: string | null | undefined
  /** The signed-in User row's id (not the Clerk id). */
  userId: string | null | undefined
  storeId: string
  /** The CHK-15-resolved staff id; null = unnamed ("Team Member" / "Manager"). */
  staffId: string | null
  token: unknown
  env?: Record<string, string | undefined>
  now?: number
}): PinGateResult {
  const { org, role, userId, storeId, staffId, token } = args
  if (!pinGateApplies(org, role)) return { ok: true, freshToken: null }

  // FAIL CLOSED (Q4): on, but a secret is gone — refuse, never wave through.
  const env = pinEnv(args.env)
  if (!env.ok) return { ok: false, status: 503, code: "pin_not_configured", error: PIN_NOT_CONFIGURED }

  if (!staffId) return { ok: false, status: 400, code: "name_required", error: PIN_NAME_REQUIRED }
  if (!userId) return { ok: false, status: 403, code: "pin_required", error: PIN_TOKEN_REQUIRED }

  const claims = { staffId, storeId, orgId: org.id, userId }
  const now = args.now ?? Date.now()
  const check = verifyPinToken(token, claims, env.tokenSecret, now)
  if (!check.ok) return { ok: false, status: 403, code: "pin_required", error: PIN_TOKEN_REQUIRED }

  // Q8 SLIDING: every successful write hands back a fresh 10 minutes.
  return { ok: true, freshToken: signPinToken(claims, env.tokenSecret, now) }
}
