import { NextResponse } from "next/server"
import { z } from "zod"
import { prisma } from "@/lib/prisma"
import { findStaffMemberForUser, primaryStoreName } from "@/lib/hr"
import {
  HR_ATTEST_CONSENT_TEXT,
  HR_ATTEST_CONSENT_VERSION,
  HR_ESIGN_CONSENT_TEXT,
  HR_ESIGN_CONSENT_VERSION,
} from "@/lib/hr-documents"
import { ensureSignedRecord, UnconfirmedAnchorsError } from "@/lib/hr-signed-pdf"
import { AUDIENCE_INCLUDE, grantedToStaff } from "@/lib/hr-documents-access"
import { requireHrDocumentAccess } from "../../access"

const bodySchema = z.object({
  // Present = manager-attested capture for that staff member; absent = the
  // signed-in user acknowledging their own (email-matched) staff profile.
  staffMemberId: z.string().min(1).optional(),
  // ESIGN gate — the client cannot submit without it, and the API refuses to.
  consent: z.literal(true),
  // Self-serve: the signer's typed legal name (Signature/Acknowledgment
  // checkpoints). Attested: the manager's own typed name.
  typedName: z.string().trim().min(1).max(200),
  // Self-serve: the store the signer selected to stamp (from their assigned
  // stores). Validated against assignments below.
  storeId: z.string().min(1).optional(),
  entries: z
    .array(
      z.object({
        checkpointId: z.string().min(1),
        // Field → the field's value; Initial → typed initials. Ignored for
        // Signature/Acknowledgment (typedName is the capture).
        value: z.string().trim().max(500).optional(),
      })
    )
    .min(1)
    .max(500),
})

// The audit trail records the connecting client. On Vercel x-forwarded-for is
// set by the platform; first hop is the client.
function requestIp(req: Request): string | null {
  return (
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    req.headers.get("x-real-ip") ||
    null
  )
}

