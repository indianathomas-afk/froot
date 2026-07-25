import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { getActiveStaffSelf } from "@/lib/auth"
import { getHrFileDownloadUrl, hrPathnameFromUrl } from "@/lib/hr-files"
import { requireHrTrainingManageAccess } from "../../../access"

// GET /api/hr/training/resources/[id]/download — authorized delivery for
// private training blobs: resolve + org-scope the resource, then 307 to a
// short-lived signed URL. Two tiers (HR-7 widened the route, not the blob
// store; HR-17 widened tier 1 from ADMIN to the manage tier so the preview
// page's file links work for managers): ADMIN reaches any resource in the
// org, MANAGER resources of modules that apply to one of their stores; an
// ACTIVE staff member reaches resources of lessons in modules ASSIGNED to
// them (rule 3 — their own training material, nothing else). A MANAGER whose
// store scope misses falls through to the staff tier, since they may still
// be assigned the module as a trainee. Lesson reference files only —
// signed-record/cert PDFs live on other routes with the stricter policy.
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params

  const manage = await requireHrTrainingManageAccess()
  if (manage.ok) {
    // Cross-org or unknown IDs 404 — don't leak existence.
    const resource = await prisma.trainingResource.findFirst({
      where: {
        id,
        trainingLesson: {
          trainingModule: {
            organizationId: manage.org.id,
            ...(manage.isAdmin
              ? {}
              : {
                  OR: [
                    { appliesTo: "all" },
                    { storeAssignments: { some: { storeId: { in: manage.storeIds } } } },
                  ],
                }),
          },
        },
      },
    })
    if (resource) {
      return NextResponse.redirect(await getHrFileDownloadUrl(hrPathnameFromUrl(resource.fileUrl)), 307)
    }
    if (manage.isAdmin) return NextResponse.json({ error: "Not found" }, { status: 404 })
  }

  const self = await getActiveStaffSelf()
  if (!self.ok) {
    // Unassigned, terminated, or feature-off all read the same: this
    // resource does not exist for you.
    return NextResponse.json({ error: "Not found" }, { status: 404 })
  }
  const resource = await prisma.trainingResource.findFirst({
    where: {
      id,
      trainingLesson: {
        trainingModule: {
          organizationId: self.org.id,
          assignments: { some: { staffMemberId: self.staffMember.id } },
        },
      },
    },
  })
  if (!resource) return NextResponse.json({ error: "Not found" }, { status: 404 })

  const signedUrl = await getHrFileDownloadUrl(hrPathnameFromUrl(resource.fileUrl))
  return NextResponse.redirect(signedUrl, 307)
}
