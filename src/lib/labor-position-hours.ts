import { prisma } from "@/lib/prisma"

// R7 option B (Gary, 2026-08-22) — THE ONE RESOLUTION POINT for per-store
// salaried hours. Every path that needs "how many salaried hours does THIS store
// carry" comes through here, so the absent-means-inherit fallback exists in
// exactly one place and cannot drift between callers.
//
// D18: the declaration table carries HOURS AND NO RATE. Nothing in this module
// reads, returns or derives a rate, and nothing here may ever start to. The
// weekly budget's blended hourly rate is the unweighted mean of LaborPosition's
// active HOURLY rows (labor-budget.ts:88-91); it is reached by a different branch
// of computeWeeklyLaborBudget and this module is structurally unable to affect it.
//
// SEAM (b) IS UNTOUCHED. No Square-sourced input and no person enters any core
// engine. LaborPositionStoreHours is org-owned data written by an operator on
// /settings/labor, and the forecast still names nobody.

/// laborPositionId -> declared weekly hours for ONE store. A key is present ONLY
/// when that store has actually declared; `0` is a present key with value 0.
export type StoreHoursDeclarations = Map<string, number>

/// THE FALLBACK, AND THE WHOLE INVARIANT LIVES IN THIS FUNCTION.
///
/// Absent  -> the org-wide LaborPosition.impliedWeeklyHours, which is the SAME
///            expression labor-budget.ts:76 evaluates today. An empty table
///            therefore reproduces today's numbers byte for byte, and that is a
///            property of the DATA rather than of any test being green.
/// Present -> that store's number, including 0.
///
/// `!= null` IS LOAD-BEARING. `declared || position.impliedWeeklyHours` would
/// silently turn a declared 0 back into an inherited 40 — collapsing the two
/// states BUG-12's ruling exists to keep apart. Do not "simplify" it.
export function resolveSalariedHours(
  position: { id: string; impliedWeeklyHours: number | null },
  declarations: StoreHoursDeclarations
): number | null {
  const declared = declarations.get(position.id)
  return declared != null ? declared : position.impliedWeeklyHours
}

/// The GM's weekly floor-credit ceiling for one store — S5-D19's substitution,
/// behind a name so the GM-hours whole-crew build (c17466e) reads the same helper
/// instead of the module constant it would otherwise hardcode (D22).
///
/// WHY THE STORE'S OWN SALARIED HOURS ARE THE RIGHT CEILING. The cap bounds how
/// much of a store's open-hours floor the salaried GM may absorb before hourly
/// hours must cover it. A store that carries 20 salaried hours must not be
/// allowed to credit 40 hours of GM floor coverage. Today every store resolves to
/// 40 and the retired constant was 40, so this is a MEASURED NO-OP on present
/// data (docs/prompts/R7_PER_STORE_SALARIED_AUDIT.md §4).
///
/// WHAT IT DOES NOT CLOSE, per Gary's D19: a SHORT-HOURS store whose GM window
/// intersected with open hours sums to LESS than its declaration still yields
/// Sigma gmCreditHours < salariedHours, because capGmFloorCredits returns hours
/// unchanged below the ceiling (labor-daily.ts:54). That is S5-D10's second case
/// and it stays open by ruling, not by oversight.
///
/// `fallback` is used only when a store resolves to no salaried hours at all; the
/// value is irrelevant there because gmHoursByWeekday is all zeros in that case
/// (hasGm is false, so no GM window is ever built), and capGmFloorCredits returns
/// zeros for any ceiling. It exists so the signature never returns 0 as a ceiling.
export function resolveGmCeilingHours(salariedHours: number, fallback: number): number {
  return salariedHours > 0 ? salariedHours : fallback
}

/// Load ONE store's declarations. Store-scoped by construction: the returned map
/// can never carry another store's row, so a caller cannot accidentally resolve
/// against the wrong store.
export async function loadStoreHoursDeclarations(storeId: string): Promise<StoreHoursDeclarations> {
  const rows = await prisma.laborPositionStoreHours.findMany({
    where: { storeId },
    select: { laborPositionId: true, weeklyHours: true },
  })
  return new Map(rows.map((r) => [r.laborPositionId, r.weeklyHours]))
}
