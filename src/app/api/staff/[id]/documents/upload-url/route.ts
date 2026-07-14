import { NextResponse } from "next/server"
import { z } from "zod"
import { getHrFileUploadUrl, HrFileValidationError } from "@/lib/hr-files"
import { requireManageableStaff } from "../../../access"

const bodySchema = z.object({
  fileName: z.string().trim().min(1),
  contentType: z.string().min(1),
  sizeBytes: z.number().int().positive(),
})

// POST /api/staff/[id]/documents/upload-url — first leg of the private
// browser upload (HR-3 pattern): presigned PUT straight to the froot-hr store
// under this staff member's namespace. ADMIN / in-scope MANAGER. Registration
// re-checks against the stored blob's authoritative metadata.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const access = await requireManageableStaff(id)
  if (!access.ok) return access.response

  const parsed = bodySchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: "Invalid body" }, { status: 400 })

  try {
    const { pathname, uploadUrl } = await getHrFileUploadUrl({
      keyPrefix: `hr/${access.org.id}/staff-documents/${id}`,
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
