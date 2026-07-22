import { NextResponse } from "next/server"
import { z } from "zod"
import { prisma } from "@/lib/prisma"
import { NOTE_CATEGORIES } from "@/lib/manager-notes"
import { requireNoteAccess } from "../access"

const patchSchema = z
  .object({
    category: z.enum(NOTE_CATEGORIES).optional(),
    body: z.string().trim().min(1).optional(),
  })
  .refine((data) => data.category !== undefined || data.body !== undefined)

async function loadNote(noteId: string, staffId: string, organizationId: string) {
  return prisma.managerNote.findFirst({
    where: { id: noteId, staffMemberId: staffId, organizationId },
  })
}

// PATCH /api/staff/[id]/notes/[noteId] — edit a note's body/category. Author only.
export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string; noteId: string }> }
) {
  const { id, noteId } = await params
  const access = await requireNoteAccess(id)
  if (!access.ok) return access.response

  const note = await loadNote(noteId, id, access.org.id)
  if (!note) return NextResponse.json({ error: "Note not found" }, { status: 404 })
  if (note.authorUserId !== access.caller.id) {
    return NextResponse.json({ error: "Only the author can edit a note" }, { status: 403 })
  }

  const parsed = patchSchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json(
      { error: "A valid category or a non-empty note body is required" },
      { status: 400 }
    )
  }

  const updated = await prisma.managerNote.update({
    where: { id: noteId },
    data: parsed.data,
  })

  return NextResponse.json(updated)
}

// DELETE /api/staff/[id]/notes/[noteId] — author or ADMIN.
export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string; noteId: string }> }
) {
  const { id, noteId } = await params
  const access = await requireNoteAccess(id)
  if (!access.ok) return access.response

  const note = await loadNote(noteId, id, access.org.id)
  if (!note) return NextResponse.json({ error: "Note not found" }, { status: 404 })
  if (note.authorUserId !== access.caller.id && access.caller.role !== "ADMIN") {
    return NextResponse.json(
      { error: "Only the author or an admin can delete a note" },
      { status: 403 }
    )
  }

  await prisma.managerNote.delete({ where: { id: noteId } })
  return NextResponse.json({ success: true })
}
