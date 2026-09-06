import { auth } from "@clerk/nextjs/server"
import { NextResponse } from "next/server"
import { getCurrentUser, hrModuleAvailable, requireModule } from "@/lib/auth"
import { isValidExternalDocumentUrl } from "@/lib/hr-documents"
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

// HR-24 READ tier: the training LIBRARY, read-only. ADMIN (who also owns the
// builder above) and STORE (the shared floor device — Gary's water-heater case:
// read the procedure on the iPad at the moment it is needed).
//
// A SEPARATE GUARD RATHER THAN A WIDENED ONE, DELIBERATELY. requireHrTrainingAccess
// backs sixteen authoring routes and requireHrTrainingManageAccess eleven
// assignment/capture routes; both keep refusing STORE at exactly the lines they
// did before this session, and the HR-24 report names all twenty-seven. Nothing
// read-only needed to move to open a read path — the guards were already split
// along the line the feature needed.
//
// HR-26 (Gary, 2026-08-12) ADMITTED MANAGER — the row HR-24's comment here said
// this would take. MANAGER had LESS training access than STORE, which is
// backwards: a manager reads the library and assigns from it. The tier that
// existed was extended rather than a third one built.
//
// MANAGER'S SCOPE IS NARROWER THAN STORE'S AND THAT IS NOT AN INCONSISTENCY —
// see the R-h note in lib/training.ts. `storeIds` is returned for that reason,
// and callers must pass it to canReadTrainingModule; ADMIN and STORE ignore it.
//
// STILL NOT A WRITE TIER. This guard backs one route (GET .../library) and the
// two read PAGES. Everything a manager may WRITE goes through
// requireHrTrainingManageAccess, which already admitted store-scoped MANAGER
// before this session and is untouched by it; all sixteen authoring routes stay
// on requireHrTrainingAccess above, also untouched.
//
// STAFF is absent because staff read training through /my/training, scoped to
// their own assignments by a stricter policy. This tier is the library, not an
// assignment.
export async function requireHrTrainingReadAccess() {
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
  if (role !== "ADMIN" && role !== "MANAGER" && role !== "STORE") {
    return fail("Admin, Manager or Store access required", 403)
  }

  return {
    ok: true as const,
    org: viewer.org,
    dbUser: viewer.dbUser!,
    role,
    storeIds: viewer.dbUser!.storeAssignments.map((a) => a.storeId),
  }
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

// ── HR-32: the kind invariant the database cannot hold ──────────────────────
//
// A lesson's linkedHrDocumentId must resolve to an HrDocument in THIS org with
// kind "Link" and isActive — see TrainingLesson in schema.prisma for why no
// CHECK can state that (it is cross-table, the same wall DOC-3 hit with its
// zero-versions invariant). This function and the two callers below it are the
// whole enforcement; there is nothing else holding it anywhere.
//
// TWO CALLERS AND THERE IS NO THIRD. POST /api/hr/training (builder create and
// Duplicate, which composes a full POST body client-side) and
// PATCH /api/hr/training/[id] (builder save). The CSV import route cannot
// carry the field — csv.ts declares a fixed four-field lesson shape and builds
// it from named columns — so it writes NULL and cannot violate the rule. It
// needs no edit and must not get one.
//
// ONE QUERY, NOT ONE PER LESSON: the distinct non-null ids across the whole
// payload, compared by count, exactly the shape of the store-id rider in
// route.ts. Returns an error string or null, matching
// validateTrainingResourceMeta above.
//
// ONE MESSAGE FOR ALL THREE FAILURE MODES, deliberately — wrong kind, inactive,
// and another org's document are indistinguishable in the response, so this
// never confirms that an id exists somewhere else.
export async function validateLessonLinks(
  lessons: { linkedHrDocumentId?: string | null }[],
  orgDbId: string
): Promise<string | null> {
  const ids = [
    ...new Set(lessons.map((l) => l.linkedHrDocumentId).filter((v): v is string => !!v)),
  ]
  if (!ids.length) return null

  const found = await prisma.hrDocument.count({
    where: { id: { in: ids }, organizationId: orgDbId, kind: "Link", isActive: true },
  })
  if (found !== ids.length) {
    return "Linked document must be an active Link document in this organization"
  }
  return null
}

// ── HR-33: the external destination on a lesson ─────────────────────────────
//
// A lesson may point at ONE external destination with its own label —
// "Set up your Square account" → squareup.com. This is NOT the HR-32 document
// case and shares nothing with it: a destination has no audience, no grant and
// no row in the Document Library, so there is no query here and no role gate
// anywhere in the feature.
//
// THE RULE IS THE ONE THE DOCUMENT LIBRARY ALREADY USES. isValidExternalDocumentUrl
// (lib/hr-documents.ts) is imported rather than re-derived: https only, and our
// own private blob host refused so a signed URL can never be laundered into a
// link that bypasses the download route's audience check. Gary, 2026-09-05,
// adopted at approval: one rule for admin-supplied URLs in this feature, not
// two. The prompt for this row asked for http-or-https; https-only is stricter
// on the same axis and keeps a single definition.
//
// WHY THIS IS VALIDATED WHEN videoUrl IS NOT. videoUrl takes any string and
// drops it into an href — a known, accepted COMMENT ruled at DOC-3, and
// deliberately untouched by this row. Not reproducing it on a new column is the
// whole point; "the field next door does it" is not a reason to add a second
// unvalidated href sink.
//
// TWO CALLERS AND THERE IS NO THIRD, exactly as validateLessonLinks above:
// POST /api/hr/training (builder create, and Duplicate, which composes a full
// POST body client-side) and PATCH /api/hr/training/[id]. The CSV import route
// cannot carry these columns — csv.ts declares a fixed four-field lesson shape
// — so it writes NULL and needs no edit.

/** The message BOTH write paths return, so they cannot disagree. */
export const LESSON_EXTERNAL_LINK_ERROR =
  "Enter a full https:// link for the lesson's external link"

/**
 * "" and whitespace mean ABSENT, matching videoUrl's convention in the builder
 * — the form sends "" for an untouched field and that must not become a stored
 * blank or a 400.
 */
function normalizeExternalLink(value: string | null | undefined): string | null {
  const trimmed = value?.trim()
  return trimmed ? trimmed : null
}

/**
 * The two columns as they are written, from one definition so the create map
 * and the update map cannot drift. A LABEL WITH NO URL IS A NO-OP and is stored
 * as NULL rather than rejected: there is nothing for it to label.
 */
export function lessonExternalLinkData(l: {
  externalLinkUrl?: string | null
  externalLinkLabel?: string | null
}): { externalLinkUrl: string | null; externalLinkLabel: string | null } {
  const externalLinkUrl = normalizeExternalLink(l.externalLinkUrl)
  return {
    externalLinkUrl,
    externalLinkLabel: externalLinkUrl ? normalizeExternalLink(l.externalLinkLabel) : null,
  }
}

/**
 * Shape check for every lesson in a payload. Absent stays valid — the field is
 * optional. Returns an error string or null, matching the two validators above.
 */
export function validateLessonExternalLinks(
  lessons: { externalLinkUrl?: string | null }[]
): string | null {
  for (const lesson of lessons) {
    const url = normalizeExternalLink(lesson.externalLinkUrl)
    if (url && !isValidExternalDocumentUrl(url)) return LESSON_EXTERNAL_LINK_ERROR
  }
  return null
}
