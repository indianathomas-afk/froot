import Link from "next/link"
import type { Allergen } from "@prisma/client"
import { NUTRIENTS, allergenLabel, type NutrientKey, type NutrientValues } from "@/lib/nutrition"

// N-5 deliverable 3: what each Square modifier ADDS TO (or takes out of) a
// drink, from its recipe. Internal only — not on the public menu (N5-F5).
//
// N5-F7: values are signed, plainly rounded deltas ("+170", "−120"). They never
// go through the FDA label rounding in src/lib/nutrition-label.ts, which maps
// small and negative values to 0 and is for a positive label only.
// N5-F6: allergens are "may add" — the engine takes them from positive lines
// only, since a removal can't add an allergen (src/lib/recipe-nutrition.ts).

export type ModifierNutritionRow = {
  modifierId: string
  recipeId: string
  name: string
  listName: string
  totals: NutrientValues
  allergens: Allergen[]
  complete: boolean
  error: string | null
  /** null when the viewer may not see costs, or the cost can't be computed */
  cost: number | null
}

const KEY_COLUMNS: NutrientKey[] = ["calories", "totalFatG", "totalCarbG", "totalSugarsG", "proteinG", "sodiumMg"]
const nutrientMeta = (k: NutrientKey) => NUTRIENTS.find((n) => n.key === k)!

function signed(v: number | null): string {
  if (v === null) return "—"
  const r = Math.abs(v) >= 100 ? Math.round(v) : Math.round(v * 10) / 10
  if (r === 0) return "0"
  return `${r < 0 ? "−" : "+"}${Math.abs(r).toLocaleString()}`
}

const signedUsd = (n: number) =>
  `${n < 0 ? "−" : "+"}${Math.abs(n).toLocaleString("en-US", { style: "currency", currency: "USD" })}`

export function ModifierNutritionTable({
  rows,
  withoutRecipeCount,
  showCost,
}: {
  rows: ModifierNutritionRow[]
  withoutRecipeCount: number
  showCost: boolean
}) {
  if (rows.length === 0 && withoutRecipeCount === 0) return null

  return (
    <section className="max-w-6xl mt-10">
      <h2 className="text-lg font-semibold text-[var(--color-foreground)] mb-1">Modifiers</h2>
      <p className="text-sm text-[var(--color-muted-foreground)] mb-4">
        What each add-on, swap or removal changes, per drink. Signed and unrounded — a minus means the modifier takes
        something out. Allergens listed are ones the modifier may add.
        {withoutRecipeCount > 0 && (
          <>
            {" "}
            {withoutRecipeCount} modifier{withoutRecipeCount === 1 ? " has" : "s have"} no recipe yet —{" "}
            <Link href="/inventory/recipes" className="underline">Inventory → Recipes → Modifiers</Link>.
          </>
        )}
      </p>

      {rows.length > 0 && (
        <div className="rounded-lg border border-[var(--color-border)] overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[var(--color-border)] text-xs text-[var(--color-muted-foreground)]">
                <th className="text-left px-3 py-2 font-medium">Modifier</th>
                {KEY_COLUMNS.map((k) => (
                  <th key={k} className="text-right px-3 py-2 font-medium whitespace-nowrap">
                    {nutrientMeta(k).label} ({nutrientMeta(k).unit})
                  </th>
                ))}
                <th className="text-left px-3 py-2 font-medium">May add</th>
                {showCost && <th className="text-right px-3 py-2 font-medium">Cost</th>}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.modifierId} className="border-b border-[var(--color-border)] last:border-0">
                  <td className="px-3 py-2">
                    <Link href={`/inventory/recipes/${r.recipeId}`} className="font-medium text-[var(--color-foreground)] hover:underline">
                      {r.name}
                    </Link>
                    <div className="text-xs text-[var(--color-muted-foreground)]">{r.listName}</div>
                    {r.error && <div className="text-xs text-[var(--color-destructive)]">{r.error}</div>}
                  </td>
                  {KEY_COLUMNS.map((k) => (
                    <td key={k} className="text-right px-3 py-2 tabular-nums">
                      {r.totals[k] === null ? (
                        <span className="text-[#efa201]" title="Incomplete — an ingredient is missing this value">—</span>
                      ) : (
                        signed(r.totals[k])
                      )}
                    </td>
                  ))}
                  <td className="px-3 py-2 text-xs">
                    {r.allergens.length === 0 ? (
                      <span className="text-[var(--color-muted-foreground)]">—</span>
                    ) : (
                      r.allergens.map(allergenLabel).join(", ")
                    )}
                  </td>
                  {showCost && (
                    <td className="text-right px-3 py-2 tabular-nums">{r.cost === null ? "—" : signedUsd(r.cost)}</td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}
