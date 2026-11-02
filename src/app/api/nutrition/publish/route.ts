import { NextResponse } from "next/server"
import { z } from "zod"
import { Prisma } from "@prisma/client"
import { prisma } from "@/lib/prisma"
import { requireNutrition } from "@/lib/nutrition-access"
import { TEXT_MAX, normalizeSlug, slugError } from "@/lib/public-menu"
import { invalidatePublicMenu } from "@/lib/public-menu-data"

// PUT /api/nutrition/publish — the org's public nutrition menu settings (N-3):
// on/off, web address, included menu groups, hidden items, disclaimer and
// cross-contact texts. ADMIN (nutrition.manage). Creates the PublicMenu row on
// first save (no row = off). Included groups must be this org's
// SquareCategory rows; hidden items this org's Square item ids — anything else
// is a 400, so a forged id can never attach another org's data. Blank texts
// store null (= the default text in code). One AuditLog row in the
// transaction. Expires the cached public payload at once (R-3).

const Schema = z.object({
  enabled: z.boolean(),
  slug: z.string().max(200),
  categoryIds: z.array(z.string().max(100)).max(500),
  hiddenSquareItemIds: z.array(z.string().max(100)).max(5000),
  disclaimer: z.string().max(TEXT_MAX).nullable(),
  crossContactNotice: z.string().max(TEXT_MAX).nullable(),
})

const blankToNull = (s: string | null) => (s && s.trim() ? s.trim() : null)

export async function PUT(req: Request) {
  const ctx = await requireNutrition("nutrition.manage")
  if ("error" in ctx) return ctx.error

  const parsed = Schema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json({ error: "Expected { enabled, slug, categoryIds, hiddenSquareItemIds, disclaimer, crossContactNotice }" }, { status: 400 })
  }
  const body = parsed.data
  const slug = normalizeSlug(body.slug)
  const err = slugError(slug)
  if (err) return NextResponse.json({ error: err }, { status: 400 })

  const orgId = ctx.org.id
  const categoryIds = [...new Set(body.categoryIds)]
  const hiddenIds = [...new Set(body.hiddenSquareItemIds)]

  const [cats, items, before] = await Promise.all([
    prisma.squareCategory.count({ where: { organizationId: orgId, id: { in: categoryIds } } }),
    prisma.salesItem.findMany({ where: { organizationId: orgId, squareItemId: { in: hiddenIds } }, select: { squareItemId: true }, distinct: ["squareItemId"] }),
    prisma.publicMenu.findUnique({
      where: { organizationId: orgId },
      select: { id: true, enabled: true, slug: true, disclaimer: true, crossContactNotice: true, categories: { select: { squareCategoryId: true } }, hiddenItems: { select: { squareItemId: true } } },
    }),
  ])
  if (cats !== categoryIds.length) return NextResponse.json({ error: "A menu group isn't in this organization" }, { status: 400 })
  if (items.length !== hiddenIds.length) return NextResponse.json({ error: "A hidden item isn't in this organization" }, { status: 400 })

  const data = {
    enabled: body.enabled,
    slug,
    disclaimer: blankToNull(body.disclaimer),
    crossContactNotice: blankToNull(body.crossContactNotice),
    updatedByUserId: ctx.dbUser?.id ?? null,
  }

  try {
    await prisma.$transaction(async (tx) => {
      const menu = await tx.publicMenu.upsert({ where: { organizationId: orgId }, create: { organizationId: orgId, ...data }, update: data, select: { id: true } })
      await tx.publicMenuCategory.deleteMany({ where: { publicMenuId: menu.id } })
      if (categoryIds.length) await tx.publicMenuCategory.createMany({ data: categoryIds.map((squareCategoryId) => ({ publicMenuId: menu.id, squareCategoryId })) })
      await tx.publicMenuHiddenItem.deleteMany({ where: { publicMenuId: menu.id } })
      if (hiddenIds.length) await tx.publicMenuHiddenItem.createMany({ data: hiddenIds.map((squareItemId) => ({ publicMenuId: menu.id, squareItemId })) })
      await tx.auditLog.create({
        data: {
          organizationId: orgId,
          userId: ctx.dbUser?.clerkUserId ?? null,
          action: "nutrition.publish.settings",
          entityType: "PublicMenu",
          entityId: menu.id,
          metadata: {
            enabled: { from: before?.enabled ?? null, to: data.enabled },
            slug: { from: before?.slug ?? null, to: data.slug },
            categories: { from: before?.categories.length ?? 0, to: categoryIds.length },
            hiddenItems: { from: before?.hiddenItems.length ?? 0, to: hiddenIds.length },
            disclaimerChanged: (before?.disclaimer ?? null) !== data.disclaimer,
            crossContactChanged: (before?.crossContactNotice ?? null) !== data.crossContactNotice,
          },
        },
      })
    })
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      return NextResponse.json({ error: "That web address is already taken — pick another" }, { status: 409 })
    }
    throw e
  }

  invalidatePublicMenu(orgId, "now")
  return NextResponse.json({ success: true, slug })
}
