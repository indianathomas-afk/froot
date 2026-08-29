import type { PermissionUser } from "@/lib/permissions"

// COMP-1 — CONFIDENTIAL COMPENSATION. THE ONE ANSWER TO "MAY THIS VIEWER SEE
// THIS PERSON'S PAY?", so that four surfaces cannot each hold a slightly
// different opinion about it.
//
// PURE — no prisma, no next, no clerk — so a CLIENT COMPONENT MAY IMPORT IT,
// the same constraint labor-costs.ts and labor-roster-hours.ts carry and for the
// same reason: the settings card is a client component and dragging the server
// auth stack into the browser bundle is a build error.
//
// THIS MODULE DECIDES VISIBILITY, NOT ENFORCEMENT. Enforcement is the caller
// dropping the field from the payload. Read the rule at the bottom of this
// comment before using anything here:
//
//   THE FIELD IS ABSENT FROM THE RESPONSE, NEVER HIDDEN IN THE MARKUP.
//   (Gary's hard rule, 2026-08-19, already carried by labor.costs.view.) A
//   manager reading the Network tab must find no confidential number in any
//   payload. Nulling a field in the JSX is not redaction; it is decoration over
//   a leak.

/// Ruling 2 (Gary, 2026-08-28): confidential comp is visible to ADMIN ONLY, and
/// there is deliberately NO per-user grant for it. That is why this reads the
/// role directly rather than going through can() — there is no capability to
/// consult, and inventing one would imply a grant the ruling withheld.
///
/// NOT TO BE CONFUSED WITH labor.costs.view, which decides whether a viewer sees
/// ANY pay at all. This is the second, narrower gate that runs after it: a
/// MANAGER who passes canSeeWages still fails this one.
export function canSeeConfidentialComp(actor: PermissionUser): boolean {
  return actor.role === "ADMIN"
}

/// The roster path. The flag is a NON-NULL column on the very row that carries
/// the money (SquareTeamMemberWage), so there is nothing to fail closed about —
/// every roster row has one by construction, including the "Not in Froot" rows
/// that have no StaffMember at all.
export function compVisibleOnRow(actor: PermissionUser, row: { compConfidential: boolean }): boolean {
  return !row.compConfidential || canSeeConfidentialComp(actor)
}

/// The salaried path — ruling 6 (Gary, 2026-08-28), AND THE `=== false` IS THE
/// RULING, not a style choice.
///
/// LaborSalariedPerson carries NO FLAG OF ITS OWN. It is a second row keyed by
/// the same (organizationId, squareTeamMemberId) as the wage row, so it reads
/// the wage row's flag and one admin toggle governs both surfaces. Two flags for
/// one fact is two sources of truth, and they will disagree.
///
/// THE LOOKUP FAILS CLOSED. `undefined` means no SquareTeamMemberWage row was
/// found for this person — a leaver the mirror no longer returns, a wage sync
/// that has not run, or a person entered in Froot before Square knew them. That
/// is MASKED, NOT VISIBLE. Only an explicit `false` opens the field, which is
/// why this is a positive test and must never be rewritten as `!flag`: `!undefined`
/// is true and would hand every unmatched person's weekly pay to a manager.
export function compVisibleForMember(actor: PermissionUser, flag: boolean | undefined): boolean {
  if (canSeeConfidentialComp(actor)) return true
  return flag === false
}

/// What a masked figure reads as, everywhere. Exported so the roster card, the
/// salaried card and /staff cannot drift into three different dashes — the same
/// discipline formatPay/payText already record for "Not set in Square".
export const CONFIDENTIAL_DASH = "—"
export const CONFIDENTIAL_TITLE = "Confidential — visible to admins only"
