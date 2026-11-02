import { notFound } from "next/navigation"
import { getCurrentUser } from "@/lib/auth"
import { can } from "@/lib/permissions"
import { nutritionActive } from "@/lib/nutrition-access"
import { buildLabel, flOzError } from "@/lib/nutrition-label"
import { loadItemLabelData } from "@/lib/nutrition-serving"
import { NutritionFactsLabel } from "@/components/nutrition/nutrition-facts-label"
import { LabelPrintControls } from "./label-print-controls"

// N-2: print view of one item's Nutrition Facts label (browser print; image /
// PDF export is N-4). Outside the app shell, so it repeats the gate itself:
// both modules (R-4) and nutrition.view (N1-F3), the item resolved inside the
// caller's org. ?serving= carries the preview picker's size — a preview
// only, never saved. Anything refused is a 404, like the template print.
export default async function NutritionLabelPrintPage({
  params,
  searchParams,
}: {
  params: Promise<{ salesItemId: string }>
  searchParams: Promise<{ serving?: string }>
}) {
  let current
  try {
    current = await getCurrentUser()
  } catch {
    notFound()
  }
  if (!nutritionActive(current.org) || !current.dbUser || !can(current.actor, "nutrition.view")) notFound()

  const { salesItemId } = await params
  const { serving } = await searchParams
  const data = await loadItemLabelData(current.org.id, salesItemId)
  if (!data) notFound()

  let spec = data.spec
  const picked = serving !== undefined ? Number(serving) : null
  if (spec.kind === "volume" && picked !== null && !flOzError(picked, "Serving size")) spec = { ...spec, servingFlOz: picked }
  const result = buildLabel(data, spec)

  return (
    <div style={{ maxWidth: 640, margin: "24px auto", padding: "0 16px", fontFamily: "-apple-system, Arial, sans-serif" }}>
      <LabelPrintControls itemName={data.displayName} />
      <h1 style={{ fontSize: "14pt", fontWeight: 700, marginBottom: 12 }}>{data.displayName}</h1>
      {!result.ok ? (
        <p style={{ color: "#b91c1c" }}>No label — this item&apos;s nutrition can&apos;t be calculated: {result.error}</p>
      ) : (
        <>
          {result.label.estimated && (
            <div style={{ border: "2px solid #000", padding: "6px 10px", marginBottom: 10, maxWidth: "22rem", fontWeight: 700 }}>
              Estimated — not for publication
            </div>
          )}
          <NutritionFactsLabel label={result.label} />
          {result.label.missing.length > 0 && (
            <p style={{ fontSize: "8pt", marginTop: 8, maxWidth: "22rem" }}>
              &ldquo;—&rdquo; = not known (an ingredient is missing this value); never counted as zero.
            </p>
          )}
        </>
      )}
    </div>
  )
}
