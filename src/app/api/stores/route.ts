import { auth } from "@clerk/nextjs/server"
import { prisma } from "@/lib/prisma"
import { NextResponse } from "next/server"
import { z } from "zod"
import { getUserStoreScope, requireAdmin } from "@/lib/auth"

const CreateStoreSchema = z.object({
  name: z.string().min(1),
  storeNumber: z.string().optional(),
  brand: z.string().optional(),
  address: z.string().optional(),
  city: z.string().optional(),
  state: z.string().optional(),
  zip: z.string().optional(),
  timezone: z.string().default("America/Los_Angeles"),
  contactEmail: z.string().email().optional().or(z.literal("")),
  phoneNumber: z.string().optional(),
  squareLocationId: z.string().optional(),
})

export async function GET() {
  const { orgId } = await auth()
  if (!orgId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const org = await prisma.organization.findUnique({ where: { clerkOrgId: orgId } })
  if (!org) return NextResponse.json({ error: "Org not found" }, { status: 404 })

  const { isAdmin, storeIds } = await getUserStoreScope()
  const stores = await prisma.store.findMany({
    where: {
      organizationId: org.id,
      ...(isAdmin ? {} : { id: { in: storeIds } }),
    },
    include: { hours: true },
    orderBy: { name: "asc" },
  })

  return NextResponse.json(stores)
}

export async function POST(req: Request) {
  const { orgId } = await auth()
  if (!orgId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  try { await requireAdmin() } catch { return NextResponse.json({ error: "Forbidden" }, { status: 403 }) }

  const org = await prisma.organization.findUnique({ where: { clerkOrgId: orgId } })
  if (!org) return NextResponse.json({ error: "Org not found" }, { status: 404 })

  const body = await req.json()
  const data = CreateStoreSchema.parse(body)

  const fields = {
    name: data.name,
    storeNumber: data.storeNumber || null,
    brand: data.brand || null,
    address: data.address || null,
    city: data.city || null,
    state: data.state || null,
    zip: data.zip || null,
    timezone: data.timezone,
    contactEmail: data.contactEmail || null,
    phoneNumber: data.phoneNumber || null,
  }

  // Square imports are idempotent: re-importing a location updates the
  // existing store (matched on squareLocationId) instead of duplicating it.
  if (data.squareLocationId) {
    const existing = await prisma.store.findFirst({
      where: { organizationId: org.id, squareLocationId: data.squareLocationId },
    })
    if (existing) {
      const updated = await prisma.store.update({ where: { id: existing.id }, data: fields })
      return NextResponse.json(updated, { status: 200 })
    }
  }

  const store = await prisma.store.create({
    data: {
      organizationId: org.id,
      squareLocationId: data.squareLocationId || null,
      ...fields,
    },
  })

  return NextResponse.json(store, { status: 201 })
}
