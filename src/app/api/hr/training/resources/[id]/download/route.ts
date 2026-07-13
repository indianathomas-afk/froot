import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { getHrFileDownloadUrl, hrPathnameFromUrl } from "@/lib/hr-files"
import { requireHrTrainingAccess } from "../../../access"

// GET /api/hr/training/resources/[id]/download — authorized delivery for
// private training blobs: resolve + org-scope the resource, then 307 to a
// short-lived signed URL. ADMIN-only in HR-6; HR-7 widens this route (not the
// blob store) to staff with an assignment on the module.
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const access = await requireHrTrainingAccess()
  if (!access.ok) return access.response

  const { id } = await params
  // Cross-org or unknown IDs 404 — don't leak existence.
  const resource = await prisma.trainingResource.findFirst({
    where: { id, trainingLesson: { trainingModule: { organizationId: access.org.id } } },
  })
  if (!resource) return NextResponse.json({ error: "Not found" }, { status: 404 })

  const signedUrl = await getHrFileDownloadUrl(hrPathnameFromUrl(resource.fileUrl))
  return NextResponse.redirect(signedUrl, 307)
}
