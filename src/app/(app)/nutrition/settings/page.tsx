import { redirect } from "next/navigation"
import { prisma } from "@/lib/prisma"
import { getCurrentUser } from "@/lib/auth"
import { can } from "@/lib/permissions"
import { nutritionActive } from "@/lib/nutrition-access"
import { suggestVolumeFromName } from "@/lib/nutrition-label"
import { loadServingSettings } from "@/lib/nutrition-serving"
import { NutritionUpgradeCard } from "../upgrade-card"
import { ServingSettingsClient, type SizeRow } from "./serving-settings-client"

// N-2 deliverable 1: the org's Nutrition Facts serving settings — the drink
// serving size (R-1: "12 fl oz default, changeable in settings") and the size
// table (F3), one row per Square variation name used by an item WITH A RECIPE
// (only those ever get a label). F6: "Settings pre-fill volumes from names
// like '20oz.' for me to confirm; nothing is guessed when a label is drawn."
// Saved names no longer on any recipe'd item stay listed so they can be
// removed. ADMIN only (nutrition.manage); others go to Menu Nutrition.
export default async function ServingSettingsPage() {
  let current
  try {
    current = await getCurrentUser()
  } catch {
    redirect("/dashboard")
  }
  if (!nutritionActive(current.org)) return <NutritionUpgradeCard />
  if (!current.dbUser || !can(current.actor, "nutrition.view")) redirect("/dashboard")
  if (!can(current.actor, "nutrition.manage")) redirect("/nutrition/menu")

  const [items, settings] = await Promise.all([
    prisma.salesItem.findMany({
      where: { organizationId: current.org.id, isDeleted: false, recipe: { isNot: null } },
      select: { variationName: true, menuGroup: true },
    }),
    loadServingSettings(current.org.id),
  ])

  const byName = new Map<string, { count: number; groups: Set<string> }>()
  for (const i of items) {
    const e = byName.get(i.variationName) ?? { count: 0, groups: new Set<string>() }
    e.count++
    if (i.menuGroup) e.groups.add(i.menuGroup)
    byName.set(i.variationName, e)
  }
  const names = new Set([...byName.keys(), ...settings.sizeTable.keys()])
  const rows: SizeRow[] = [...names]
    .map((name) => ({
      variationName: name,
      itemCount: byName.get(name)?.count ?? 0,
      menuGroups: [...(byName.get(name)?.groups ?? [])].sort(),
      savedFlOz: settings.sizeTable.get(name) ?? null,
      suggestedFlOz: suggestVolumeFromName(name),
    }))
    .sort((a, b) => b.itemCount - a.itemCount || a.variationName.localeCompare(b.variationName))

  return <ServingSettingsClient orgServingFlOz={settings.orgServingFlOz} rows={rows} />
}
