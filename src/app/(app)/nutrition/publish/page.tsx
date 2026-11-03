import { redirect } from "next/navigation"
import { prisma } from "@/lib/prisma"
import { getCurrentUser } from "@/lib/auth"
import { can } from "@/lib/permissions"
import { slugify } from "@/lib/utils"
import { nutritionActive } from "@/lib/nutrition-access"
import { loadNutritionGraph } from "@/lib/recipe-nutrition"
import { loadServingSettings } from "@/lib/nutrition-serving"
import { DEFAULT_CROSS_CONTACT, DEFAULT_DISCLAIMER, SLUG_MAX, sizeStatuses, summarizeItems, suggestedInclude } from "@/lib/public-menu"
import { loadPublicSalesItems } from "@/lib/public-menu-data"
import { NutritionUpgradeCard } from "../upgrade-card"
import { PublishClient, type GroupRow, type ItemRow } from "./publish-client"

// N-3 deliverable 1: the org's public nutrition menu settings. ADMIN only
// (nutrition.manage); others go to Menu Nutrition. Counts are computed with
// the SAME per-size test the public page uses (sizeStatuses in
// src/lib/public-menu.ts), uncached, so the ADMIN sees today's numbers even
// while the public page's 5-minute cache catches up. N3-F3: off, and no
// groups ticked, until an ADMIN saves otherwise.
export default async function PublishMenuPage() {
  let current
  try {
    current = await getCurrentUser()
  } catch {
    redirect("/dashboard")
  }
  if (!nutritionActive(current.org)) return <NutritionUpgradeCard />
  if (!current.dbUser || !can(current.actor, "nutrition.view")) redirect("/dashboard")
  if (!can(current.actor, "nutrition.manage")) redirect("/nutrition/menu")

  const orgId = current.org.id
  const [menu, categories, salesItems, graph, serving] = await Promise.all([
    prisma.publicMenu.findUnique({
      where: { organizationId: orgId },
      select: { enabled: true, slug: true, disclaimer: true, crossContactNotice: true, categories: { select: { squareCategoryId: true } }, hiddenItems: { select: { squareItemId: true } } },
    }),
    prisma.squareCategory.findMany({ where: { organizationId: orgId }, select: { id: true, name: true } }),
    loadPublicSalesItems(orgId),
    loadNutritionGraph(orgId),
    loadServingSettings(orgId),
  ])

  const statuses = sizeStatuses({ salesItems, graph, serving })
  const summaries = summarizeItems(salesItems, statuses)
  const nameOf = new Map(salesItems.map((s) => [s.squareItemId, s.name]))
  const items: ItemRow[] = summaries
    .filter((s) => s.squareCategoryId && s.listedSizes > 0)
    .map((s) => ({ ...s, squareCategoryId: s.squareCategoryId!, name: nameOf.get(s.squareItemId) ?? "Unnamed item" }))
    .sort((a, b) => a.name.localeCompare(b.name))

  const catName = new Map(categories.map((c) => [c.id, c.name]))
  const groupIds = new Set(items.map((i) => i.squareCategoryId))
  const groups: GroupRow[] = [...groupIds]
    .map((id) => {
      const inGroup = items.filter((i) => i.squareCategoryId === id)
      const name = catName.get(id) ?? "Unnamed group"
      return { id, name, itemCount: inGroup.length, verifiedItemCount: inGroup.filter((i) => i.verifiedSizes > 0).length, suggested: suggestedInclude(name) }
    })
    .sort((a, b) => a.name.localeCompare(b.name))

  return (
    <PublishClient
      initial={{
        enabled: menu?.enabled ?? false,
        slug: menu?.slug ?? slugify(current.org.name).slice(0, SLUG_MAX),
        savedSlug: menu?.slug ?? null,
        savedEnabled: menu?.enabled ?? false,
        categoryIds: menu?.categories.map((c) => c.squareCategoryId) ?? [],
        hiddenSquareItemIds: menu?.hiddenItems.map((h) => h.squareItemId) ?? [],
        disclaimer: menu?.disclaimer ?? "",
        crossContactNotice: menu?.crossContactNotice ?? "",
      }}
      orgName={current.org.name}
      groups={groups}
      items={items}
      defaults={{ disclaimer: DEFAULT_DISCLAIMER, crossContact: DEFAULT_CROSS_CONTACT }}
    />
  )
}
