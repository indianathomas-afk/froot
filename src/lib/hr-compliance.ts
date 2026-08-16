// HR-8 compliance rollup. Everything here is computed live from existing
// records — no stored snapshots, so the numbers always reflect the current
// Neon branch and can never drift per-environment.
//
// Definitions (Gary, 2026-07-22 — see docs/DECISIONS.md):
// - Acknowledgment docs count against the CURRENT version only. All required
//   checkpoints acknowledged = compliant even before the signed PDF is
//   generated (generation is mechanical + idempotent). A record signed against
//   an older version is its own "needs-resign" status, not "not-started".
// - Agreement forms (FillableForm) stay OUT of the compliance percentage —
//   there is no assignment mechanism that says who is *supposed* to hold one.
//   They surface separately, with PendingSupervisor countersigns as the gap.
// - Training: assigned module is compliant when status = "Completed";
//   certification is a separate stricter badge. Past dueDate and not
//   Completed = "overdue", the loudest gap state.
// - Only ACTIVE staff count in rollups; terminated staff keep auditable
//   records but are excluded from every percentage.
//
// DOC-1 PHASE C (2026-08-12) — WHICH DOCUMENTS COUNT IS NOW AN AUDIENCE
// QUESTION. Until this phase every "N of M" figure below was computed over a
// pre-DOC-1 rule that knew only about store assignments. The denominators now
// come from the document's CURRENT audience, asked through the one policy
// function (lib/hr-documents-access.ts). Gary's rulings, 2026-08-12:
//   1. Denominator = the document's CURRENT audience. An audience change moves
//      the denominator, never the signature rows.
//   2. ACTIVE staff only — applied HERE, at the counting layer. THE POLICY
//      MODULE HAS NO EMPLOYMENT-STATUS TEST AND REACHES TERMINATED STAFF; that
//      divergence is deliberate and is not to be closed by adding a status test
//      to grantedToStaff (see :501 and :173).
//   3. STORE grants never reach corporate staff (R3); company-wide ones do.
//   4. Numerator = signatures from people currently IN the audience. Satisfied
//      structurally, not by a filter — see :353.
//   5. Counting READS. Nothing in this file writes, and no audience change ever
//      deletes or alters a signed record.

import { prisma } from "@/lib/prisma"
import { AUDIENCE_INCLUDE, grantedToStaff } from "@/lib/hr-documents-access"
import { documentCompletion } from "@/lib/hr-completion"

export type ComplianceItemStatus =
  | "complete"
  | "in-progress"
  | "needs-resign"
  | "overdue"
  | "not-started"

export type ComplianceDocItem = {
  kind: "document"
  documentId: string
  title: string
  category: string
  status: ComplianceItemStatus
  currentVersionNumber: number
  ackedCount: number
  requiredCount: number
  /**
   * R1: every required checkpoint acknowledged and NO signed record for this
   * cycle. Carried beside `status` (which reads "in-progress") because the
   * distinction is what the admin acts on — this member has nothing left to do
   * and needs an admin, whereas an ordinary in-progress member needs time.
   */
  recordMissing: boolean
  /**
   * R2 (2026-08-15): the signer is bound to an OLDER version than the one in
   * force, and that satisfies the obligation. `status` is "complete" — green,
   * no flag, no warning (R3: "they signed what was in force when they signed
   * it"). Surfaces append "· current is vN"; they do not badge it amber.
   */
  signedOnEarlierVersion: boolean
  /**
   * Version this signer's record was executed against. R2 (2026-08-15) widened
   * this from "when needs-resign" to EVERY status backed by a record — the
   * complete path needs it precisely because it is the one that no longer
   * implies the current version. Null only when no record exists at all.
   */
  signedVersionNumber: number | null
  completedAt: string | null
}

export type ComplianceTrainingItem = {
  kind: "training"
  assignmentId: string
  moduleTitle: string
  status: ComplianceItemStatus
  dueDate: string | null
  certified: boolean
  lessonsDone: number
  lessonsTotal: number
}

export type ComplianceItem = ComplianceDocItem | ComplianceTrainingItem

export type StaffComplianceDetail = {
  staffId: string
  displayName: string
  fullName: string | null
  active: boolean
  /** DEBT-9: work location is the company, not a store — see prisma/schema. */
  isCorporate: boolean
  primaryStoreId: string | null
  primaryStoreName: string | null
  storeIds: string[]
  items: ComplianceItem[]
  requiredTotal: number
  completedCount: number
  pct: number | null
  overdueCount: number
  needsResignCount: number
  inProgressCount: number
}

export type StaffComplianceSummary = {
  requiredTotal: number
  completed: number
  pct: number | null
}

