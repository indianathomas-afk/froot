import { prisma } from "@/lib/prisma"
import { getWeeklyForecast } from "@/lib/labor-forecast"
import { resolveLaborSettings } from "@/lib/labor-settings"
import { computeWeeklyLaborBudget } from "@/lib/labor-budget"
import { loadStoreHoursDeclarations, resolveSalariedHours } from "@/lib/labor-position-hours"

// R7/D27 — the estate-level read behind the "Salaried hours by store" table.
//
// WHY A PERCENTAGE AND NOT JUST HOURS, in Gary's words: "the UI shows the GM's
// share of that store's budget beside the declaration, not hours alone. UNR reads
// '40 hrs · 80%', Las Brisas '40 hrs · 22%'. Same hours figure, situations not
// remotely alike." The hours number is identical at every inheriting store by
// construction — it is one org-wide row — so hours alone cannot show an operator
// which store the inherited figure is hurting. The percentage is the only column
// on this table that distinguishes the stores from each other.
//
// IT DOES NOT USE getWeeklyDayPlan, DELIBERATELY. The plan engine infers open
// windows and day weights from 56 days of trailing sales per store; running it
// for every store to render a settings table would be many multiples of the work
// for two numbers it already has upstream. This composes the same
// computeWeeklyLaborBudget the plan uses, over the same resolved positions, so
// the salariedCost and totalLaborBudget here are the SAME figures the Budget card
// shows — not a second derivation.
//
// It is also, for the same reason, free of the wall-clock dependence that
// MEADOWOOD_DRIFT_AUDIT.md (8203d2c) found in the day split: nothing here reads a
// trailing window, so this table does not drift between page loads.

export type StoreSalariedRow = {
  storeId: string
  storeName: string
  /// null = INHERITING. A number = declared, and 0 is a declared 0.
  declaredHours: number | null
  /// What the store actually resolves to right now (declared ?? org-wide).
  effectiveHours: number | null
  /// The org-wide archetype figure, shown as the "inherits" value.
  inheritedHours: number | null
  /// null when the store has no forecast for the week — the percentage is
  /// undefined, not zero, and the UI must say so rather than print "0%".
  salariedCost: number | null
  totalLaborBudget: number | null
  salariedPctOfBudget: number | null
}

export type SalariedPositionSummary = {
  positionId: string
  positionName: string
  inheritedHours: number | null
  rows: StoreSalariedRow[]
}

/// One summary per SALARIED archetype, each carrying a row per store the caller
/// may see. `anyDateInWeek` picks which week's forecast sizes the percentages.
export async function getSalariedSummaries(
  organizationId: string,
  stores: { id: string; name: string }[],
  anyDateInWeek: string
): Promise<SalariedPositionSummary[]> {
  const positions = await prisma.laborPosition.findMany({
    where: { organizationId, active: true },
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
  })
  const salaried = positions.filter((p) => p.payType === "SALARIED")
  if (salaried.length === 0) return []

  const perStore = await Promise.all(
    stores.map(async (s) => {
      const [declarations, settings, forecast] = await Promise.all([
        loadStoreHoursDeclarations(s.id),
        resolveLaborSettings(organizationId, s.id),
        getWeeklyForecast(s.id, anyDateInWeek),
      ])
      const budget = computeWeeklyLaborBudget({
        settings,
        positions: positions.map((p) => ({
          payType: p.payType,
          defaultHourlyRate: Number(p.defaultHourlyRate),
          impliedWeeklyHours: resolveSalariedHours(p, declarations),
          active: p.active,
        })),
        forecast: forecast ? { total: forecast.total } : null,
      })
      return { store: s, declarations, budget }
    })
  )

  return salaried.map((pos) => ({
    positionId: pos.id,
    positionName: pos.name,
    inheritedHours: pos.impliedWeeklyHours,
    rows: perStore.map(({ store, declarations, budget }) => {
      // `!= null` throughout: a declared 0 is a value, never an absence.
      const declared = declarations.get(pos.id)
      const declaredHours = declared != null ? declared : null
      return {
        storeId: store.id,
        storeName: store.name,
        declaredHours,
        effectiveHours: resolveSalariedHours(pos, declarations),
        inheritedHours: pos.impliedWeeklyHours,
        salariedCost: budget?.salariedCost ?? null,
        totalLaborBudget: budget?.totalLaborBudget ?? null,
        salariedPctOfBudget:
          budget && budget.totalLaborBudget > 0
            ? +((budget.salariedCost / budget.totalLaborBudget) * 100).toFixed(1)
            : null,
      }
    }),
  }))
}
