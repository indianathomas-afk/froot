import { auth } from "@clerk/nextjs/server"
import { prisma } from "@/lib/prisma"
import { NextResponse } from "next/server"
import { z } from "zod"
import { requireManagerOrAdmin, requireModule } from "@/lib/auth"

const MetadataSchema = z.object({
  vendorName: z.string().optional().nullable(),
  vendorId: z.string().optional().nullable(),
  glCode: z.string().optional().nullable(),
  parLevel: z.number().optional().nullable(),
  unitCostOverride: z.number().optional().nullable(),
  unitOfMeasure: z.string().optional().nullable(),
  notes: z.string().optional().nullable(),
})

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
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
    await requireManagerOrAdmin()
  } catch {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }

  const { id } = await params
  const catalogItem = await prisma.catalogItem.findFirst({ where: { id, organizationId: org.id } })
  if (!catalogItem) return NextResponse.json({ error: "Not found" }, { status: 404 })

  const body = await req.json()
  const data = MetadataSchema.parse(body)

  // ItemMetadata keys off the Square catalog object id; manual (non-Square)
  // items fall back to their own row id so the unique key stays stable.
  const squareCatalogObjId = catalogItem.squareItemId ?? catalogItem.id

  const metadata = await prisma.itemMetadata.upsert({
    where: { organizationId_squareCatalogObjId: { organizationId: org.id, squareCatalogObjId } },
    create: { organizationId: org.id, squareCatalogObjId, ...data },
    update: data,
  })

  return NextResponse.json(metadata)
}