// POST /api/hr/documents/[id]/acknowledgments — the HR-4 capture engine.
// Writes one append-only HrDocumentAcknowledgment per checkpoint, pinned to
// the CURRENT version's hash, with signing-time snapshots and the full ESIGN
// evidence block. Idempotent: re-submitting a checkpoint already signed by
// this staff member for this version is skipped, never overwritten.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const access = await requireHrDocumentAccess()
  if (!access.ok) return access.response
  const { org, dbUser } = access
  if (!dbUser) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const parsed = bodySchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Signature consent and at least one checkpoint are required" },
      { status: 400 }
    )
  }
  const { staffMemberId, typedName, storeId, entries } = parsed.data

  const doc = await prisma.hrDocument.findFirst({
    where: { id, organizationId: org.id, kind: "Acknowledgment", isActive: true },
    include: {
      checkpoints: true,
      versions: { where: { isCurrent: true }, take: 1 },
      ...AUDIENCE_INCLUDE,
    },
  })
  const version = doc?.versions[0]
  if (!doc || !version) {
    return NextResponse.json({ error: "Document not found" }, { status: 404 })
  }

  // ── Resolve who is being signed for, and under which auth method ─────────
  const selfStaff = await findStaffMemberForUser(org.id, dbUser)
  const isAttested = !!staffMemberId && staffMemberId !== selfStaff?.id

  let staff = selfStaff
  if (isAttested) {
    if (dbUser.role !== "ADMIN" && dbUser.role !== "MANAGER") {
      return NextResponse.json(
        { error: "Only managers can record acknowledgments for someone else" },
        { status: 403 }
      )
    }
    staff = await prisma.staffMember.findFirst({
      where: { id: staffMemberId, organizationId: org.id },
      include: {
        storeAssignments: {
          include: { store: true },
          orderBy: [{ isPrimary: "desc" }, { store: { name: "asc" } }],
        },
      },
    })
    if (!staff) return NextResponse.json({ error: "Staff member not found" }, { status: 404 })
    // Managers only attest for staff in their own stores; admins are org-wide.
    if (dbUser.role === "MANAGER") {
      const managerStoreIds = dbUser.storeAssignments.map((a) => a.storeId)
      if (!staff.storeAssignments.some((a) => managerStoreIds.includes(a.storeId))) {
        return NextResponse.json({ error: "Staff member not found" }, { status: 404 })
      }
    }
  }
  if (!staff) {
    return NextResponse.json(
      {
        error:
          "No staff profile is linked to your account. Ask a manager to set your email on your staff record.",
      },
      { status: 403 }
    )
  }
  // HR-7 rule 1: self-serve signing requires an ACTIVE staff profile.
  // Attested capture stays available for terminated staff — backfilling exit
  // paperwork is a manager call.
  if (!isAttested && staff.status !== "ACTIVE") {
    return NextResponse.json({ error: "Your staff profile is no longer active" }, { status: 403 })
  }

  // ── DOC-1 A: THE AUDIENCE CHECK, ON THE WRITE ────────────────────────────
  // Ruling 4 (Gary, 2026-08-12) — the STAFF MEMBER's grant governs, never the
  // signer's. On the attested branch `staff` is the target, so this asks about
  // the right person on both paths, and the manager-scope test above is left
  // doing the job it actually does ("may this manager act for this person").
  //
  // THIS IS A WRITE GUARD AND NOT A DUPLICATE OF THE PAGE'S. The page can only
  // hide a door; this is what stops a signature being recorded against a
  // document the person was never assigned — through a stale tab, a
  // hand-rolled POST, or a grant revoked between page load and submit. It
  // matters more than any read refusal in this phase, because what it prevents
  // is not a leak but a permanent artifact: completing the required set below
  // mints an HrSignedRecord, and ruling 4 makes that record permanent. There is
  // no path that un-signs it later.
  //
  // 403, not 404: the caller already had the document open, so pretending it
  // does not exist would be a lie they can disprove — and a confusing one
  // mid-ceremony.
  if (!grantedToStaff(doc, staff)) {
    return NextResponse.json(
      { error: "This document is not assigned to this team member" },
      { status: 403 }
    )
  }

  // ── HR-11n: DROP entries for checkpoints retired since the page loaded ────
  // A signer who opened the ceremony before an admin retired a step submits
  // entries for it. Those entries are DROPPED and the submission proceeds; a
  // signer mid-signature must be able to finish, so this is never a 400.
  //
  // THE RISK HERE IS THE OPPOSITE OF THE ONE IT LOOKS LIKE. The "Unknown
  // checkpoint" 400 below could never have fired for a retired checkpoint —
  // `checkpoints: true` above is unfiltered, so the row is present in the map
  // and the entry would have sailed through validation and been INSERTED as an
  // acknowledgment against a retired step. The drop has to be written; it does
  // not fall out of any filter applied to the completion gate.
  //
  // The load stays UNFILTERED on purpose: retired and unknown are different
  // answers (drop vs 400) and a filtered load would collapse them into one.
  const liveCheckpoints = doc.checkpoints.filter((c) => c.retiredAt == null)
  const retiredCheckpointIds = new Set(
    doc.checkpoints.filter((c) => c.retiredAt != null).map((c) => c.id)
  )
  const liveEntries = entries.filter((e) => !retiredCheckpointIds.has(e.checkpointId))
  if (liveEntries.length < entries.length) {
    console.info(
      `[hr-11n] dropped ${entries.length - liveEntries.length} entr(ies) for retired checkpoints ` +
        `on document ${doc.id} (staff ${staffMemberId}) — retired mid-ceremony`
    )
  }

  // ── Validate entries against the document's LIVE checkpoints ─────────────
  const checkpointById = new Map(liveCheckpoints.map((c) => [c.id, c]))
  for (const entry of liveEntries) {
    const checkpoint = checkpointById.get(entry.checkpointId)
    if (!checkpoint) {
      return NextResponse.json({ error: "Unknown checkpoint" }, { status: 400 })
    }
    // Self-serve requires the actual capture per type; attested captures the
    // manager's attestation instead (Field values still required).
    const needsValue = checkpoint.type === "Field" || (!isAttested && checkpoint.type === "Initial")
    if (needsValue && !entry.value) {
      return NextResponse.json(
        { error: `"${checkpoint.name}" is missing its ${checkpoint.type === "Field" ? "value" : "initials"}` },
        { status: 400 }
      )
    }
  }

  // ── Build the append-only rows: snapshots + ESIGN evidence ───────────────
  const authMethod = isAttested ? ("ManagerAttested" as const) : ("ClerkSession" as const)
  const methodFor = (type: string) => {
    if (isAttested) return "Attested" as const
    if (type === "Field") return "Field" as const
    if (type === "Initial") return "Initial" as const
    return "Signature" as const // Signature + Acknowledgment: typed legal name
  }
  // Legal identity: signed documents + the Certificate of Acknowledgment use the
  // LEGAL Full Name only — never the operational Display Name. Block signing
  // until it's set (an admin sets Full Name on the staff profile).
  if (!staff.fullName?.trim()) {
    return NextResponse.json(
      {
        error:
          "This team member needs a legal Full Name before signing. Ask an admin to add it on the staff profile.",
      },
      { status: 422 }
    )
  }
  const staffName = staff.fullName.trim()
  // Store to stamp: self-serve uses the signer's SELECTED store (validated
  // against their assignments); a missing selection stamps blank (no store on
  // file). Manager-attested keeps the automatic primary — no selector there.
  //
  // DEBT-9: corporate staff resolve through primaryStoreName() like the attested
  // path, and any submitted storeId is IGNORED. THE SERVER IS THE GUARD, not the
  // hidden picker in signing-client.tsx — a stale tab loaded before the flag was
  // set still holds a nine-store <select> and posts a storeId, and this is the
  // only thing standing between that and a store name frozen into a signed legal
  // record. Client-side hiding is UX; deleting it must not change what is
  // stamped.
  //
  // IGNORED, deliberately, rather than rejected with a 400: failing someone
  // mid-ceremony for a condition they cannot see or fix is worse than a stable
  // correct value (ruling 6, warn-don't-throw). The submitted value is not an
  // attack and not an error — it is a client that has not caught up yet.
  //
  // GATE-WALK FINDING, 2026-08-03 — AN ATTESTED WALK CANNOT TEST THIS GUARD.
  // The order of this disjunct is load-bearing for TESTING, not for behaviour:
  // on the attested path `isAttested` is already true (:83), so
  // `staff.isCorporate` is never evaluated. The corporate branch is reachable
  // ONLY from self-serve.
  //
  // So an attested acknowledgment for a corporate member stamps "Corporate"
  // from primaryStoreName() alone — Phase 2 behaviour, which predates this
  // guard entirely. It would have passed before this line existed. A green
  // attested walk is NOT guard coverage; it is resolver coverage.
  //
  // Testing this line requires a self-serve session AS a corporate staff
  // member: a Clerk login whose email matches the StaffMember, or a
  // StaffMember.userId link. Do not accept an attested result as evidence that
  // a stale client's storeId is ignored — that path never sends one.
  let storeName: string | null
  if (isAttested || staff.isCorporate) {
    storeName = primaryStoreName(staff)
  } else if (storeId) {
    const selected = staff.storeAssignments.find((a) => a.storeId === storeId)
    if (!selected) {
      return NextResponse.json({ error: "That store isn't assigned to you" }, { status: 400 })
    }
    storeName = selected.store.name
  } else {
    storeName = null
  }
  const ipAddress = requestIp(req)
  const userAgent = req.headers.get("user-agent")
  const signedAt = new Date()

  const rows = liveEntries.map((entry) => {
    const checkpoint = checkpointById.get(entry.checkpointId)!
    return {
      checkpointId: checkpoint.id,
      hrDocumentVersionId: version.id,
      staffMemberId: staff.id,
      userId: dbUser.id,
      checkpointName: checkpoint.name,
      checkpointType: checkpoint.type,
      documentTitle: doc.title,
      documentVersionNumber: version.versionNumber,
      documentFileHash: version.fileHash,
      staffName,
      storeName,
      attestationText: checkpoint.attestationText,
      method: methodFor(checkpoint.type),
      typedName,
      fieldValue: checkpoint.type === "Field" ? entry.value ?? null : null,
      signedAt,
      ipAddress,
      userAgent,
      authMethod,
      // HR-15 Policy B: signatures belong to the tenure they were made in —
      // a rehire (bumped cycle) re-acknowledges as fresh rows.
      signingCycle: staff.signingCycle,
      consentGiven: true,
      consentText: isAttested ? HR_ATTEST_CONSENT_TEXT : HR_ESIGN_CONSENT_TEXT,
      consentVersion: isAttested ? HR_ATTEST_CONSENT_VERSION : HR_ESIGN_CONSENT_VERSION,
      ...(checkpoint.type === "Initial" && !isAttested ? { typedName: entry.value } : {}),
    }
  })

  // skipDuplicates rides the @@unique([checkpointId, hrDocumentVersionId,
  // staffMemberId, signingCycle]) constraint — a re-submitted checkpoint is
  // silently skipped within a cycle, so the original record (and its
  // evidence) is never replaced; a rehire's new cycle inserts cleanly.
  // HR-11n: `rows` is empty when EVERY submitted entry was for a checkpoint
  // retired mid-ceremony. That is not an error — the signer has nothing left to
  // do — so completion is computed against the live set below and returned
  // normally. createMany([]) is a no-op, but the guard says why rather than
  // relying on the reader knowing that.
  if (rows.length > 0) {
    // skipDuplicates rides the @@unique([checkpointId, hrDocumentVersionId,
    // staffMemberId, signingCycle]) constraint — a re-submitted checkpoint is
    // silently skipped within a cycle, so the original record (and its
    // evidence) is never replaced; a rehire's new cycle inserts cleanly.
    await prisma.hrDocumentAcknowledgment.createMany({
      data: rows,
      skipDuplicates: true,
    })
  }

  // ── Completion check for the CURRENT version, current cycle ───────────────
  const acked = await prisma.hrDocumentAcknowledgment.findMany({
    where: { hrDocumentVersionId: version.id, staffMemberId: staff.id, signingCycle: staff.signingCycle },
    select: { checkpointId: true },
  })
  const ackedIds = new Set(acked.map((a) => a.checkpointId))
  // R1 (Gary, 2026-08-15): this is CHECKPOINTS COMPLETE — the ceremony's own
  // progress, and nothing more. It used to be called `complete` and be returned
  // under that name, which made this line THE ORIGIN OF THE FALSE STATE: the six
  // display surfaces were faithfully reporting what this route told them.
  // `complete` is now derived from the mint below and means one thing only —
  // a record exists.
  // HR-11n: computed against the LIVE set. A retired step is no longer required
  // of anyone, so it cannot hold a signer short of completion — which is the
  // whole point of the mid-ceremony drop above: entries went away, and the steps
  // they belonged to went away with them.
  const checkpointsComplete = liveCheckpoints.filter((c) => c.required).every((c) => ackedIds.has(c.id))

  // All required checkpoints in: produce the executed artifact synchronously
  // (handbook-size PDFs finish well within the function timeout). A generator
  // failure must not lose the acknowledgments we just wrote — the download
  // path retries ensureSignedRecord lazily, so report and move on.
  let signedRecordId: string | null = null
  // HR-11d 2b: set when layer (c) refused — the version has detected fields and
  // none confirmed. THE CAPTURES ABOVE ARE KEPT: acknowledgments are
  // append-only, carry their own hrDocumentVersionId, and are what the record
  // will be built from once an admin confirms the anchors. Reported rather than
  // swallowed, because the alternative is telling the signer "executed" while
  // no record exists — the same silence this phase exists to remove.
  //
  // NOT A FOURTH GUARD, AND DELIBERATELY NOT A REFUSAL ON THE WRITE. The
  // ceremony saves progressively (signing-client postEntries), so refusing here
  // would strand a signer mid-document — the exact failure R3(i) put layer (b)
  // at the door to avoid. This only changes what the response ADMITS after
  // layer (c) has already declined to mint.
  let signingUnavailable = false
  if (checkpointsComplete) {
    try {
      signedRecordId = (await ensureSignedRecord(version.id, staff.id)).id
    } catch (err) {
      if (err instanceof UnconfirmedAnchorsError) {
        signingUnavailable = true
        console.error(
          `HR-11d: layer (b) was bypassed — ${err.message} (version ${version.id}, staff ${staff.id})`
        )
      } else {
        console.error("HR-4 signed-PDF generation failed", err)
      }
    }
  }

  // ── R1: `complete` IS THE MINT RESULT ────────────────────────────────────────
  // Ruled by Gary 2026-08-15. The flag no longer reports what the signer did; it
  // reports whether a record exists. If ensureSignedRecord throws — for ANY
  // reason — the response says not complete.
  //
  // NOTE WHICH FAILURE THIS CLOSES THAT signingUnavailable DID NOT. That flag
  // narrows exactly one cause, UnconfirmedAnchorsError. Every other generator
  // failure took the `else` branch above, which logs and continues, and then
  // returned complete:true with signedRecordId:null — the same lie with a
  // different cause, and one no client could detect. Deriving from the mint
  // covers both without either client having to enumerate failure modes.
  //
  // signingUnavailable STAYS, and is not now redundant: it distinguishes "no
  // record, and an admin must confirm anchors" from "no record, retry may
  // work", which is what picks the refusal screen over the in-progress screen.
  const complete = signedRecordId !== null

  return NextResponse.json(
    {
      complete,
      // The ceremony still needs its own progress, and this is the honest name
      // for it. A client showing "4 of 7 initialed" reads this; a client
      // claiming a signature reads `complete`.
      checkpointsComplete,
      signedCheckpoints: ackedIds.size,
      signedRecordId,
      signingUnavailable,
    },
    { status: 201 }
  )
}