export type StoreComplianceRollup = {
  storeId: string | null // null = staff with no store assignment
  storeName: string
  staffCount: number
  requiredTotal: number
  completedCount: number
  pct: number | null
  fullyCompliant: number
  overdueCount: number
  needsResignCount: number
}

export type AgreementFormRollup = {
  documentId: string
  title: string
  executedCount: number
  pendingCount: number
}

export type PendingCountersign = {
  submissionId: string
  formTitle: string
  staffId: string
  staffName: string
  employeeSignedAt: string
}

export type OrgComplianceRollup = {
  totals: {
    staffCount: number
    requiredTotal: number
    completedCount: number
    pct: number | null
    fullyCompliant: number
    overdueCount: number
    needsResignCount: number
  }
  stores: StoreComplianceRollup[]
  staff: StaffComplianceDetail[]
  agreements: {
    forms: AgreementFormRollup[]
    pending: PendingCountersign[]
  }
}

const pctOf = (completed: number, required: number): number | null =>
  required > 0 ? Math.round((completed / required) * 100) : null

// ─── Core: per-staff compliance details, computed in a fixed set of batched
// queries (never per-staff) ──────────────────────────────────────────────────
//
// ── AMENDED 2026-08-15 (R2, HR-11k Phase A, Gary). READ THIS FIRST. ──────────
//
// The superseded table further down still has a live-looking line in it:
// "signed record on older version → needs-resign". R1 marked the block for a
// different reason and that line survived intact, so it reads as the surviving
// true half. IT IS NOT. R2 overturns it, and this note exists because the line
// is the exact statement of the HR-11f rule R2 replaces:
//
//   [SUPERSEDED 2026-08-15 BY R2] a signed record on an older version is
//   "needs-resign" — non-compliant, and the signer is re-prompted.
//
// UNDER R2, WHICH VERSION THE RECORD IS ON NO LONGER DECIDES COMPLIANCE. THE
// SIGNING CYCLE DOES. A record from THIS tenure satisfies the document whatever
// version carried it (the version a person signed is their master document); a
// record from a PREVIOUS tenure is needs-resign whatever version carried it
// (HR-15 Policy B, untouched). The two used to be one lookup here and are now
// `priorSignedThisCycle` / `priorSignedPriorCycle` at :407.
//
// EXPECT PERCENTAGES TO RISE, and expect that to be reported as a bug too — the
// mirror image of R1's note below, from the same file, four weeks apart in
// spirit and one day apart in fact. Anyone holding a current-tenure signature on
// a superseded version moves from needs-resign to complete. That is the ruling
// working: they signed what was in force when they signed it, and the old number
// said they owed something they had already given. Account for the movement
// before accepting it — a rise here for any OTHER reason is a defect.
//
// ── CORRECTED 2026-08-15 (R1, Gary). THE BLOCK BELOW IS SUPERSEDED. ──────────
//
// The document-status derivation is no longer written here at all. It is
// documentCompletion() in lib/hr-completion.ts, asked per (document, member)
// inside the docItems map below — one exported pure predicate, the
// isSigningBlocked pattern, shared with the five other surfaces that used to
// derive this independently.
//
// WHAT CHANGED IN THE RULE, not just in the location: a full required-checkpoint
// set is NO LONGER COMPLETION. Only an HrSignedRecord for (current version,
// member, current cycle) produces "complete". Checkpoints still drive PROGRESS
// (ackedCount / requiredCount, rendered "2 of 7 checkpoints") and never a
// completed state.
//
// EXPECT PERCENTAGES TO FALL, and expect it to be reported as a bug. Anyone
// whose checkpoints are all in but whose record was never minted moves from
// complete to in-progress, carrying `recordMissing`. Their store's pct drops
// with them. That is the ruling working: the obligation was not discharged, and
// the old number said it was. This is the same class of expected-but-surprising
// movement as the R3 corporate-exclusion note and the archive note further down
// this file — both also written down in advance, for the same reason.
//
// THE SUPERSEDED TEXT IS KEPT BELOW RATHER THAN DELETED (Gary, 2026-08-15;
// CLAUDE.md — nothing is deleted, corrections prepend with dates). It is worth
// reading once: it is an accurate statement of the contract as it stood, and its
// second line is the defect, written down as the rule. This was never drift from
// a documented behaviour. The documented behaviour was the bug.
//
//   [SUPERSEDED 2026-08-15 — the second line is the defect R1 overturns]
//   The document-status derivation mirrors /staff/[id] (HR-4) exactly so the
//   rollup and the profile page can never disagree:
//     signed record on current version → complete
//     all required checkpoints acked   → complete ("pending-record" upstream)
//     signed record on older version   → needs-resign
//     some checkpoints acked           → in-progress
//     otherwise                        → not-started
//
// The "mirrors /staff/[id] exactly" half of that promise is now structural
// rather than aspirational: both call the same function, so they cannot
// disagree by being edited apart.

