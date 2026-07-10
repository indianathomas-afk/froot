import { auth } from "@clerk/nextjs/server"
import { prisma } from "@/lib/prisma"
import { NextResponse } from "next/server"
import { put } from "@vercel/blob"

// Message photos + documents. The blob is uploaded before the message exists,
// so this returns blob metadata only — the MessageAttachment row is created
// with the message (POST /api/messages).

const IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif"]
const DOCUMENT_TYPES = [
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document", // docx
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", // xlsx
]
const MAX_BYTES = 10 * 1024 * 1024 // 10 MB, matching task attachments

export async function POST(req: Request) {
  const { orgId } = await auth()
  if (!orgId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const org = await prisma.organization.findUnique({ where: { clerkOrgId: orgId } })
  if (!org) return NextResponse.json({ error: "Org not found" }, { status: 404 })

  const form = await req.formData()
  const file = form.get("file") as File | null
  if (!file) return NextResponse.json({ error: "file required" }, { status: 400 })

  const kind = IMAGE_TYPES.includes(file.type) ? "image" : DOCUMENT_TYPES.includes(file.type) ? "document" : null
  if (!kind) {
    return NextResponse.json({ error: "Only images (JPG, PNG, WEBP, GIF) and documents (PDF, DOCX, XLSX) are allowed" }, { status: 400 })
  }
  if (file.size > MAX_BYTES) return NextResponse.json({ error: "File must be 10 MB or smaller" }, { status: 413 })

  const ext = file.name.split(".").pop() ?? "bin"
  const blob = await put(`message-attachments/${org.id}/${Date.now()}.${ext}`, file, {
    access: "public",
    contentType: file.type,
  })

  return NextResponse.json(
    { kind, url: blob.url, filename: file.name, contentType: file.type, sizeBytes: file.size },
    { status: 201 }
  )
}
