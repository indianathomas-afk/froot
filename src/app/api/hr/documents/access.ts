import { auth } from "@clerk/nextjs/server"
import { NextResponse } from "next/server"
import { getCurrentUser, hrModuleAvailable, requireModule } from "@/lib/auth"
import { HR_BLOB_HOST_SUFFIX } from "@/lib/hr-documents"

// Shared guard for the HR document-library routes (requireNoteAccess pattern).
// Availability gate first, then the per-org add-on toggle — with either off,
// these routes must behave as though the feature does not exist. Reads are
// open to any authenticated org member; pass { admin: true } for the
// upload/manage tier.
export async function requireHrDocumentAccess({ admin = false }: { admin?: boolean } = {}) {
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

  if (admin && viewer.dbUser?.role !== "ADMIN") {
    return fail("Admin access required", 403)
  }

  return { ok: true as const, org: viewer.org, dbUser: viewer.dbUser }
}

// A client-supplied file reference must be a private blob URL inside this
// org's namespace — otherwise a doc/version record could be pointed at a
// public asset or another org's file. head() with our token additionally
// fails for any store our token doesn't own.
//
// DOC-3: the host suffix is now HR_BLOB_HOST_SUFFIX in lib/hr-documents.ts,
// imported rather than repeated. This function REQUIRES that host;
// isValidExternalDocumentUrl (same module) REFUSES it. They are the two halves
// of one rule — a file lives on our blob store and is gated by the download
// route, a Link lives anywhere else — and two copies of the suffix is exactly
// how the halves would drift apart.
export function isOrgHrBlobUrl(url: string, orgDbId: string): boolean {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return false
  }
  return (
    parsed.hostname.endsWith(HR_BLOB_HOST_SUFFIX) &&
    parsed.pathname.startsWith(`/hr/${orgDbId}/`)
  )
}
