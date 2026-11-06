import { auth } from "@clerk/nextjs/server"
import { prisma } from "@/lib/prisma"
import { denyUnlessStoresManage } from "../access"
import { RESTRICT_MESSAGES, refuseIfRestricted } from "@/lib/db/restrict-violation"
import { NextResponse } from "next/server"
import { z } from "zod"

const UpdateStoreSchema = z.object({
  name: z.string().min(1).optional(),
  storeNumber: z.string().nullable().optional(),
  brand: z.string().nullable().optional(),
  address: z.string().nullable().optional(),
  city: z.string().nullable().optional(),
  state: z.string().nullable().optional(),
  zip: z.string().nullable().optional(),
  timezone: z.string().optional(),
  contactEmail: z.string().email().nullable().optional().or(z.literal("").transform(() => null)),
  phoneNumber: z.string().nullable().optional(),
  squareLocationId: z.string().nullable().optional(),
  isActive: z.boolean().optional(),
})

export async function DELETE(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const { orgId } = await auth()
  if (!orgId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const denied = await denyUnlessStoresManage()
  if (denied) return denied

  const { id } = await params
  const org = await prisma.organization.findUnique({ where: { clerkOrgId: orgId } })
  if (!org) return NextResponse.json({ error: "Org not found" }, { status: 404 })

  const store = await prisma.store.findFirst({ where: { id, organizationId: org.id } })
  if (!store) return NextResponse.json({ error: "Not found" }, { status: 404 })

  // BUG-24 row 1. Checklist, PurchaseOrder and InventoryCount all point at a
  // store ON DELETE RESTRICT, so a store with any of them cannot be deleted.
  // Postgres refuses the whole statement, so none of the store's cascades run
  // either. Before BUG-24 that refusal came back a bare 500 and the dialog
  // swallowed it. No pre-check: three tables block, so it is not one
  // `exists`-style query.
  const refused = await refuseIfRestricted(
    () => prisma.store.delete({ where: { id } }),
    RESTRICT_MESSAGES.store,
    "DELETE /api/stores/[id]",
  )
  if (refused) return refused
  return NextResponse.json({ ok: true })
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { orgId } = await auth()
  if (!orgId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const denied = await denyUnlessStoresManage()
  if (denied) return denied

  const { id } = await params
  const org = await prisma.organization.findUnique({ where: { clerkOrgId: orgId } })
  if (!org) return NextResponse.json({ error: "Org not found" }, { status: 404 })

  const store = await prisma.store.findFirst({ where: { id, organizationId: org.id } })
  if (!store) return NextResponse.json({ error: "Not found" }, { status: 404 })

  const body = await req.json()
  const parsed = UpdateStoreSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid fields", details: parsed.error.flatten() }, { status: 400 })
  }
  const data = parsed.data

  // squareLocationId is unique — block stealing a link from another store.
  if (data.squareLocationId) {
    const conflict = await prisma.store.findFirst({
      where: { squareLocationId: data.squareLocationId, NOT: { id } },
    })
    if (conflict) {
      return NextResponse.json(
        { error: `That Square location is already linked to "${conflict.name}".` },
        { status: 409 }
      )
    }
  }

  const updated = await prisma.store.update({ where: { id }, data })
  return NextResponse.json(updated)
}
