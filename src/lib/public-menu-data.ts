import { revalidateTag, unstable_cache } from "next/cache"
import { prisma } from "@/lib/prisma"
import { loadNutritionGraph } from "@/lib/recipe-nutrition"
import { loadServingSettings } from "@/lib/nutrition-serving"
import { buildPublicMenu, menuIsLive, normalizeSlug, type PublicMenuInput, type PublicMenuPayload, type PublicMenuSalesItem } from "@/lib/public-menu"

// ─── Public nutrition menu — database half (N-3) ─────────────────────────────
// The pure serializer is src/lib/public-menu.ts. This file loads its inputs,
// caches the PAYLOAD (never the graph) per org, and invalidates it.
//
// R-3 (Gary, "Accept all leans"): the payload is cached 5 minutes. That window
// carries recipe, ingredient, sales-item and Square-sync edits (about 40
// inventory write routes — deliberately not wired one by one) and the 12-month
// stale line, which is evaluated when the payload is built. Publish settings
// expire it at once; nutrition writes mark it stale (served once more while it
// rebuilds). Whether the menu is LIVE is read fresh on every request
// (findLiveMenuOrg), so "off" is a 404 immediately, whatever the cache holds.

export const PUBLIC_MENU_REVALIDATE_SECONDS = 300

export function publicMenuTag(organizationId: string): string {
  return `public-menu:${organizationId}`
}

/** The sales items as the serializer sees them (shared with the publish page's counts). */
export async function loadPublicSalesItems(organizationId: string): Promise<PublicMenuSalesItem[]> {
  const rows = await prisma.salesItem.findMany({
    where: { organizationId, isDeleted: false },
    select: {
      squareItemId: true, name: true, variationName: true, squareCategoryId: true, recipeStatus: true,
      recipe: { select: { id: true } },
      nutritionServing: { select: { perItem: true, volumeFlOz: true, servingFlOz: true } },
    },
  })
  return rows.map((r) => ({
    squareItemId: r.squareItemId,
    name: r.name,
    variationName: r.variationName,
    squareCategoryId: r.squareCategoryId,
    recipeStatus: r.recipeStatus,
    recipeId: r.recipe?.id ?? null,
    override: r.nutritionServing ?? null,
  }))
}

export async function loadPublicMenuInput(organizationId: string): Promise<PublicMenuInput | null> {
  const [org, menu, categories, salesItems, graph, serving, verified] = await Promise.all([
    prisma.organization.findUnique({ where: { id: organizationId }, select: { name: true } }),
    prisma.publicMenu.findUnique({
      where: { organizationId },
      select: { disclaimer: true, crossContactNotice: true, categories: { select: { squareCategoryId: true } }, hiddenItems: { select: { squareItemId: true } } },
    }),
    prisma.squareCategory.findMany({ where: { organizationId }, select: { id: true, name: true } }),
    loadPublicSalesItems(organizationId),
    loadNutritionGraph(organizationId),
    loadServingSettings(organizationId),
    prisma.ingredientNutrition.findMany({
      where: { ingredient: { organizationId }, verifiedAt: { not: null } },
      select: { ingredientId: true, verifiedAt: true },
    }),
  ])
  if (!org || !menu) return null
  const verifiedAt = new Map(verified.map((v) => [v.ingredientId, v.verifiedAt]))
  return {
    orgName: org.name,
    disclaimer: menu.disclaimer,
    crossContactNotice: menu.crossContactNotice,
    includedCategoryIds: new Set(menu.categories.map((c) => c.squareCategoryId)),
    hiddenSquareItemIds: new Set(menu.hiddenItems.map((h) => h.squareItemId)),
    categories: new Map(categories.map((c) => [c.id, c.name])),
    salesItems,
    graph,
    serving,
    verifiedAtOf: (id) => verifiedAt.get(id) ?? null,
  }
}

/** The cached public payload for one org. The key and the tag both carry the org id. */
export function getPublicMenuPayload(organizationId: string): Promise<PublicMenuPayload | null> {
  return unstable_cache(
    async () => {
      const input = await loadPublicMenuInput(organizationId)
      return input ? buildPublicMenu(input) : null
    },
    ["public-menu", organizationId],
    { tags: [publicMenuTag(organizationId)], revalidate: PUBLIC_MENU_REVALIDATE_SECONDS }
  )()
}

/** slug → org id when the menu is live (row exists, enabled, both modules on); otherwise null → 404. Uncached. */
export async function findLiveMenuOrg(rawSlug: string): Promise<string | null> {
  const slug = normalizeSlug(rawSlug)
  if (!slug) return null
  const row = await prisma.publicMenu.findUnique({
    where: { slug },
    select: { enabled: true, organizationId: true, organization: { select: { activeModules: true } } },
  })
  return row && menuIsLive(row, row.organization) ? row.organizationId : null
}

/** Publish settings → expire now; nutrition writes → stale-while-revalidate. Never throws into the write it follows. */
export function invalidatePublicMenu(organizationId: string, how: "now" | "stale" = "stale"): void {
  try {
    revalidateTag(publicMenuTag(organizationId), how === "now" ? { expire: 0 } : "max")
  } catch (e) {
    console.error("[public-menu] revalidateTag failed", e)
  }
}
