import Link from "next/link"
import { notFound, redirect } from "next/navigation"
import { getCurrentUser } from "@/lib/auth"
import { can } from "@/lib/permissions"
import { nutritionActive } from "@/lib/nutrition-access"
import { loadItemLabelData } from "@/lib/nutrition-serving"
import { NutritionUpgradeCard } from "../../../upgrade-card"
import { LabelPreviewClient } from "./label-preview-client"

// N-2 deliverable 6: one sales item's Nutrition Facts label preview, with a
// serving-size picker that previews another size without saving it, a print
// view, and (ADMIN) the item's serving override. nutrition.view = ADMIN,
// MANAGER, STORE (N1-F3); both modules required (R-4). The sales item is
// resolved inside the caller's org, so another org's id is a 404.
export default async function NutritionLabelPage({ params }: { params: Promise<{ salesItemId: string }> }) {
  let current
  try {
    current = await getCurrentUser()
  } catch {
    redirect("/dashboard")
  }
  if (!nutritionActive(current.org)) return <NutritionUpgradeCard />
  if (!current.dbUser || !can(current.actor, "nutrition.view")) redirect("/dashboard")

  const { salesItemId } = await params
  const data = await loadItemLabelData(current.org.id, salesItemId)
  if (!data) notFound()

  return (
    <div className="max-w-5xl">
      <Link href="/nutrition/menu" className="text-sm text-[var(--color-muted-foreground)] hover:underline">
        ← Menu Nutrition
      </Link>
      {/* Keyed on the saved serving so a save (router.refresh) resets the picker to it. */}
      <LabelPreviewClient key={JSON.stringify([data.spec, data.override])} data={data} canManage={can(current.actor, "nutrition.manage")} />
    </div>
  )
}
