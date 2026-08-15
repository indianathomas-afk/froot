// ─── R1: SIGNED MEANS THE SIGNED RECORD EXISTS ───────────────────────────────
//
// Ruled by Gary 2026-08-15 after a full reproduction on staging. A document is
// signed when an HrSignedRecord row exists for that version, staff member and
// signing cycle. Not before. Completed checkpoints are PROGRESS, not
// COMPLETION, and no surface may turn a checkpoint count into a "Signed" or
// "Completed" state.
//
// WHY THIS FILE EXISTS AT ALL. Before it there were SIX separately written
// derivations of "this document is signed" — hr-compliance.ts, my/documents
// data.ts, staff/[id]/page.tsx, the acknowledgments route, and both ceremony
// clients — that had to agree by discipline and were not required to agree by
// construction. All six treated a full required-checkpoint set as completion,
// so all six were wrong in the same way at the same time. The audit is
// docs/prompts/2026-08-15_COMPLETION_INVENTORY_AUDIT.md.
//
// THE PATTERN IS isSigningBlocked (lib/hr-anchors.ts): one exported PURE
// function, so every surface asserts the shipped predicate rather than a copy of
// it, and a fixture tests the thing that ships. This module imports nothing —
// no Prisma, no server-only code — so the two ceremony CLIENTS can call it too.
// That is not incidental: A5 and A6 in the audit are client components, and a
// predicate they cannot import is a predicate they will reimplement.
//
// WHAT THE CALLER STILL OWES. This function does not query. Every caller must
// establish the three record facts below FOR THE MEMBER'S CURRENT SIGNING CYCLE
// (HR-15 Policy B) and hand them in. A caller that cannot answer
// hasCurrentCycleRecord has not loaded enough to claim a document is signed, and
// that is the shape of the original defect: /my/documents/data.ts DID load
// signedRecords and then let a checkpoint count overrule the answer.

/**
 * The four states a required Acknowledgment document can be in for one staff
 * member, on the CURRENT version, in their CURRENT signing cycle.
 *
 * `pending-record` is deliberately absent. It used to sit here, between
 * `signed` and `needs-current`, meaning "every checkpoint is in but no record
 * exists" — and every consumer collapsed it into `signed`, with the same green
 * badge, because a status that reads like a kind of done invites being treated
 * as done. It is now a FLAG on the result (`recordMissing`) rather than a
 * status, so no switch arm can render it as completion by omission.
 */
export type HrDocumentCompletionStatus =
  | "signed"
  | "needs-current"
  | "in-progress"
  | "not-started"

/** What a caller must establish before it may claim anything about completion. */
export type HrDocumentCompletionFacts = {
  /** HrSignedRecord for (current version, this staff member, CURRENT cycle). */
  hasCurrentCycleRecord: boolean
  /** HrSignedRecord on the current version from an EARLIER cycle (a rehire). */
  hasPriorCycleRecordOnCurrentVersion: boolean
  /** HrSignedRecord on any older version, any cycle. */
  hasRecordOnEarlierVersion: boolean
  /** Required checkpoints on the document. */
  requiredCount: number
  /** Acknowledgments this member holds on the current version, current cycle. */
  ackedCount: number
  /** Every REQUIRED checkpoint acknowledged this cycle. */
  allRequiredAcked: boolean
}

export type HrDocumentCompletion = {
  status: HrDocumentCompletionStatus
  /**
   * The single predicate every surface gates completion on. True only when a
   * record exists. Read this instead of comparing `status` to a string.
   */
  isSigned: boolean
  /**
   * Every required checkpoint is acknowledged and NO record exists for this
   * cycle. The signer has nothing left to do and cannot fix it themselves — an
   * admin confirms the version's anchors, or retries the mint.
   *
   * This is the state the reproduction produced and the portal called "Signed".
   * It is NOT a completion state: `isSigned` is false whenever this is true, and
   * the document stays in the member's TO SIGN list.
   */
  recordMissing: boolean
  requiredCount: number
  ackedCount: number
}

/**
 * Derive completion for one (document, staff member) pair. Pure.
 *
 * PRECEDENCE IS THE PRE-R1 CHAIN, ARM FOR ARM. The old chain was:
 * record → allAcked → prior record → some acks → nothing. R1 changes what the
 * SECOND ARM CLAIMS — it said "complete", it now says in-progress with
 * `recordMissing` — and moves nothing. The ordering predates this ruling and
 * nothing in R1 speaks to it, so re-ordering here would ship an unruled
 * behaviour change under cover of a fix.
 *
 * KEEPING THE ARM IN PLACE IS WHAT MAKES THE RESULT UNAMBIGUOUS TO RENDER.
 * Deleting it instead — the obvious way to write this — would let the
 * allAcked case fall through to `needs-current` whenever the member also holds
 * a record on an older version, so a row could be BOTH "needs current version"
 * AND `recordMissing`, and each of the six surfaces would have to invent its own
 * rule for which to show. Here `recordMissing` implies `in-progress`, always,
 * and no caller has to choose.
 *
 * The case is real, not hypothetical: signed v1 → v2 uploaded → re-read and
 * re-acked all of v2 → mint failed. They do not "need to sign the current
 * version"; they signed it and the record was never made.
 */
export function documentCompletion(facts: HrDocumentCompletionFacts): HrDocumentCompletion {
  const {
    hasCurrentCycleRecord,
    hasPriorCycleRecordOnCurrentVersion,
    hasRecordOnEarlierVersion,
    requiredCount,
    ackedCount,
    allRequiredAcked,
  } = facts

  // requiredCount > 0 guards the vacuous case: a document with no required
  // checkpoints must not report "everything is done but the record is missing",
  // which `every()` over an empty set would otherwise assert.
  const recordMissing = !hasCurrentCycleRecord && requiredCount > 0 && allRequiredAcked

  let status: HrDocumentCompletionStatus
  if (hasCurrentCycleRecord) status = "signed"
  else if (recordMissing) status = "in-progress"
  else if (hasPriorCycleRecordOnCurrentVersion || hasRecordOnEarlierVersion) status = "needs-current"
  else if (ackedCount > 0) status = "in-progress"
  else status = "not-started"

  return {
    status,
    isSigned: hasCurrentCycleRecord,
    recordMissing,
    requiredCount,
    ackedCount,
  }
}

// ─── Copy for the recordMissing state ────────────────────────────────────────
//
// Both strings live beside the predicate so the state and its wording cannot
// drift apart — the failure this whole module exists to prevent, applied to the
// sentence rather than the boolean.
//
// TWO AUDIENCES, RULED SEPARATELY (Gary, 2026-08-15, Q2). The employee copy is
// the R1 verbatim string. "Ask your manager" is nonsense read by the manager who
// IS standing there, so admin surfaces get their own — the same divergence
// HR-11d ruled for SigningUnavailable's `audience` prop, for the same reason.

/** Employee-facing. Verbatim, ruled 2026-08-15. Do not reword. */
export const HR_RECORD_MISSING_SIGNER_COPY = "In progress — ask your manager."

/** Admin-facing. Verbatim, ruled 2026-08-15. Do not reword. */
export const HR_RECORD_MISSING_ADMIN_COPY = "Not signed — ceremony incomplete, no record"
