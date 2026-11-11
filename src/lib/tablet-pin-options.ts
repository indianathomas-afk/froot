// TAB-4 (Gary, 2026-11-10) — THE "WHO" LIST, ONE DEFINITION FOR EVERY SCREEN.
//
// Client-safe and pure (no crypto, no database), so the tablet name sheet, the
// desktop "Who completed this task?" picker, the due banner and the calendar
// detail all build the same list, and scripts/verify-tab4-pin.ts tests it.
//
// SWITCH OFF, or a personal login: exactly today's list — "Team Member" and
// "Manager" (both send "manager", saved as no name), then the store's ACTIVE
// staff by name. SWITCH ON and a STORE login (`pinRequired`):
//   Q7 — the two generic options are HIDDEN;
//   Q6 — a person with no PIN is shown greyed out with "No PIN — ask a
//        manager" and cannot be picked.

export type PinStaff = { id: string; displayName: string; hasPin: boolean }

export type WhoOption = {
  key: string
  /** What goes in `completedByStaffId`. */
  id: string
  label: string
  /** Q6 — shown but not pickable. */
  disabled?: boolean
  note?: string
  /** True for "Team Member" / "Manager". */
  generic?: boolean
}

export const GENERIC_WHO: WhoOption[] = [
  { key: "generic:team", id: "manager", label: "Team Member", generic: true },
  { key: "generic:manager", id: "manager", label: "Manager", generic: true },
]

export const NO_PIN_NOTE = "No PIN — ask a manager"

export function whoOptions(staff: PinStaff[], pinRequired: boolean): WhoOption[] {
  const people = staff.map((s): WhoOption => {
    if (pinRequired && !s.hasPin) return { key: s.id, id: s.id, label: s.displayName, disabled: true, note: NO_PIN_NOTE }
    return { key: s.id, id: s.id, label: s.displayName }
  })
  return pinRequired ? people : [...GENERIC_WHO, ...people]
}

/** The PIN session a device holds: one person, one store, one 10-minute token.
 *  Memory only — never a cookie or storage, so a reload drops it. */
export type PinSession = { staffId: string; storeId: string; label: string; token: string }

/** The answer of POST /api/tablet-pin/verify, as the screens need it. */
export type VerifyResult = { ok: true; token: string } | { ok: false; error: string; code?: string }

export async function verifyPin(staffId: string, storeId: string, pin: string): Promise<VerifyResult> {
  let res: Response
  try {
    res = await fetch("/api/tablet-pin/verify", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ staffId, storeId, pin }),
    })
  } catch {
    return { ok: false, error: "No connection — check the store's wifi and try again." }
  }
  // A signed-out device is redirected to /sign-in, which answers 200 with a
  // page, not JSON (seen in the TAB-4 local check). Say what happened rather
  // than "error 200".
  if (res.redirected || !(res.headers.get("content-type") ?? "").includes("application/json")) {
    return { ok: false, error: "This device's sign-in has expired. Reload the page, sign in again, and try once more." }
  }
  const body = (await res.json().catch(() => ({}))) as { token?: unknown; error?: unknown; code?: unknown }
  if (res.ok && typeof body.token === "string") return { ok: true, token: body.token }
  return {
    ok: false,
    error: typeof body.error === "string" ? body.error : `That didn't work (error ${res.status}). Try again.`,
    code: typeof body.code === "string" ? body.code : undefined,
  }
}

/** True when a write was refused because the PIN token is missing, stale or
 *  for someone else — the screen drops its session and asks again. */
export function isPinRefusal(code: unknown): boolean {
  return code === "pin_required" || code === "name_required"
}
