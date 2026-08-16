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
// establish the record facts below FOR THE MEMBER'S CURRENT SIGNING CYCLE
// (HR-15 Policy B) and hand them in. A caller that cannot answer
// hasCurrentCycleRecord has not loaded enough to claim a document is signed, and
// that is the shape of the original defect: /my/documents/data.ts DID load
// signedRecords and then let a checkpoint count overrule the answer.

// ─── R2 (HR-11k Phase A): A PRIOR VERSION'S SIGNATURE SATISFIES THE CURRENT ONE
//
// Ruled by Gary 2026-08-15. THE VERSION A PERSON ORIGINALLY SIGNED IS THE MASTER
// DOCUMENT FOR THAT PERSON. A new FILE is a new document and everyone signs it;
// a new VERSION of the same document leaves existing signers' records intact and
// does not re-prompt them. R2 SUPERSEDES HR-11f (2026-08-14), which required
// universal re-acknowledgment on every version bump.
//
// R2 CHANGES ONE FACT INTO TWO, and that split is the whole correctness risk of
// the phase. `hasRecordOnEarlierVersion` used to mean "signed an older version,
// in ANY tenure" and fed a single needs-current arm. It is now:
//
//   hasCurrentCycleRecordOnEarlierVersion  → SIGNED  (R2, new)
//   hasPriorCycleRecordOnEarlierVersion    → needs-current (rehire, unchanged)
//
// IF THE FIRST OF THOSE IS RESOLVED AGAINST AN ANY-CYCLE LOOKUP, a rehired
// employee's previous-tenure signature silently reads as compliant and HR-15
// Policy B is destroyed with nothing failing. The old field is REMOVED rather
// than kept alongside the new pair, deliberately: every call site is a type
// error until it has answered the cycle question, which is the only way a
// caller cannot keep the old meaning by accident.
//
// ARM 2 BEATS R2 (Gary, 2026-08-15, addendum 01 §2.1). A member who has fully
// acknowledged the CURRENT version is bound to the current version even when
// they also hold a completed record on an earlier one — they did the newer
// work, and the fix for a missing record is to mint it, not to call an older
// signature good enough. So `recordMissing` still precedes the R2 arm. The
// converse ordering — R2 beats a PARTIAL acknowledgment set — is below.

