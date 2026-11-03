import { NextResponse } from "next/server"
import { z } from "zod"
import { requireNutrition } from "@/lib/nutrition-access"
import { NutritionFileError, getLabelUploadUrl, inboxKeyPrefix } from "@/lib/nutrition-files"
import { inboxTypeRefusal } from "@/lib/label-inbox"

const bodySchema = z.object({
  fileName: z.string().trim().min(1).max(255),
  contentType: z.string().min(1),
  sizeBytes: z.number().int().positive(),
})

// POST /api/nutrition/labels/upload-url — first leg of an inbox upload: a
// presigned PUT straight to the froot-nutrition store under the org's inbox
// folder, with the type and the 10 MB cap in the signature (N-1b pattern).
// ADMIN (nutrition.manage). N-1e: HEIC is refused up front with the N-1c note
// — register re-checks the stored bytes.
export async function POST(req: Request) {
  const ctx = await requireNutrition("nutrition.manage")
  if ("error" in ctx) return ctx.error

  const parsed = bodySchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: "Invalid body" }, { status: 400 })
  const heic = parsed.data.contentType === "image/heic" || parsed.data.contentType === "image/heif"
  const reason = heic ? inboxTypeRefusal(parsed.data.contentType) : null
  if (reason) return NextResponse.json({ error: reason }, { status: 415 })

  try {
    const { pathname, uploadUrl } = await getLabelUploadUrl({ keyPrefix: inboxKeyPrefix(ctx.org.id), ...parsed.data })
    return NextResponse.json({ pathname, uploadUrl })
  } catch (err) {
    if (err instanceof NutritionFileError) return NextResponse.json({ error: err.message }, { status: err.status })
    throw err
  }
}
