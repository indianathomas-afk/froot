import { auth } from "@clerk/nextjs/server"
import { prisma } from "@/lib/prisma"
import { NextResponse } from "next/server"

export async function DELETE(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const { orgId } = await auth()
  if (!orgId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { id } = await params
  const org = await prisma.organization.findUnique({ where: { clerkOrgId: orgId } })
  if (!org) return NextResponse.json({ error: "Org not found" }, { status: 404 })

  const store = await prisma.store.findFirst({ where: { id, organizationId: org.id } })
  if (!store) return NextResponse.json({ error: "Not found" }, { status: 404 })

  await prisma.store.delete({ where: { id } })
  return NextResponse.json({ ok: true })
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { orgId } = await auth()
  if (!orgId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { id } = await params
  const org = await prisma.organization.findUnique({ where: { clerkOrgId: orgId } })
  if (!org) return NextResponse.json({ error: "Org not found" }, { status: 404 })

  const store = await prisma.store.findFirst({ where: { id, organizationId: org.id } })
  if (!store) return NextResponse.json({ error: "Not found" }, { status: 404 })

  const body = await req.json()
  const updated = await prisma.store.update({ where: { id }, data: body })
  return NextResponse.json(updated)
}