/**
 * The four states a required Acknowledgment document can be in for one staff
 * member, in their CURRENT signing cycle.
 *
 * R2 (2026-08-15) removed "on the CURRENT version" from that sentence. The
 * states are about the OBLIGATION, and a signature on the version this person
 * was actually shown discharges it; `signedOnEarlierVersion` on the result says
 * which version carried it. The cycle qualifier is untouched and load-bearing.
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
  /**
   * R2: HrSignedRecord on an older version in THIS cycle. Satisfies the current
   * version — this is the master document for this signer.
   *
   * MUST be resolved cycle-keyed. `signedRecords.length > 0` on an older
   * version is the wrong question and answers row 5's, not this one.
   */
  hasCurrentCycleRecordOnEarlierVersion: boolean
  /**
   * HrSignedRecord on an older version from an EARLIER cycle only. A rehire who
   * signed in a previous tenure — needs-current, unchanged by R2.
   */
  hasPriorCycleRecordOnEarlierVersion: boolean
  /**
   * Case A (R2 Phase B): the CURRENT version demands a fresh signature from
   * everyone, overriding R2. Read off the version in force — NOT off the version
   * this member signed. It is a property of the demand being made now.
   */
  currentVersionRequiresReacknowledgment: boolean
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
   *
   * R2 (2026-08-15) widens WHICH record counts, not whether one is needed: a
   * current-cycle record on an EARLIER version now satisfies the current
   * version. `isSigned` and `status === "signed"` remain the same boolean, as
   * they were under R1 — that identity is what makes the sentence above safe to
   * follow.
   */
  isSigned: boolean
  /**
   * R2: the record satisfying this document is on an OLDER version than the one
   * in force. True only when `status === "signed"` reached that state through
   * the R2 arm. Surfaces render the "an updated version is available to read"
   * notice and the `· current is vN` suffix off this rather than re-deriving it
   * by comparing two version numbers — the comparison is the same derivation
   * this module exists to stop being written six times.
   */
  signedOnEarlierVersion: boolean
  /**
   * Case A (2026-08-16): this member holds a record that WOULD have satisfied
   * the current version under R2, and does not only because the current version
   * demands a fresh signature. `status` is "needs-current".
   *
   * IT IS THE ONLY THING THAT SEPARATES THIS FROM A REHIRE, which carries the
   * same status for an unrelated reason. Surfaces need the distinction because
   * a re-verification signer is still BOUND to the version they signed until
   * they sign again, and a rehire is not bound to anything.
   */
  reacknowledgmentRequired: boolean
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
 *
 * ── AMENDED 2026-08-15 (R2, HR-11k Phase A). ONE ARM INSERTED, NONE MOVED. ───
 * The chain is now: record → allAcked → PRIOR-VERSION RECORD THIS CYCLE → prior
 * cycle → some acks → nothing. Everything above and below the new arm keeps the
 * position it had, so the paragraph above still governs the arms it describes.
 *
 * THE NEW ARM'S TWO NEIGHBOURS ARE BOTH RULED, IN OPPOSITE DIRECTIONS, AND THAT
 * IS WHY IT SITS EXACTLY HERE:
 *
 *   arm 2 (`recordMissing`) BEATS it — a FULL current-version acknowledgment
 *   set means this member did the newer work and is bound to the newer version.
 *
 *   it BEATS the acks arm — a PARTIAL current-version acknowledgment set does
 *   not unbind them from the version they actually signed. Someone who signed
 *   v4 and then opened v6 and initialled two pages reads signed at v4, and
 *   their partial v6 rows are left untouched: they are evidence, they are
 *   harmless, and a later re-verification resumes from them.
 *
 * Moving it either way changes a ruling, not an implementation detail.
 *
 * ── CASE A 2026-08-16 (R2 Phase B). THE R2 ARM GAINS AN OVERRIDE, NOT A SKIP. ─
 * When the CURRENT version carries requiresReacknowledgment, a prior-version
 * record no longer satisfies it and the member reads needs-current.
 *
 * THE DESIGN DOC SAID "row 4 is SKIPPED", AND IMPLEMENTING THAT LITERALLY IS A
 * DEFECT. Skipping the arm falls through to the acks arms, so a member who
 * signed v5 and has touched nothing on v6 would read NOT-STARTED — the surface
 * telling an admin they had never signed anything. THE RECORD DOES NOT STOP
 * EXISTING BECAUSE A RE-SIGNATURE WAS DEMANDED. So the arm RETURNS
 * needs-current itself, which keeps `signedVersionNumber` populated and lets the
 * staff row read "Needs v6 · signed v5" — what they owe, and what they remain
 * bound to until they give it. Corrected by Gary, 2026-08-16.
 *
 * THE FLAG NEVER REACHES ARM 2, and that is ruled rather than incidental. A
 * member who has fully acknowledged the CURRENT version is complete whatever
 * this flag says: they already did the newer work, on the very version demanding
 * it. Only the R2 arm is conditioned — which is why the flag is read inside that
 * arm's test and nowhere above it.
 */
export function documentCompletion(facts: HrDocumentCompletionFacts): HrDocumentCompletion {
  const {
    hasCurrentCycleRecord,
    hasPriorCycleRecordOnCurrentVersion,
    hasCurrentCycleRecordOnEarlierVersion,
    hasPriorCycleRecordOnEarlierVersion,
    currentVersionRequiresReacknowledgment,
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
  else if (hasCurrentCycleRecordOnEarlierVersion)
    status = currentVersionRequiresReacknowledgment ? "needs-current" : "signed"
  else if (hasPriorCycleRecordOnCurrentVersion || hasPriorCycleRecordOnEarlierVersion)
    status = "needs-current"
  else if (ackedCount > 0) status = "in-progress"
  else status = "not-started"

  // Only the R2 arm can produce this: arm 1 reached "signed" through a record on
  // the CURRENT version, so the current-version record wins the label even when
  // an older one also exists.
  const signedOnEarlierVersion =
    status === "signed" && !hasCurrentCycleRecord && hasCurrentCycleRecordOnEarlierVersion

  // Case A: the R2 arm still FIRES on this member — they do hold a
  // current-cycle record on an earlier version — it just resolves the other way.
  // Written as one arm with two outcomes rather than as a skip, so there is no
  // path where that record goes unaccounted for.
  //
  // GATED ON `status`, NOT ON THE TWO INPUTS ALONE, and a fixture caught the
  // difference. Computed from the inputs it read TRUE whenever the flag was set
  // and an older record existed — including when arm 1 or arm 2 had already won,
  // which is exactly when Case A did NOT apply. It is the sibling of
  // `signedOnEarlierVersion` directly above and is derived the same way: from
  // the arm that actually fired. A flag that outlives its own branch is how a
  // surface ends up rendering one state's reason under another state's name.
  const reacknowledgmentRequired =
    status === "needs-current" &&
    hasCurrentCycleRecordOnEarlierVersion &&
    currentVersionRequiresReacknowledgment

  return {
    status,
    isSigned: status === "signed",
    signedOnEarlierVersion,
    reacknowledgmentRequired,
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
