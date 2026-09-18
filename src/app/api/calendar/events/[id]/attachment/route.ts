import { NextResponse } from "next/server"
import { put, del } from "@vercel/blob"
import { prisma } from "@/lib/prisma"
import { calendarDenialBody, calendarDenialStatus, requireCalendar } from "@/lib/calendar-access"

// POST /api/calendar/events/[id]/attachment — one file per event.
//
// ── R4 (Gary, 2026-09-17): THE PUBLIC STORE, SAME AS TaskAttachment ─────────
//
// Mirrors api/upload/task-attachment/route.ts: same allowed types, same 10 MB
// cap, same replace-in-place, same `access: "public"` on the DEFAULT Blob store
// — so NO NEW STORE AND NO NEW ENV VAR, and this phase does not depend on
// provisioning one in three environments before an upload works anywhere.
//
// THE LIMITATION IS ACCEPTED AND RECORDED RATHER THAN DISCOVERED: a calendar
// attachment gets a public CDN URL that anyone holding the link can fetch, and
// it is the same sensitivity class as a checklist task photo. The HELP-1b
// private-store pattern (signed URLs, same-origin streaming, its own token) is
// deliberately NOT used here. If a calendar attachment ever needs to hold
// something confidential, that is a ruling and a migration to the private
// store — not a quiet change to this line.
const ALLOWED_TYPES = ["application/pdf", "image/jpeg", "image/png"]
const MAX_BYTES = 10 * 1024 * 1024 // 10 MB, matching task-attachment

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const access = await requireCalendar("calendar.manage")
  if (!access.ok) return NextResponse.json(calendarDenialBody(access.reason), { status: calendarDenialStatus(access.reason) })

  const { id } = await params
  const event = await prisma.calendarEvent.findFirst({
    where: { id, organizationId: access.org.id },
    include: { attachment: true },
  })
  if (!event) return NextResponse.json({ error: "Not found" }, { status: 404 })

  const form = await req.formData()
  const file = form.get("file") as File | null
  const label = (form.get("label") as string | null) ?? ""

  if (!file) return NextResponse.json({ error: "file required" }, { status: 400 })
  if (!ALLOWED_TYPES.includes(file.type)) {
    return NextResponse.json({ error: "Only PDF, JPG, and PNG files are allowed" }, { status: 400 })
  }
  if (file.size > MAX_BYTES) return NextResponse.json({ error: "File must be 10 MB or smaller" }, { status: 413 })

  // Replace-in-place, task-attachment's shape: drop the old blob before writing
  // the new one so an edited event does not leak an orphan.
  if (event.attachment) {
    await del(event.attachment.url).catch(() => {})
    await prisma.calendarEventAttachment.delete({ where: { eventId: id } })
  }

  const ext = file.name.split(".").pop() ?? "bin"
  const blob = await put(`calendar-attachments/${access.org.id}/${id}/${Date.now()}.${ext}`, file, {
    access: "public",
    contentType: file.type,
  })

  const attachment = await prisma.calendarEventAttachment.create({
    data: {
      eventId: id,
      label: label || file.name,
      url: blob.url,
      contentType: file.type,
      sizeBytes: file.size,
    },
  })

  return NextResponse.json(attachment, { status: 201 })
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const access = await requireCalendar("calendar.manage")
  if (!access.ok) return NextResponse.json(calendarDenialBody(access.reason), { status: calendarDenialStatus(access.reason) })

  const { id } = await params
  const event = await prisma.calendarEvent.findFirst({
    where: { id, organizationId: access.org.id },
    include: { attachment: true },
  })
  if (!event) return NextResponse.json({ error: "Not found" }, { status: 404 })
  if (!event.attachment) return NextResponse.json({ success: true })

  await del(event.attachment.url).catch(() => {})
  await prisma.calendarEventAttachment.delete({ where: { eventId: id } })
  return NextResponse.json({ success: true })
}