export async function computeStaffComplianceDetails(
  organizationId: string,
  staffIds?: string[]
): Promise<StaffComplianceDetail[]> {
  if (staffIds && staffIds.length === 0) return []

  // THE MISSING ACTIVE FILTER ON THE staffIds BRANCH IS DELIBERATE AND RULED
  // (Gary, 2026-08-12, DOC-1 C). It looks like an oversight next to ruling 2 and
  // it is not: ruling 2 governs WHO IS COUNTED IN A POPULATION, not whether a
  // terminated person's own profile renders their history. Both callers that
  // pass ids depend on this — getStaffComplianceSummaries hands in the whole
  // /staff roster including TERMINATED members and zeroes them afterwards
  // (:460), and getStaffComplianceDetail passes one id so /staff/[id] can show a
  // terminated member their auditable records. The population denominators are
  // filtered by their own callers, where the claim is actually made
  // (getOrgComplianceRollup, :501). Do not "fix" this line.
  const staff = await prisma.staffMember.findMany({
    where: { organizationId, ...(staffIds ? { id: { in: staffIds } } : { status: "ACTIVE" }) },
    include: {
      storeAssignments: {
        include: { store: { select: { id: true, name: true } } },
        orderBy: [{ isPrimary: "desc" }, { store: { name: "asc" } }],
      },
    },
    orderBy: { displayName: "asc" },
  })
  if (staff.length === 0) return []
  const allStaffIds = staff.map((s) => s.id)

  const [docs, assignments] = await Promise.all([
    prisma.hrDocument.findMany({
      where: {
        organizationId,
        kind: "Acknowledgment",
        isActive: true,
        requiresAcknowledgment: true,
      },
      include: {
        // HR-11n: `retiredAt: null` is part of the DENOMINATOR, not a display
        // filter — a retired step is no longer required of anyone, so leaving it
        // in would hold every member permanently short of completion on a step
        // they can never act on (the ceremony no longer renders it).
        checkpoints: { where: { required: true, retiredAt: null }, select: { id: true } },
        // DOC-1 C: ADOPTED. Phase A left a hand-written rule here and a comment
        // saying so; this is the named shape the policy predicate requires, and
        // the reason the swap is not cosmetic is the field it adds —
        // staffMemberId was NOT selected before, which is the mechanical cause
        // of the STAFF-grant defect described at :353. No extra query: the
        // relation was already being loaded, one column narrower.
        //
        // ARCHIVED DOCUMENTS ARE EXCLUDED BY isActive ABOVE, AND THAT IS THE
        // WHOLE ARCHIVE RULE (ruling, Gary 2026-08-12). Archiving is a
        // FORWARD-LOOKING VISIBILITY decision: it removes a document from active
        // compliance and never reaches backward into records already made —
        // nothing in this file writes, so no signature can be touched by it.
        // NOTE WHAT THAT DOES TO THE NUMBERS, because it will be reported as a
        // bug: archiving IMMEDIATELY CLEARS NON-COMPLIANCE for everyone who
        // never signed. That is correct — the obligation was withdrawn, not
        // met — and it is the same class of expected-but-surprising movement as
        // the R3 note at :353.
        ...AUDIENCE_INCLUDE,
        versions: {
          orderBy: { versionNumber: "desc" },
          select: { id: true, versionNumber: true, isCurrent: true },
        },
      },
      orderBy: { title: "asc" },
    }),
    prisma.trainingAssignment.findMany({
      where: {
        staffMemberId: { in: allStaffIds },
        trainingModule: { organizationId },
      },
      include: {
        trainingModule: {
          select: { title: true, lessons: { select: { id: true } } },
        },
        lessonProgress: { select: { trainingLessonId: true } },
      },
      orderBy: { createdAt: "desc" },
    }),
  ])

  const allVersionIds = docs.flatMap((d) => d.versions.map((v) => v.id))
  const currentVersionIds = docs
    .map((d) => d.versions.find((v) => v.isCurrent)?.id)
    .filter((id): id is string => !!id)

  const [signedRecords, acks] = await Promise.all([
    allVersionIds.length
      ? prisma.hrSignedRecord.findMany({
          where: { hrDocumentVersionId: { in: allVersionIds }, staffMemberId: { in: allStaffIds } },
          select: { hrDocumentVersionId: true, staffMemberId: true, completedAt: true, signingCycle: true },
        })
      : [],
    currentVersionIds.length
      ? prisma.hrDocumentAcknowledgment.findMany({
          where: {
            hrDocumentVersionId: { in: currentVersionIds },
            staffMemberId: { in: allStaffIds },
          },
          select: { hrDocumentVersionId: true, staffMemberId: true, checkpointId: true, signingCycle: true },
        })
      : [],
  ])

  // HR-15 Policy B: signatures count only under the member's current signing
  // cycle — keyed (versionId:staffId:cycle). A record from ANY cycle still
  // marks "was signed before" (versionId:staffId) so a rehire shows
  // needs-resign rather than not-started.
  const recordByVersionStaffCycle = new Map<string, { completedAt: Date }>()
  const recordAnyCycle = new Map<string, { completedAt: Date }>()
  for (const r of signedRecords) {
    recordByVersionStaffCycle.set(`${r.hrDocumentVersionId}:${r.staffMemberId}:${r.signingCycle}`, {
      completedAt: r.completedAt,
    })
    recordAnyCycle.set(`${r.hrDocumentVersionId}:${r.staffMemberId}`, { completedAt: r.completedAt })
  }
  const ackedByVersionStaffCycle = new Map<string, Set<string>>()
  for (const a of acks) {
    const key = `${a.hrDocumentVersionId}:${a.staffMemberId}:${a.signingCycle}`
    if (!ackedByVersionStaffCycle.has(key)) ackedByVersionStaffCycle.set(key, new Set())
    ackedByVersionStaffCycle.get(key)!.add(a.checkpointId)
  }

  const assignmentsByStaff = new Map<string, typeof assignments>()
  for (const a of assignments) {
    if (!assignmentsByStaff.has(a.staffMemberId)) assignmentsByStaff.set(a.staffMemberId, [])
    assignmentsByStaff.get(a.staffMemberId)!.push(a)
  }

  const now = new Date()

  return staff.map((member) => {
    const memberStoreIds = member.storeAssignments.map((a) => a.storeId)
    const primary = member.storeAssignments[0] ?? null

    // The audience subject, assembled from rows already in memory (the fetch
    // above has no `select`, so isCorporate is present — it is read again at
    // :430). No second query and no per-staff read; the batching promise at
    // :195 is unchanged.
    const audienceSubject = {
      id: member.id,
      isCorporate: member.isCorporate,
      storeAssignments: member.storeAssignments.map((a) => ({ storeId: a.storeId })),
    }

    const docItems: ComplianceDocItem[] = docs.flatMap((d) => {
      // ── DOC-1 C: THE DENOMINATOR RULE, ASKED OF THE POLICY ─────────────────
      // Phase A left a hand-written copy of one disjunct of grantedToStaff here
      // and marked it. This is the adoption. Three things were wrong with the
      // copy, and all three are closed by asking instead of restating:
      //
      //   STAFF GRANTS WERE INVISIBLE. The copy tested granteeType "STORE"
      //   only, so a document granted to a named individual never entered that
      //   person's compliance items — while /my/documents showed it to them and
      //   the signing write accepted their signature. Two surfaces disagreeing
      //   about one person and one document.
      //
      //   THE CORPORATE EXCLUSION (R3) WAS ABSENT. Square expands corporate
      //   staff to a StoreStaffAssignment for EVERY store, so any STORE grant
      //   swept every corporate member in — permanently dragging a pct for a
      //   document no surface would ever show them (staffAudienceWhere excludes
      //   them, so /my/documents never listed it).
      //
      //   IT WAS A SECOND EXPRESSION OF ONE RULE, which is the drift class
      //   lib/hr-documents-access.ts exists to prevent.
      //
      // THE PREDICATE, NOT THE QUERY FRAGMENT, AND THAT IS THE DESIGN DECISION.
      // staffAudienceWhere narrows ONE QUERY PER STAFF MEMBER; this function
      // fetches the org's documents once and filters in JS for every member
      // (:147 — "a fixed set of batched queries, never per-staff"). Asking the
      // predicate per (doc, member) keeps that property and still leaves exactly
      // one expression of the audience rule. Same move as DOC-1 B's refusal to
      // add a reachOfStoreGrant() helper beside the real function.
      //
      // RULING 4 IS SATISFIED STRUCTURALLY, NOT BY A FILTER. A signature from
      // someone who has since left the audience (a transfer) stops counting
      // because the DOCUMENT leaves their items here — requiredTotal and
      // completedCount fall together, out of the same array (:422), so the
      // numerator and denominator cannot be drawn from different populations.
      // Their HrSignedRecord and HrDocumentAcknowledgment rows are untouched:
      // this file never writes.
      //
      // ZERO-AUDIENCE DOCUMENTS ("selected" with no grant rows) ARE EXCLUDED
      // FROM EVERY DENOMINATOR, ruled by Gary 2026-08-12. grantedToStaff
      // returns false for everyone, so such a document contributes nothing
      // anywhere — which is the pre-existing behaviour, preserved deliberately
      // rather than inherited by accident. The annunciator for "this document
      // reaches nobody" is the Unassigned WARNING chip DOC-1 B put on the
      // library; a second alarm here would be a second expression of one fact,
      // on a page whose contract is percentages over PEOPLE, contributing a
      // number that is zero by definition. Counting it would also manufacture an
      // obligation nobody could discharge — the same shape as the corporate
      // defect above.
      //
      // EXPECT ORG-WIDE REQUIRED TOTALS TO DROP the first time store grants come
      // into real use, as corporate staff stop being swept into store-granted
      // documents. That is R3 working as ratified, and it is expected to be
      // mistaken for a bug.
      if (!grantedToStaff(d, audienceSubject)) return []
      const current = d.versions.find((v) => v.isCurrent)
      if (!current) return []

      const cycle = member.signingCycle
      const currentRecord = recordByVersionStaffCycle.get(`${current.id}:${member.id}:${cycle}`)
      const ackedIds = ackedByVersionStaffCycle.get(`${current.id}:${member.id}:${cycle}`) ?? new Set()
      const requiredCount = d.checkpoints.length
      const allAcked = requiredCount > 0 && d.checkpoints.every((c) => ackedIds.has(c.id))
      // ── R2 (HR-11k Phase A, Gary 2026-08-15) ──────────────────────────────
      // THE SPLIT THAT USED TO BE ONE LOOKUP. This was a single `priorSigned`
      // resolved against `recordAnyCycle`, which asks "did they ever sign an
      // older version, in any tenure". That question cannot tell R2's case from
      // a rehire's, and R2 turns one of them green. `d.versions` is ordered
      // versionNumber DESC (:259), so both finds return the HIGHEST matching
      // version — for R2 that is this signer's master document.
      //
      // recordByVersionStaffCycle is built over allVersionIds, not just the
      // current one (:280, :308), so the cycle-keyed answer needs no new query.
      const priorSignedThisCycle = d.versions.find(
        (v) => !v.isCurrent && recordByVersionStaffCycle.has(`${v.id}:${member.id}:${cycle}`)
      )
      // Rehire on an older version: a record exists but not under this tenure.
      // Asked per version so a version carrying BOTH a this-cycle and an
      // earlier-cycle record is not miscounted as a rehire — it is R2's case,
      // and the predicate's arm order settles it either way.
      const priorSignedPriorCycle = d.versions.find(
        (v) =>
          !v.isCurrent &&
          recordAnyCycle.has(`${v.id}:${member.id}`) &&
          !recordByVersionStaffCycle.has(`${v.id}:${member.id}:${cycle}`)
      )
      // R2 ruling 2026-08-16: the DATE comes from the record they actually
      // signed, never the current version's. Same map, same key as the version
      // number above — so the number and the date describe ONE record and
      // cannot name two.
      const priorRecordThisCycle = priorSignedThisCycle
        ? recordByVersionStaffCycle.get(`${priorSignedThisCycle.id}:${member.id}:${cycle}`)
        : undefined
      // Rehire: a current-version record from an earlier tenure doesn't
      // satisfy this cycle — needs-resign, same loudness as a version bump.
      const priorCycleRecord =
        !currentRecord && recordAnyCycle.has(`${current.id}:${member.id}`)

      // ── R1: ASKED, NOT RESTATED (Gary, 2026-08-15) ────────────────────────
      // The same move DOC-1 C made for the audience rule at the grantedToStaff
      // call above — this file used to hold one of six hand-written copies of
      // the completion derivation, and all six were wrong in the same way.
      // This is the adoption. `complete` here maps to the predicate's `signed`;
      // the local vocabulary keeps "needs-resign" (this module's word) where the
      // predicate says "needs-current".
      const completion = documentCompletion({
        hasCurrentCycleRecord: !!currentRecord,
        hasPriorCycleRecordOnCurrentVersion: priorCycleRecord,
        hasCurrentCycleRecordOnEarlierVersion: !!priorSignedThisCycle,
        hasPriorCycleRecordOnEarlierVersion: !!priorSignedPriorCycle,
        requiredCount,
        ackedCount: ackedIds.size,
        allRequiredAcked: allAcked,
      })

      const status: ComplianceItemStatus =
        completion.status === "signed"
          ? "complete"
          : completion.status === "needs-current"
            ? "needs-resign"
            : completion.status

      return [
        {
          kind: "document" as const,
          documentId: d.id,
          title: d.title,
          category: d.category,
          status,
          currentVersionNumber: current.versionNumber,
          ackedCount: ackedIds.size,
          requiredCount,
          recordMissing: completion.recordMissing,
          signedOnEarlierVersion: completion.signedOnEarlierVersion,
          // ── R2 (2026-08-15): THE NUMBER IS NO LONGER NULLED OFF THE WARNING
          // PATH. It used to be `status !== "needs-resign" ? null : …`, which
          // was safe only while every non-warning signature was on the current
          // version. R2 makes "complete" the case that most needs it: a signer
          // bound to v4 while v6 is in force reads complete, and nulling the
          // number here would leave the surfaces printing v6 at them.
          //
          // THE R1 INVARIANT IS PRESERVED VERBATIM — A VERSION NUMBER ONLY EVER
          // COMES FROM A RECORD. Each branch names a record that exists: this
          // cycle's on the current version, a prior cycle's on the current
          // version, this cycle's on an older version (R2), or a prior cycle's
          // on an older version. There is no branch that reports a version
          // nobody signed, which is exactly the branch R1 deleted.
          signedVersionNumber: currentRecord
            ? current.versionNumber
            : priorCycleRecord
              ? current.versionNumber
              : (priorSignedThisCycle?.versionNumber ??
                priorSignedPriorCycle?.versionNumber ??
                null),
          // Ruled 2026-08-16. Was `currentRecord?.completedAt ?? null`, which
          // left an R2 signer's badge reading "Signed v5 · current is v6" with
          // no date where it used to carry one. Only the R2 branch is added:
          // the rehire path stays null exactly as before, because no surface
          // renders a date on needs-resign and widening it further would be an
          // unruled change wearing a display fix's clothes.
          completedAt:
            (currentRecord ?? priorRecordThisCycle)?.completedAt.toISOString() ?? null,
        },
      ]
    })

    const trainingItems: ComplianceTrainingItem[] = (
      assignmentsByStaff.get(member.id) ?? []
    ).map((a) => {
      const lessonIds = new Set(a.trainingModule.lessons.map((l) => l.id))
      const lessonsDone = a.lessonProgress.filter((p) => lessonIds.has(p.trainingLessonId)).length

      let status: ComplianceItemStatus
      if (a.status === "Completed") status = "complete"
      else if (a.dueDate && a.dueDate < now) status = "overdue"
      else if (a.status === "InProgress") status = "in-progress"
      else status = "not-started"

      return {
        kind: "training" as const,
        assignmentId: a.id,
        moduleTitle: a.trainingModule.title,
        status,
        dueDate: a.dueDate?.toISOString() ?? null,
        certified: !!a.certifiedAt,
        lessonsDone,
        lessonsTotal: a.trainingModule.lessons.length,
      }
    })

    const items: ComplianceItem[] = [...docItems, ...trainingItems]
    const requiredTotal = items.length
    const completedCount = items.filter((i) => i.status === "complete").length

    return {
      staffId: member.id,
      displayName: member.displayName,
      fullName: member.fullName,
      active: member.status === "ACTIVE",
      isCorporate: member.isCorporate,
      primaryStoreId: primary?.store.id ?? null,
      primaryStoreName: primary?.store.name ?? null,
      storeIds: memberStoreIds,
      items,
      requiredTotal,
      completedCount,
      pct: pctOf(completedCount, requiredTotal),
      overdueCount: items.filter((i) => i.status === "overdue").length,
      needsResignCount: items.filter((i) => i.status === "needs-resign").length,
      inProgressCount: items.filter((i) => i.status === "in-progress").length,
    }
  })
}

