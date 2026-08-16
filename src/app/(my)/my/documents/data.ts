import { prisma } from "@/lib/prisma"
import { staffAudienceWhere } from "@/lib/hr-documents-access"
import { documentCompletion } from "@/lib/hr-completion"

// Required-acknowledgment status rows for ONE staff member — the /my twin of
// the /staff/[id] Documents-tab query, version-pinned the same way: a signed
// record binds to the version signed.
//
// [SUPERSEDED 2026-08-15 BY R2] "…a re-upload flips status to needs-current
// while the old record stays (managers can retrieve it — staff never download
// PDFs, rule 5)."
//
// R2 (Gary, 2026-08-15): A RE-UPLOAD NO LONGER FLIPS ANYTHING FOR AN EXISTING
// SIGNER. The record binding to the version signed is the half that survives,
// and R2 is what that binding was always for — the version a person signed is
// their master document, so they keep it, stay green, and are not re-prompted.
// Only a REHIRE (a new signing cycle) reaches needs-current now. Rule 5 is
// untouched: no signed PDF is downloadable here, and the read-only notice on
// page.tsx links the SOURCE document through the audience-aware route the
// Library already uses, never a certificate and never the ceremony.
//
// DOC-1 A: the hand-written appliesTo/store OR clause became
// staffAudienceWhere. Same shape, one behaviour change — corporate staff are no
// longer reached by store grants (R3), which could not have mattered before
// because no grant row had ever existed. Ruling 7: for an Acknowledgment,
// being in the audience IS the obligation to sign, so this list is both what
// the staff member sees and what compliance counts.
// R1 (Gary, 2026-08-15): "pending-record" is GONE from this union. It used to
// sit between "signed" and "needs-current" and every consumer collapsed it into
// "signed" — the green badge, the Completed section, and "All caught up —
// nothing to sign." THIS IS THE TYPE THAT LIED. The state it named still
// exists and is now the `recordMissing` flag, which no switch arm can render as
// completion by omission.
export type MyDocumentRow = {
  documentId: string
  title: string
  category: string | null
  status: "signed" | "needs-current" | "in-progress" | "not-started"
  currentVersionNumber: number
  /**
   * R2 (Gary, 2026-08-15): the version THIS SIGNER is bound to. Distinct from
   * `currentVersionNumber` and the whole point of the ruling — "the current
   * version" and "the version this signer is bound to" are two facts, and this
   * type carried only the first, so a signer fully covered by the document they
   * actually signed was rendered as owing something. Null when no record exists.
   */
  signedVersionNumber: number | null
  /** R2: signed, but on a superseded version. Drives the read-only notice. */
  signedOnEarlierVersion: boolean
  completedAt: string | null
  ackedCount: number
  requiredCount: number
  /** Every checkpoint in, no signed record. In progress, and only an admin can move it. */
  recordMissing: boolean
}

export async function requiredDocumentRows(staffMember: {
  id: string
  organizationId: string
  signingCycle: number
  isCorporate: boolean
  storeAssignments: { storeId: string }[]
}): Promise<MyDocumentRow[]> {
  const docs = await prisma.hrDocument.findMany({
    where: {
      organizationId: staffMember.organizationId,
      kind: "Acknowledgment",
      isActive: true,
      requiresAcknowledgment: true,
      ...staffAudienceWhere(staffMember),
    },
    include: {
      // HR-11n: retired checkpoints leave the denominator (see hr-compliance.ts).
      checkpoints: { where: { required: true, retiredAt: null }, select: { id: true } },
      versions: {
        orderBy: { versionNumber: "desc" },
        include: {
          // R2: ordering added — a record now SELECTS a version to display, and
          // a rehire holds two records on one version across two cycles. See the
          // twin note on staff/[id]/page.tsx.
          signedRecords: {
            where: { staffMemberId: staffMember.id },
            orderBy: [{ signingCycle: "desc" }, { completedAt: "desc" }],
          },
          acknowledgments: {
            where: { staffMemberId: staffMember.id },
            select: { checkpointId: true, signingCycle: true },
          },
        },
      },
    },
    orderBy: { title: "asc" },
  })

  return docs.flatMap((d) => {
    const current = d.versions.find((v) => v.isCurrent)
    if (!current) return []
    // HR-15 Policy B: only signatures from this tenure (signing cycle) count.
    // A rehire's prior-cycle signature on the current version reads
    // needs-current — they re-read and re-sign the document.
    const currentRecord = current.signedRecords.find(
      (r) => r.signingCycle === staffMember.signingCycle
    )
    const priorCycleRecord = currentRecord ? undefined : current.signedRecords[0]
    const ackedIds = new Set(
      current.acknowledgments
        .filter((a) => a.signingCycle === staffMember.signingCycle)
        .map((a) => a.checkpointId)
    )
    const requiredCount = d.checkpoints.length
    const allAcked = requiredCount > 0 && d.checkpoints.every((c) => ackedIds.has(c.id))
    // ── R2 (HR-11k Phase A, Gary 2026-08-15) ────────────────────────────────
    // Split by CYCLE. `v.signedRecords.length > 0` conflated "signed an older
    // version this tenure" (R2 — signed, not prompted) with "signed it in a
    // previous tenure" (a rehire — needs-current). Versions are ordered
    // versionNumber DESC above, so each find returns the highest match.
    const priorSignedThisCycle = d.versions.find(
      (v) =>
        !v.isCurrent && v.signedRecords.some((r) => r.signingCycle === staffMember.signingCycle)
    )
    const priorSignedPriorCycle = d.versions.find(
      (v) =>
        !v.isCurrent && v.signedRecords.some((r) => r.signingCycle !== staffMember.signingCycle)
    )

    // R1: asked, not restated. This function DID load signedRecords and then
    // let a checkpoint count overrule the answer — which is why the predicate
    // takes the record facts as inputs rather than trusting a caller to have
    // consulted them.
    const completion = documentCompletion({
      hasCurrentCycleRecord: !!currentRecord,
      hasPriorCycleRecordOnCurrentVersion: !!priorCycleRecord,
      hasCurrentCycleRecordOnEarlierVersion: !!priorSignedThisCycle,
      hasPriorCycleRecordOnEarlierVersion: !!priorSignedPriorCycle,
      requiredCount,
      ackedCount: ackedIds.size,
      allRequiredAcked: allAcked,
    })

    return [
      {
        documentId: d.id,
        title: d.title,
        category: d.category,
        status: completion.status,
        currentVersionNumber: current.versionNumber,
        // R1's invariant, unchanged by R2: a version number only ever comes
        // from a record. Every branch here names one.
        signedVersionNumber: currentRecord
          ? current.versionNumber
          : priorCycleRecord
            ? current.versionNumber
            : (priorSignedThisCycle?.versionNumber ??
              priorSignedPriorCycle?.versionNumber ??
              null),
        signedOnEarlierVersion: completion.signedOnEarlierVersion,
        completedAt: currentRecord?.completedAt.toISOString() ?? null,
        ackedCount: ackedIds.size,
        requiredCount,
        recordMissing: completion.recordMissing,
      },
    ]
  })
}
