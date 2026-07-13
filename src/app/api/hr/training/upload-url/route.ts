import { NextResponse } from "next/server"
import { z } from "zod"
import { getHrFileUploadUrl, HrFileValidationError } from "@/lib/hr-files"
import { requireHrTrainingAccess, validateTrainingResourceMeta } from "../access"

const bodySchema = z.object({
  fileName: z.string().trim().min(1),
  contentType: z.string().min(1),
  sizeBytes: z.number().int().positive(),
})

// POST /api/hr/training/upload-url — ADMIN. First leg of the private browser
// upload (HR-3 pattern): presigned PUT straight to the private Blob store.
// Training is stricter than the store-wide limits (PDF/JPG/PNG, 10 MB), so
// validate here before minting; registration re-checks against the stored
// blob's authoritative metadata.
export async function POST(req: Request) {
  const access = await requireHrTrainingAccess()
  if (!access.ok) return access.response

  const parsed = bodySchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: "Invalid body" }, { status: 400 })

  const metaError = validateTrainingResourceMeta(parsed.data.contentType, parsed.data.sizeBytes)
  if (metaError) return NextResponse.json({ error: metaError }, { status: 400 })

  try {
    const { pathname, uploadUrl } = await getHrFileUploadUrl({
      keyPrefix: `hr/${access.org.id}/training`,
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
