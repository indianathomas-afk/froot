import { NextResponse } from "next/server"
import { z } from "zod"
import { prisma } from "@/lib/prisma"
import { readHrFileMeta } from "@/lib/hr-files"
import { requireManageableStaff } from "../../access"

const bodySchema = z.object({
  // The store URL returned by the presigned PUT (has the store's own suffix).
  fileUrl: z.string().url(),
  fileName: z.string().trim().min(1).max(255),
  title: z.string().trim().min(1).max(200),
  category: z.string().trim().max(60).nullish(),
  visibleToStaff: z.boolean().default(false),
})

// POST /api/staff/[id]/documents — register a manager-uploaded file as a
// StaffDocument. ADMIN / in-scope MANAGER. The blob must already live in THIS
// staff member's namespace inside the private store; metadata (size, type,
// sha256) is read authoritatively from the stored bytes, never trusted from
// the client.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const access = await requireManageableStaff(id)
  if (!access.ok) return access.response

  const parsed = bodySchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: "Invalid request body" }, { status: 400 })
  const { fileUrl, fileName, title, category, visibleToStaff } = parsed.data

  // Namespace pin: the blob must be under hr/{org}/staff-documents/{staffId}/
  // so a registration can't point at another member's file or elsewhere in
  // the HR store.
  const expectedPrefix = `hr/${access.org.id}/staff-documents/${id}/`
  let pathname: string
  try {
    pathname = new URL(fileUrl).pathname.replace(/^\//, "")
  } catch {
    return NextResponse.json({ error: "Invalid file URL" }, { status: 400 })
  }
  if (!pathname.startsWith(expectedPrefix)) {
    return NextResponse.json({ error: "File is outside this staff member's upload space" }, { status: 400 })
  }

  // Authoritative metadata from the stored bytes; head() with our token only
  // resolves blobs in our store, so a foreign URL fails here.
  let meta
  try {
    meta = await readHrFileMeta(fileUrl)
  } catch {
    return NextResponse.json({ error: "Uploaded file could not be read" }, { status: 400 })
  }

  const doc = await prisma.staffDocument.create({
    data: {
      organizationId: access.org.id,
      staffMemberId: id,
      uploadedByUserId: access.dbUser.id,
      title,
      category: category || null,
      fileName,
      fileUrl: meta.url,
      filePathname: pathname,
      contentType: meta.contentType,
      sizeBytes: meta.sizeBytes,
      fileHash: meta.fileHash,
      visibleToStaff,
    },
  })

  return NextResponse.json({ id: doc.id }, { status: 201 })
}