// ─── /staff list column: batched summaries. Terminated staff always get
// pct null (excluded from percentages; the profile still shows their
// records) ───────────────────────────────────────────────────────────────────

export async function getStaffComplianceSummaries(
  organizationId: string,
  staffIds: string[]
): Promise<Map<string, StaffComplianceSummary>> {
  const details = await computeStaffComplianceDetails(organizationId, staffIds)
  const map = new Map<string, StaffComplianceSummary>()
  for (const d of details) {
    map.set(
      d.staffId,
      d.active
        ? { requiredTotal: d.requiredTotal, completed: d.completedCount, pct: d.pct }
        : { requiredTotal: 0, completed: 0, pct: null }
    )
  }
  return map
}

// ─── /staff/[id] Compliance tab: one member, records shown even when
// terminated (auditable) — the caller renders the exclusion banner ───────────

export async function getStaffComplianceDetail(
  organizationId: string,
  staffId: string
): Promise<StaffComplianceDetail | null> {
  const details = await computeStaffComplianceDetails(organizationId, [staffId])
  return details[0] ?? null
}

// ─── /hr/compliance: the org/store rollup. storeIds null = whole org (ADMIN);
// a manager passes their assigned store ids and sees only staff assigned to
// those stores. Staff are grouped by primary store (same convention as the
// /staff directory) so nobody is double-counted ──────────────────────────────

