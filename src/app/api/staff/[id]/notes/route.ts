import { NextResponse } from "next/server"
import { z } from "zod"
import { prisma } from "@/lib/prisma"
import { NOTE_CATEGORIES } from "@/lib/manager-notes"
import { requireNoteAccess } from "./access"

const createSchema = z.object({
  category: z.enum(NOTE_CATEGORIES),
  body: z.string().trim().min(1),
})

// POST /api/staff/[id]/notes — add a manager note to a staff member.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const access = await requireNoteAccess(id)
  if (!access.ok) return access.response

  const parsed = createSchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json(
      { error: "A category and a non-empty note body are required" },
      { status: 400 }
    )
  }

  const note = await prisma.managerNote.create({
    data: {
      organizationId: access.org.id,
      staffMemberId: id,
      authorUserId: access.caller.id,
      category: parsed.data.category,
      body: parsed.data.body,
    },
  })

  return NextResponse.json(note, { status: 201 })
}
