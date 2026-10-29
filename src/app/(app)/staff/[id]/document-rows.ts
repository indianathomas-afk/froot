import { prisma } from "@/lib/prisma"
import { staffAudienceWhere } from "@/lib/hr-documents-access"
import { documentCompletion } from "@/lib/hr-completion"
import { compareNewestRenewal, memberDisplayZone, newestRenewal, renewalView } from "@/lib/hr-resign"
import { localDateStr } from "@/lib/reports"
import type { StaffDocumentRow } from "./staff-documents"

// HR-4 Documents tab rows for /staff/[id], moved out of page.tsx VERBATIM by
// DOC-7 (2026-10-28) so a fixture can import the real derivation instead of a
// twin (Gary's ordering ruling: "every lookup in … /staff/[id] must always pick
// the newest renewal, with a fixture check that proves it" —
// scripts/verify-doc7-annual-resign.ts). The page calls this under the same
// canSeeHrTabs gate as before; nothing about who sees it changed.
export async function staffDocumentRows(member: {
  id: string
  organizationId: string
  signingCycle: number
  isCorporate: boolean
  storeAssignments: { storeId: string }[]
}): Promise<StaffDocumentRow[]> {
  const docs = await prisma.hrDocument.findMany({
    where: {
      organizationId: member.organizationId,
      kind: "Acknowledgment",
      isActive: true,
      requiresAcknowledgment: true,
      // DOC-1 A: the hand-written OR clause became staffAudienceWhere. The
      // subject is the PROFILE'S OWNER, never the manager reading the page —
      // this tab has always answered "what does this person owe", and the
      // audience rule keeps that subject.
      ...staffAudienceWhere(member),
    },
    include: {
      // DOC-5: the category relation — never the legacy string (F3).
      docCategory: { select: { name: true, colorKey: true } },
      // HR-11n: retired checkpoints leave the denominator (see hr-compliance.ts).
      checkpoints: { where: { required: true, retiredAt: null }, select: { id: true } },
      versions: {
        orderBy: { versionNumber: "desc" },
        include: {
          // R2: ORDERING ADDED, AND IT IS NOW LOAD-BEARING. This was
          // unordered and read as `[0]`, which was nearly harmless while the
          // value only fed a boolean and a download link. R2 makes a record
          // SELECT a version to display, and a rehire holds two records on one
          // version across two cycles, so `[0]` was about to become "whatever
          // Postgres returned". Newest tenure first, newest record first.
          // DOC-7: `renewal` joins the order (newest signing first), but no
          // pick below relies on it — each one compares explicitly (Gary's
          // ordering ruling, 2026-10-28).
          signedRecords: {
            where: { staffMemberId: member.id },
            orderBy: [{ signingCycle: "desc" }, { renewal: "desc" }, { completedAt: "desc" }],
          },
          acknowledgments: {
            where: { staffMemberId: member.id },
            select: { checkpointId: true, signingCycle: true, renewal: true },
          },
        },
      },
    },
    orderBy: { title: "asc" },
  })

  // DOC-7: the engine's zone and today, so the anniversary is the same day.
  const resignZone = await memberDisplayZone(member.id)
  const resignToday = localDateStr(new Date(), resignZone)
  type RecordRow = (typeof docs)[number]["versions"][number]["signedRecords"][number]
  // Newest TENURE first, then the newest renewal within it — stated, not
  // inherited from the query's orderBy.
  const newestAcrossCycles = (rs: RecordRow[]) =>
    [...rs].sort((a, b) => b.signingCycle - a.signingCycle || compareNewestRenewal(a, b))[0]

  return docs.flatMap((d) => {
    const current = d.versions.find((v) => v.isCurrent)
    if (!current) return []
    const cycle = member.signingCycle
    // ── DOC-7 (Gary, 2026-10-28): which signing of this cycle counts ───────
    // lib/hr-resign.ts — the rule every surface reads. No setting → the
    // newest renewal (0 for every pre-DOC-7 row) → the lookups below as they
    // were.
    const renewal = renewalView({
      records: d.versions.flatMap((v) =>
        v.signedRecords.filter((r) => r.signingCycle === cycle).map((r) => ({ ...r, versionId: v.id }))
      ),
      everyMonths: d.reSignEveryMonths,
      setAt: d.reSignEveryMonthsSetAt,
      timeZone: resignZone,
      today: resignToday,
    })
    const countedOn = (v: (typeof d.versions)[number]) =>
      newestRenewal(v.signedRecords.filter((r) => r.signingCycle === cycle && r.renewal === renewal.countedRenewal))
    // HR-15 Policy B: only current-cycle signatures satisfy this tenure. A
    // current-version record from a prior tenure reads "needs-current"
    // (same lever as a version bump) with the old record still on file.
    const currentRecord = countedOn(current) ?? undefined
    // DOC-7: OTHER cycles, asked explicitly — an expired this-cycle record is
    // renewalDue, not a rehire.
    const priorCycleRecord = currentRecord
      ? undefined
      : newestAcrossCycles(current.signedRecords.filter((r) => r.signingCycle !== cycle))
    const ackedIds = new Set(
      current.acknowledgments
        .filter((a) => a.signingCycle === cycle && a.renewal === renewal.countedRenewal)
        .map((a) => a.checkpointId)
    )
    const requiredCount = d.checkpoints.length
    const allAcked = requiredCount > 0 && d.checkpoints.every((c) => ackedIds.has(c.id))
    // ── R2 (HR-11k Phase A, Gary 2026-08-15) ──────────────────────────────
    // `v.signedRecords.length > 0` asked "did they ever sign this older
    // version, in any tenure" — one question standing in for two, and R2
    // answers them oppositely. Split by CYCLE, not by version: versions are
    // already ordered versionNumber DESC above, so each find returns the
    // highest match, and for R2 that is this signer's master document.
    const priorSignedThisCycle = d.versions.find((v) => !v.isCurrent && countedOn(v) !== null)
    const priorSignedPriorCycle = d.versions.find(
      (v) =>
        !v.isCurrent && v.signedRecords.some((r) => r.signingCycle !== member.signingCycle)
    )

    // R1: asked, not restated — the same predicate /my/documents and the
    // compliance rollup use, so this tab and the portal cannot disagree about
    // one person and one document by being edited apart.
    const completion = documentCompletion({
      hasCurrentCycleRecord: !!currentRecord,
      hasPriorCycleRecordOnCurrentVersion: !!priorCycleRecord,
      hasCurrentCycleRecordOnEarlierVersion: !!priorSignedThisCycle,
      hasPriorCycleRecordOnEarlierVersion: !!priorSignedPriorCycle,
      // Case A: read off the version IN FORCE, never off the version signed.
      currentVersionRequiresReacknowledgment: current.requiresReacknowledgment,
      requiredCount,
      ackedCount: ackedIds.size,
      allRequiredAcked: allAcked,
      hasExpiredRecord: renewal.expired,
    })
    // DOC-7: an expired signer is bound to the expired record until they
    // re-sign — its version, its date, its download.
    const expiredRecord = renewal.expired ? renewal.governing : null
    const priorThisCycleRecord = priorSignedThisCycle ? countedOn(priorSignedThisCycle) : null

    return [
      {
        documentId: d.id,
        title: d.title,
        categoryName: d.docCategory?.name ?? null,
        categoryColorKey: d.docCategory?.colorKey ?? null,
        currentVersionNumber: current.versionNumber,
        status: completion.status,
        recordMissing: completion.recordMissing,
        signedOnEarlierVersion: completion.signedOnEarlierVersion,
        reacknowledgmentRequired: completion.reacknowledgmentRequired,
        // ── R1 (Gary, 2026-08-15): A VERSION NUMBER ONLY EVER COMES FROM A
        // RECORD. The `allAcked` arm removed here returned
        // current.versionNumber when NO record existed, so the admin surface
        // printed "Signed v2" for a signature that was never executed — worse
        // than printing nothing, because a version number reads as having been
        // looked up rather than assumed. Each remaining branch names a record
        // that exists: this cycle's, a prior cycle's on the current version, or
        // one on an older version.
        //
        // R2 (2026-08-15) SPLITS THE LAST BRANCH IN TWO and preserves the
        // invariant unchanged — both new branches still name a record. This
        // cycle's older-version record is tried first because it is the one
        // that produces a GREEN label, and picking the rehire's number there
        // would print the wrong version under the right status.
        signedVersionNumber: currentRecord
          ? current.versionNumber
          : priorCycleRecord
            ? current.versionNumber
            : (priorSignedThisCycle?.versionNumber ??
              priorSignedPriorCycle?.versionNumber ??
              (expiredRecord
                ? (d.versions.find((v) => v.id === expiredRecord.versionId)?.versionNumber ?? null)
                : null)),
        // Ruled 2026-08-16: the date comes from the record they actually
        // signed. Resolved from the SAME record object the version number and
        // the download link below resolve from, so all three name one record.
        completedAt: (currentRecord ?? priorThisCycleRecord)?.completedAt.toISOString() ?? null,
        // The record behind the label, in the same precedence as the number
        // above — so the download link and the version it claims can never
        // name two different records.
        signedRecordId:
          currentRecord?.id ??
          priorCycleRecord?.id ??
          priorThisCycleRecord?.id ??
          (priorSignedPriorCycle
            ? newestAcrossCycles(priorSignedPriorCycle.signedRecords.filter((r) => r.signingCycle !== cycle))?.id
            : undefined) ??
          expiredRecord?.id ??
          null,
        ackedCount: ackedIds.size,
        requiredCount,
      },
    ]
  })
}
