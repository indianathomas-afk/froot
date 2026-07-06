import { auth } from "@clerk/nextjs/server"
import { prisma } from "@/lib/prisma"
import { NextResponse } from "next/server"
import { z } from "zod"
import { requireAdmin, requireModule } from "@/lib/auth"

const CopySchema = z.object({
  sourceStoreId: z.string().min(1),
  targetStoreId: z.string().min(1),
})

// POST /api/inventory/storage-areas/copy (admin) — duplicate one store's area
// layout (areas + mappings + ordering) onto another. Merge-add: an existing
// target area with the same name gains only the mappings it's missing, appended
// at the end; mappings already present are skipped. Ingredients are org-level,
// so no item mapping between stores is needed — same ingredientId everywhere.
export async function POST(req: Request) {
  const { orgId } = await auth()
  if (!orgId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const org = await prisma.organization.findUnique({ where: { clerkOrgId: orgId } })
  if (!org) return NextResponse.json({ error: "Org not found" }, { status: 404 })

  try {
    await requireModule("inventory")
  } catch {
    return NextResponse.json({ error: "MODULE_NOT_ACTIVE" }, { status: 403 })
  }

  try {
    await requireAdmin()
  } catch {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }

  const body = await req.json()
  const data = CopySchema.parse(body)

  if (data.sourceStoreId === data.targetStoreId) {
    return NextResponse.json({ error: "Source and target store must differ" }, { status: 400 })
  }

  const [source, target] = await Promise.all([
    prisma.store.findFirst({ where: { id: data.sourceStoreId, organizationId: org.id } }),
    prisma.store.findFirst({ where: { id: data.targetStoreId, organizationId: org.id } }),
  ])
  if (!source || !target) return NextResponse.json({ error: "Store not found" }, { status: 404 })

  const sourceAreas = await prisma.storageArea.findMany({
    where: { organizationId: org.id, storeId: source.id },
    include: { ingredientMappings: { orderBy: { sortOrder: "asc" } } },
    orderBy: { sortOrder: "asc" },
  })
  if (sourceAreas.length === 0) {
    return NextResponse.json({ error: "Source store has no storage areas" }, { status: 400 })
  }

  const targetAreas = await prisma.storageArea.findMany({
    where: { organizationId: org.id, storeId: target.id },
    include: { ingredientMappings: true },
  })
  const targetByName = new Map(targetAreas.map((a) => [a.name.trim().toLowerCase(), a]))
  let nextAreaSort = targetAreas.reduce((max, a) => Math.max(max, a.sortOrder), -1) + 1

  let areasCreated = 0
  let mappingsCreated = 0

  await prisma.$transaction(async (tx) => {
    for (const sourceArea of sourceAreas) {
      const existing = targetByName.get(sourceArea.name.trim().toLowerCase())

      if (!existing) {
        await tx.storageArea.create({
          data: {
            organizationId: org.id,
            storeId: target.id,
            name: sourceArea.name,
            sortOrder: nextAreaSort++,
            ingredientMappings: {
              create: sourceArea.ingredientMappings.map((m, index) => ({
                ingredientId: m.ingredientId,
                sortOrder: index,
              })),
            },
          },
        })
        areasCreated += 1
        mappingsCreated += sourceArea.ingredientMappings.length
      } else {
        const existingIds = new Set(existing.ingredientMappings.map((m) => m.ingredientId))
        let nextSort = existing.ingredientMappings.reduce((max, m) => Math.max(max, m.sortOrder), -1) + 1
        const missing = sourceArea.ingredientMappings.filter((m) => !existingIds.has(m.ingredientId))
        if (missing.length > 0) {
          await tx.ingredientStorageMapping.createMany({
            data: missing.map((m) => ({
              storageAreaId: existing.id,
              ingredientId: m.ingredientId,
              sortOrder: nextSort++,
            })),
          })
          mappingsCreated += missing.length
        }
      }
    }
  })

  return NextResponse.json({ success: true, areasCreated, mappingsCreated })
}
