import { NextResponse } from "next/server"
import { z } from "zod"
import { getHrFileUploadUrl, HrFileValidationError } from "@/lib/hr-files"
import { requireHrDocumentAccess } from "../access"

const bodySchema = z.object({
  fileName: z.string().trim().min(1),
  contentType: z.string().min(1),
  sizeBytes: z.number().int().positive(),
})

// POST /api/hr/documents/upload-url — ADMIN. First leg of the browser upload:
// returns a short-lived presigned PUT URL so the file goes directly to the
// private Blob store (a Vercel Function 413s on bodies over ~4.5 MB, so the
// file must never travel through our API). The signature pins the content
// type and the 10 MB cap; POST /api/hr/documents registers the record after
// the PUT succeeds.
export async function POST(req: Request) {
  const access = await requireHrDocumentAccess({ admin: true })
  if (!access.ok) return access.response

  const parsed = bodySchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: "Invalid body" }, { status: 400 })

  try {
    const { pathname, uploadUrl } = await getHrFileUploadUrl({
      keyPrefix: `hr/${access.org.id}`,
      ...parsed.data,
    })
    return NextResponse.json({ pathname, uploadUrl })
  } catch (err) {
    if (err instanceof HrFileValidationError) {
      return NextResponse.json({ error: err.message }, { status: err.status })
    }
    throw err
  }
}
