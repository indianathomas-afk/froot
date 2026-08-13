# DOC-1 Phase B — Assign dialog, visibility toggle, audience legibility

TIER 3 — structural. Plan-first with hard stops. One phase, no riders.

## What this session is

Phase A (work `d728da4`, docs `3222188`, verified on staging 2026-08-12,
org `org_3G02wO4QlVVSWppi8aqlnSZnsDa`) built the audience machinery: the
`HrDocumentGrant` model (`@@map("HrDocumentStoreAssignment")`), the policy
module `src/lib/hr-documents-access.ts`, and ten call sites routed through
it. New uploads are born `appliesTo: "selected"` with zero grant rows —
ADMIN-only. There is currently NO writer for grants anywhere in the
application. Phase B builds the writer and the admin surfaces:

1. **The assign dialog** on `/hr/documents` — modeled in spirit on the
   HR-22 training bulk-assign dialog (recipients: store sweeps with reach
   counts, individual staff picks, corporate never swept). Differences from
   training are structural and deliberate: training materializes
   assignments (snapshot); documents write GRANTS (standing rules). The
   dialog edits the document's audience, it does not stamp per-person rows.
2. **The visibility toggle** — expose the existing `HrDocument.isActive`
   flag as an ADMIN control on each library row. Hide, never delete. Verify
   every Phase A read path already respects `isActive` (the library page
   filters on it; confirm the download route, signing surfaces, /my, and
   /staff tabs do too — any that don't is a FIX NOW within scope).
3. **Audience chips** in the library list — each row shows its reach at a
   glance: "Everyone", "N stores", "N people", "N stores · N people", or
   "Unassigned". Admins currently cannot tell a locked document from a
   company-wide one by looking.

Work on `staging`. Do not push. Two-commit pattern; `npm run build` gates
commits; touched-files eslint is a courtesy check only (DEBT-33). The
untracked drafts in `docs/prompts/` stay untouched.

## Rulings to transcribe into the DOC-1 board row (docs commit)

Gary, 2026-08-12, verbatim ratifications from planning chat:

- "Ruling: MANAGER store-scoped document read is ratified." (Phase A's
  flagged decision — now official.)
- Audience-change ruling, ratified in four scenarios: audience changes
  never delete or alter signature data. Completed signed records are
  permanent regardless of audience edits (extends ruling 4). Partial
  signing progress is preserved and frozen when a person leaves the
  audience, and resumes if they re-enter. Compliance denominators always
  reflect the CURRENT audience — signatures from people no longer in the
  audience remain in their personal records but do not count toward the
  document's completion figures. Narrow-then-restore is lossless.

## Semantics the dialog must implement

- "Everyone in my company" → `appliesTo = "all"`; any grant rows are left
  in place but dormant (they become live again if the admin later narrows —
  this is what makes scenario 2's restore lossless; note this in the UI
  copy or the plan, whichever fits).
- "Choose stores or people" → `appliesTo = "selected"`; grant rows govern.
  STORE rows for checked stores, STAFF rows for picked individuals.
  Corporate staff are NEVER included by a store row (R3; the policy already
  enforces this — the dialog's reach counts must agree with the policy, not
  recompute their own rule).
- Reach counts: per store, count staff the policy would actually reach
  (active, non-corporate, rostered to that store). The number shown must be
  derived from the same logic as `grantedToStaff`/its query twin — reuse,
  don't reimplement. Reach-count drift between dialog and policy is the
  class of bug this codebase names; if exact reuse is impossible, the plan
  must say how agreement is verified.
- Editing an existing audience: the dialog opens pre-populated with the
  current state and writes the delta (or replaces the row set — propose
  which, with reasoning about the unique constraints).
- ADMIN-only, on the canManage seam (one gate, widening later is a string
  change). API: propose the route shape — likely
  `PUT /api/hr/documents/[id]/audience` — behind
  `requireHrDocumentAccess({admin:true})` like every other config write.

## Scope boundaries

- NO changes to the policy module's semantics. The dialog is a writer for
  state the policy already reads. If building the dialog reveals a policy
  gap, that is a RULING NOW, not a quiet fix.
- NO compliance-counter work — audience-scoped denominators are Phase C.
  (The chips count REACH, not signatures; that is why they are in scope.)
- NO changes to signing flows, signed records, or partial-progress
  handling. Scenario 4's freeze/resume should already fall out of Phase A's
  gating — the plan must VERIFY that (what happens today to an in-progress
  signing when the doc leaves the person's audience?) and report, not
  build. If the current behavior violates the ruling (e.g. progress is
  destroyed, or the person can complete a signing they can no longer
  access), that is a RULING NOW with the observed behavior stated.
- FillableForm surfaces untouched. `canReadHrSignedRecord` untouched.

## Hard stops

1. After the audit (current dialog patterns — read the HR-22 bulk-assign
   client and API for the recipients pattern; the library client; the
   isActive read-path check), before the plan.
2. After the plan, before any file is touched.
3. This phase should need NO migration. If the plan discovers it needs
   schema, stop — that is a RULING NOW back to planning chat.

## Evidence rules (absolute)

- Database results carry the branch identity in the same output — dev
  `br-broad-wave` / staging `br-square-feather` / production
  `br-sparkling-block`. Never `preview/main`.
- Browser observations name the org id
  (`org_3G02wO4QlVVSWppi8aqlnSZnsDa`) and Clerk instance
  (`verified-snapper-7`), captured before testing.
- No `&&` chains except the established commit-gate chain. Re-measure,
  don't cite.

## Verification expected before the work commit

Functional, on dev, fixtures cleaned up and removal asserted:
- Assign a doc to one store → policy reaches that store's non-corporate
  staff and nobody else; dialog's reach count equals the measured count.
- Add an individual corporate pick → exactly that person gains access.
- Flip to Everyone → all reached; flip back → prior grant rows govern
  again (scenario 2 losslessness).
- Toggle isActive off → document disappears from every non-admin read
  path; toggle on → returns.
- Chips render correctly for: all, stores-only, people-only, mixed,
  unassigned, inactive.

## Session end

Scope triage (FIX NOW / RULING NOW / COMMENT NOT A ROW / ROW), then the
report in plain English with work and docs SHAs. Do not push. Note for the
promotion checklist (unchanged from Phase A): before any production
promotion, hard stop 4 — production `HrDocument` count with branch column
in-output; nonzero stops the promotion. Also outstanding from Phase A
verification: the STORE-login (shared iPad) staging walk-through has not
yet been observed — flag it in the report so it lands before promote day.