export async function getOrgComplianceRollup(
  organizationId: string,
  opts: { storeIds: string[] | null }
): Promise<OrgComplianceRollup> {
  const scoped = opts.storeIds !== null

  const scopedStaff = await prisma.staffMember.findMany({
    where: {
      organizationId,
      // DOC-1 C — THIS LINE IS THE COUNTING LAYER RULING 2 NAMES (Gary,
      // 2026-08-12). Compliance denominators count ACTIVE staff only, and the
      // filter lives HERE rather than in the policy module because THE POLICY
      // HAS NO EMPLOYMENT-STATUS TEST OF ANY KIND AND REACHES TERMINATED STAFF.
      // That divergence is named and deliberate, not drift: grantedToStaff
      // answers "does this document apply to this person", which stays true of
      // someone terminated yesterday, and DOC-1 B depends on it — the assign
      // dialog offers terminated grant-holders precisely so a delta save cannot
      // silently revoke them. Adding a status test to the policy would break
      // that and would be invisible from inside either module.
      status: "ACTIVE",
      // DEBT-9: corporate staff are excluded from EVERY store-scoped surface, so
      // a MANAGER never sees them at all — not in By Store, not in the KPI
      // cards, not in the employee table, not in the agreements panel. Excluded
      // HERE, at the fetch, rather than at the byStore grouping below, because
      // "a manager never sees them" is one claim and one filter; filtering only
      // the grouping would leave them in that manager's totals and table.
      // No store manager is responsible for corporate staff, and counting them
      // anywhere store-scoped permanently drags some store's number (Gary,
      // 2026-08-02). ADMIN (storeIds null) is unaffected here and retains them
      // in totals and the employee table — only the byStore grouping skips them.
      ...(scoped
        ? { isCorporate: false, storeAssignments: { some: { storeId: { in: opts.storeIds! } } } }
        : {}),
    },
    select: { id: true },
  })
  const staff = await computeStaffComplianceDetails(
    organizationId,
    scopedStaff.map((s) => s.id)
  )

  const stores = await prisma.store.findMany({
    where: {
      organizationId,
      isActive: true,
      ...(scoped ? { id: { in: opts.storeIds! } } : {}),
    },
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  })

  const byStore = new Map<string | null, StaffComplianceDetail[]>()
  for (const s of staff) {
    // DEBT-9: corporate staff are never bucketed under a store. On the ADMIN
    // path they are still in `staff` — and therefore in the org-wide totals and
    // the employee table — so this skip is the ONLY thing keeping them out of
    // By Store. They cannot reach here on a manager's path; the fetch above
    // already dropped them. Not an "Unassigned" bucket either: unassigned means
    // no store on file, which is a data gap someone should fix. Corporate is
    // the answer, not the absence of one.
    if (s.isCorporate) continue
    // A member whose primary store is outside a manager's scope still appears
    // under one of the manager's stores they're assigned to.
    const groupId =
      scoped && s.primaryStoreId && !opts.storeIds!.includes(s.primaryStoreId)
        ? (s.storeIds.find((id) => opts.storeIds!.includes(id)) ?? null)
        : s.primaryStoreId
    if (!byStore.has(groupId)) byStore.set(groupId, [])
    byStore.get(groupId)!.push(s)
  }

  const storeRollup = (storeId: string | null, storeName: string): StoreComplianceRollup => {
    const members = byStore.get(storeId) ?? []
    const requiredTotal = members.reduce((n, m) => n + m.requiredTotal, 0)
    const completedCount = members.reduce((n, m) => n + m.completedCount, 0)
    return {
      storeId,
      storeName,
      staffCount: members.length,
      requiredTotal,
      completedCount,
      pct: pctOf(completedCount, requiredTotal),
      fullyCompliant: members.filter((m) => m.requiredTotal > 0 && m.pct === 100).length,
      overdueCount: members.reduce((n, m) => n + m.overdueCount, 0),
      needsResignCount: members.reduce((n, m) => n + m.needsResignCount, 0),
    }
  }

  const storeRollups = [
    ...stores.map((s) => storeRollup(s.id, s.name)),
    ...(byStore.has(null) ? [storeRollup(null, "Unassigned")] : []),
  ].filter((r) => r.staffCount > 0)

  const requiredTotal = staff.reduce((n, m) => n + m.requiredTotal, 0)
  const completedCount = staff.reduce((n, m) => n + m.completedCount, 0)

  // Agreements panel — outside the percentage by design. Forms are org
  // resources; executed/pending counts are limited to the staff in scope.
  //
  // ── DOC-1 C: AUDITED, AND RULED TO STAY UNFILTERED (Gary, 2026-08-12) ──────
  // This is Phase A's site #11, the one place in HR with no audience rule. It
  // keeps none, on purpose, and the reason is that THIS PANEL HAS NO
  // DENOMINATOR: executedCount and pendingCount are raw submission counts, never
  // rendered as "N of M" (docs/DECISIONS.md, Gary 2026-07-22 — there is no
  // mechanism saying who is SUPPOSED to hold a form, which is why agreements sit
  // outside the compliance percentage entirely). An audience filter here could
  // therefore only ever REMOVE ROWS FROM A LIST; it could not correct a number,
  // because there is no number for it to correct.
  //
  // The row it could remove is a FillableForm born with appliesTo "selected" in
  // the window between Phase A's default flip and Phase B's one-line fix — a
  // form no application code can ever grant an audience to, since the assign
  // dialog 404s FillableForm ids by construction. THAT SET IS EMPTY EVERYWHERE
  // IT COULD EXIST, measured rather than assumed: dev br-broad-wave-a6vpjdw0 has
  // zero such rows (DOC-1 C audit), staging measured 2026-08-12 returned
  // dark_forms=0 on neondb / ep-odd-rain, and production has received no DOC-1
  // code at all. Forms are company-wide by construction anyway —
  // createFillableForm sets appliesTo "all" (lib/hr-forms.ts).
  //
  // So the filter would buy nothing and could delist a real form's history. The
  // DOC-1 C verification measures this panel before and after the phase and
  // asserts the figures identical.
  const staffIdSet = new Set(staff.map((s) => s.staffId))
  const [forms, submissions] = await Promise.all([
    prisma.hrDocument.findMany({
      where: { organizationId, kind: "FillableForm", isActive: true },
      select: { id: true, title: true },
      orderBy: { title: "asc" },
    }),
    staff.length
      ? prisma.formSubmission.findMany({
          where: {
            staffMemberId: { in: staff.map((s) => s.staffId) },
            version: { hrDocument: { organizationId, kind: "FillableForm" } },
          },
          select: {
            id: true,
            status: true,
            formTitle: true,
            staffMemberId: true,
            employeeSignedAt: true,
            signedAt: true,
            version: { select: { hrDocument: { select: { id: true, title: true } } } },
          },
          orderBy: { signedAt: "asc" },
        })
      : [],
  ])

  const staffNameById = new Map(staff.map((s) => [s.staffId, s.fullName ?? s.displayName]))
  const formRollups = new Map<string, AgreementFormRollup>(
    forms.map((f) => [f.id, { documentId: f.id, title: f.title, executedCount: 0, pendingCount: 0 }])
  )
  const pending: PendingCountersign[] = []
  for (const sub of submissions) {
    const doc = sub.version.hrDocument
    // Submissions on archived forms are records too — keep counting them.
    if (!formRollups.has(doc.id)) {
      formRollups.set(doc.id, {
        documentId: doc.id,
        title: sub.formTitle ?? doc.title,
        executedCount: 0,
        pendingCount: 0,
      })
    }
    const roll = formRollups.get(doc.id)!
    if (sub.status === "Completed") roll.executedCount++
    else if (sub.status === "PendingSupervisor") {
      roll.pendingCount++
      if (staffIdSet.has(sub.staffMemberId)) {
        pending.push({
          submissionId: sub.id,
          formTitle: sub.formTitle ?? doc.title,
          staffId: sub.staffMemberId,
          staffName: staffNameById.get(sub.staffMemberId) ?? "Unknown",
          employeeSignedAt: (sub.employeeSignedAt ?? sub.signedAt).toISOString(),
        })
      }
    }
  }

  return {
    totals: {
      staffCount: staff.length,
      requiredTotal,
      completedCount,
      pct: pctOf(completedCount, requiredTotal),
      fullyCompliant: staff.filter((m) => m.requiredTotal > 0 && m.pct === 100).length,
      overdueCount: staff.reduce((n, m) => n + m.overdueCount, 0),
      needsResignCount: staff.reduce((n, m) => n + m.needsResignCount, 0),
    },
    stores: storeRollups,
    staff,
    agreements: { forms: [...formRollups.values()], pending },
  }
}
