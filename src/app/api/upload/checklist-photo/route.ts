import { auth } from "@clerk/nextjs/server"
import { prisma } from "@/lib/prisma"
import { getUserStoreScope } from "@/lib/auth"
import { NextResponse } from "next/server"
import { put } from "@vercel/blob"

// CHK-7 — THE EXECUTION PHOTO UPLOAD. New route, and deliberately NOT
// api/upload/task-attachment: that one writes a TaskAttachment against a
// TEMPLATE Task (the reference photo an admin attaches for the crew to look
// at). This is the opposite direction — the photo a crew member SHOOTS as
// evidence, which belongs to the TaskLog of one checklist run.
//
// This route stores the blob and returns its URL. It writes NOTHING to the
// database. The record is written by POST /api/checklists/[id]/task-log, which
// already has a `photoUrl` column and already owns the closed-day 409, the
// task-ownership refusal and the as-executed section freeze. Duplicating that
// write here would give the same fact two authors.
const ALLOWED_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  // HEIC/HEIF are accepted even though the client converts to JPEG before
  // sending (see downscaleToJpeg in the execution client). This is the
  // last-resort passthrough for a device whose canvas cannot re-encode: losing
  // the shot on the floor costs more than a record that some DESKTOP browsers
  // offer as a download instead of rendering inline. iOS renders HEIC natively
  // and iOS is where these are taken. The tradeoff is named on the CHK-7 row.
  "image/heic",
  "image/heif",
]

// 4 MB, deliberately UNDER Vercel's ~4.5 MB request cap and not the 10 MB that
// task-attachment allows. Above the platform cap the request dies before this
// handler runs and the staff member gets an opaque network error instead of a
// sentence; keeping our own limit lower means OUR message is the one they read.
// The client downscales to well under this, so hitting it means something odd.
const MAX_BYTES = 4 * 1024 * 1024

export async function POST(req: Request) {
  const { orgId } = await auth()
  if (!orgId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const org = await prisma.organization.findUnique({ where: { clerkOrgId: orgId } })
  if (!org) return NextResponse.json({ error: "Org not found" }, { status: 404 })

  const form = await req.formData()
  const file = form.get("file") as File | null
  const checklistId = form.get("checklistId") as string | null
  const taskId = form.get("taskId") as string | null

  if (!file || !checklistId || !taskId) {
    return NextResponse.json({ error: "file, checklistId and taskId are required" }, { status: 400 })
  }
  if (!ALLOWED_TYPES.includes(file.type)) {
    return NextResponse.json({ error: "That file is not a photo. Use the camera, or pick a JPG or PNG." }, { status: 400 })
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json({ error: "That photo is too large to send. Try taking it again." }, { status: 413 })
  }

  // The same gates task-log applies, applied here too. An upload route cannot
  // lean on the write that follows it — by then the blob is already stored.
  const checklist = await prisma.checklist.findFirst({
    where: { id: checklistId, organizationId: org.id },
    select: {
      storeId: true,
      closedAt: true,
      status: true,
      template: { select: { tasks: { select: { id: true } } } },
    },
  })
  if (!checklist) return NextResponse.json({ error: "Not found" }, { status: 404 })

  const { isAdmin, storeIds } = await getUserStoreScope()
  if (!isAdmin && !storeIds.includes(checklist.storeId)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }

  // A closed day accepts nothing (CHK-3's R1). Refused here rather than after
  // the blob is written, because task-log's 409 would otherwise leave an
  // orphan photo for a record that can never reference it.
  if (checklist.closedAt != null && checklist.status !== "Completed") {
    return NextResponse.json(
      { error: "This checklist's day has closed and it was recorded as missed. It can no longer be edited." },
      { status: 409 }
    )
  }

  if (!checklist.template.tasks.some((t) => t.id === taskId)) {
    return NextResponse.json({ error: "That task does not belong to this checklist" }, { status: 400 })
  }

  const ext = file.type === "image/png" ? "png"
    : file.type === "image/webp" ? "webp"
    : file.type === "image/heic" || file.type === "image/heif" ? "heic"
    : "jpg"

  // Public store, same as task-attachment and message-attachment: `put` with
  // no `token` option, so the SDK resolves BLOB_READ_WRITE_TOKEN. The private
  // froot-hr and froot-guide stores pass their tokens explicitly and are not
  // touched here.
  const blob = await put(
    `checklist-photos/${org.id}/${checklistId}/${taskId}/${Date.now()}.${ext}`,
    file,
    { access: "public", contentType: file.type }
  )

  return NextResponse.json({ url: blob.url }, { status: 201 })
}
