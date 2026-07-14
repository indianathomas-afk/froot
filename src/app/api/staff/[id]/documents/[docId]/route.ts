import { NextResponse } from "next/server"
import { z } from "zod"
import { prisma } from "@/lib/prisma"
import { requireManageableStaff } from "../../../access"

const patchSchema = z.object({
  visibleToStaff: z.boolean().optional(),
  title: z.string().trim().min(1).max(200).optional(),
  category: z.string().trim().max(60).nullish(),
})

// PATCH /api/staff/[id]/documents/[docId] — flip the team-visibility switch
// (and optionally rename / relabel). ADMIN / in-scope MANAGER.
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string; docId: string }> }) {
  const { id, docId } = await params
  const access = await requireManageableStaff(id)
  if (!access.ok) return access.response

  const doc = await prisma.staffDocument.findFirst({
    where: { id: docId, staffMemberId: id, organizationId: access.org.id },
    select: { id: true },
  })
  if (!doc) return NextResponse.json({ error: "Document not found" }, { status: 404 })

  const parsed = patchSchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: "Invalid request body" }, { status: 400 })
  const { visibleToStaff, title, category } = parsed.data

  const updated = await prisma.staffDocument.update({
    where: { id: docId },
    data: {
      ...(visibleToStaff !== undefined ? { visibleToStaff } : {}),
      ...(title !== undefined ? { title } : {}),
      ...(category !== undefined ? { category: category || null } : {}),
    },
    select: { id: true, visibleToStaff: true },
  })
  return NextResponse.json(updated)
}

// DELETE /api/staff/[id]/documents/[docId] — remove a mis-upload. ADMIN /
// in-scope MANAGER. The blob is left in the private store (HR never
// hard-deletes blobs); only the pointer row is removed.
export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string; docId: string }> }) {
  const { id, docId } = await params
  const access = await requireManageableStaff(id)
  if (!access.ok) return access.response

  const { count } = await prisma.staffDocument.deleteMany({
    where: { id: docId, staffMemberId: id, organizationId: access.org.id },
  })
  if (count === 0) return NextResponse.json({ error: "Document not found" }, { status: 404 })
  return NextResponse.json({ success: true })
}
