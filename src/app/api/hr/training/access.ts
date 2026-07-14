import { auth } from "@clerk/nextjs/server"
import { NextResponse } from "next/server"
import { getCurrentUser, hrModuleAvailable, requireModule } from "@/lib/auth"
import { prisma } from "@/lib/prisma"

// Shared guard for the training-builder routes (requireHrDocumentAccess
// pattern). Availability gate first, then the per-org add-on toggle — with
// either off, these routes must behave as though the feature does not exist.
// HR-6 is authoring only, so every route is ADMIN; HR-7 adds the staff-facing
// read tier with its own policy (assigned staff only), not by loosening this.
export async function requireHrTrainingAccess() {
  const fail = (error: string, status: number) =>
    ({ ok: false as const, response: NextResponse.json({ error }, { status }) })

  const { orgId: clerkOrgId } = await auth()
  if (!clerkOrgId) return fail("Unauthorized", 401)

  if (!hrModuleAvailable(clerkOrgId)) return fail("Not found", 404)
  try {
    await requireModule("hr")
  } catch {
    return fail("HR module is not active", 403)
  }

  let viewer
  try {
    viewer = await getCurrentUser()
  } catch {
    return fail("Unauthorized", 401)
  }

  if (viewer.dbUser?.role !== "ADMIN") {
    return fail("Admin access required", 403)
  }

  return { ok: true as const, org: viewer.org, dbUser: viewer.dbUser }
}

// HR-7 execution tier: assignment CRUD and attested completion are
// ADMIN/MANAGER (the builder above stays ADMIN-only). MANAGER callers get
// their store scope back and every route must check the target staff member
// against it — org-wide reach is ADMIN's alone.
export async function requireHrTrainingManageAccess() {
  const fail = (error: string, status: number) =>
    ({ ok: false as const, response: NextResponse.json({ error }, { status }) })

  const { orgId: clerkOrgId } = await auth()
  if (!clerkOrgId) return fail("Unauthorized", 401)

  if (!hrModuleAvailable(clerkOrgId)) return fail("Not found", 404)
  try {
    await requireModule("hr")
  } catch {
    return fail("HR module is not active", 403)
  }

  let viewer
  try {
    viewer = await getCurrentUser()
  } catch {
    return fail("Unauthorized", 401)
  }

  const role = viewer.dbUser?.role
  if (role !== "ADMIN" && role !== "MANAGER") {
    return fail("Manager or Admin access required", 403)
  }

  return {
    ok: true as const,
    org: viewer.org,
    dbUser: viewer.dbUser!,
    isAdmin: role === "ADMIN",
    storeIds: viewer.dbUser!.storeAssignments.map((a) => a.storeId),
  }
}

// Shared staff-member scope check for the manage tier: ADMIN reaches any
// staff in the org, MANAGER only staff assigned to one of their stores.
// Returns null (caller 404s — don't leak existence) when out of reach.
export async function findManageableStaffMember(
  staffMemberId: string,
  access: { org: { id: string }; isAdmin: boolean; storeIds: string[] }
) {
  const member = await prisma.staffMember.findFirst({
    where: { id: staffMemberId, organizationId: access.org.id },
    include: { storeAssignments: { select: { storeId: true } } },
  })
  if (!member) return null
  if (!access.isAdmin && !member.storeAssignments.some((a) => access.storeIds.includes(a.storeId))) {
    return null
  }
  return member
}

// Training materials are confidential (Keva's handbook says so of its own
// training content) — stricter than the general HR store limits: no DOC/DOCX,
// 10 MB instead of 25.
export const TRAINING_RESOURCE_TYPES: Record<string, string> = {
  "application/pdf": "PDF",
  "image/jpeg": "JPG",
  "image/png": "PNG",
}
export const TRAINING_RESOURCE_MAX_BYTES = 10 * 1024 * 1024
export const TRAINING_RESOURCES_PER_LESSON = 4

export function validateTrainingResourceMeta(
  contentType: string,
  sizeBytes: number
): string | null {
  if (!TRAINING_RESOURCE_TYPES[contentType]) {
    return "Only PDF, JPG, and PNG files are allowed"
  }
  if (sizeBytes > TRAINING_RESOURCE_MAX_BYTES) {
    return "File must be 10 MB or smaller"
  }
  return null
}

// A client-supplied resource URL must be a private blob inside this org's
// TRAINING namespace — narrower than isOrgHrBlobUrl so a training row can
// never point at, say, a signed-record PDF elsewhere in the HR store.
export function isOrgTrainingBlobUrl(url: string, orgDbId: string): boolean {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return false
  }
  return (
    parsed.hostname.endsWith(".private.blob.vercel-storage.com") &&
    parsed.pathname.startsWith(`/hr/${orgDbId}/training/`)
  )
}
