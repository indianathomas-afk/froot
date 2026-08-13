# DOC-1 Phase C — Audience-scoped compliance counters

TIER 3 — structural. Plan-first with hard stops. One phase, no riders.

## What this session is

The last leg of DOC-1. Phases A (work `d728da4`, docs `3222188`) and B
(work `e18dd54`, docs `0ebe4d4`) are verified on staging (2026-08-12, org
`org_3G02wO4QlVVSWppi8aqlnSZnsDa`, endpoint `ep-odd-rain` for the DB
checks). Documents now have audiences, an ADMIN assign dialog writes
grants, and ten read paths enforce the policy. What has NOT moved:
compliance math. Every "N of M signed" style figure still counts against
pre-audience assumptions.

Phase C makes completion counting answer the question this whole feature
exists for: "3 of 5 Colorado people have signed the handbook."

In scope, from the Phase A audit's deliberately-parked sites:
- `lib/hr-compliance.ts` compliance rollup (site #10, ~:159/:162) —
  received a mechanical rename only in Phase A, explicitly NOT audience
  adoption. This session is that adoption.
- `lib/hr-compliance.ts` agreements panel (site #11, ~:468/:483) — had no
  audience filter at all.
- Any other surface that renders a completion count or signing-status
  denominator for a document (audit must enumerate: the /hr/documents/[id]
  admin detail, acknowledgment-status routes (HR-3), /staff/[id] tabs'
  counts if any, dashboard compliance widgets if any). The audit lists
  every counter surface and marks each in/out with reasons; anything
  ambiguous is a question at hard stop 1, not a silent choice.

## Ratified rulings that govern the math (transcribed on the DOC-1 row)

1. Denominator = the document's CURRENT audience. Audience changes move
   the denominator, never the signature rows (scenarios 1–3, Gary
   2026-08-12).
2. ACTIVE staff only. The policy has no employment-status test and reaches
   TERMINATED staff — this is the pre-flagged landmine on the DOC-1 row.
   Compliance denominators must count ACTIVE staff; the counting layer
   applies the status filter, the policy module's semantics DO NOT change.
3. Corporate exclusion holds: STORE-grant audiences never include
   corporate staff; company-wide ("all") audiences do.
4. Numerator = signatures from people currently IN the audience.
   A signature from someone who has since left the audience (scenario 1:
   Jamie transferred) stays in their personal record but does not count
   toward the document's completion figures. Numerator and denominator are
   drawn from the same population or the percentages lie.
5. Signed records and partial progress are never deleted or altered by
   anything this session builds. Counting reads; it never writes.

## Design constraints

- One expression of "the audience of document D, as a countable set of
  staff" — built on `grantedToStaff` / its query twin from
  `lib/hr-documents-access.ts`, with the ACTIVE filter applied at the
  counting layer. Do not restate the audience rule inside hr-compliance;
  the reach-count precedent from Phase B (ask the real policy function,
  never write a twin) applies here in full.
- FillableForm rows flow through the agreements panel with no audience
  filter today, and all forms are `appliesTo: "all"` (Phase B's fix). The
  plan must state explicitly how forms are counted and why — expected:
  unchanged behavior, company-wide denominator — rather than letting the
  refactor change form math silently.
- Zero-audience documents ("Unassigned" — `selected` + no grants): the
  plan must propose how these appear in compliance surfaces (excluded?
  shown 0-of-0? flagged?) with a recommendation and reasoning. This is a
  RULING at plan time — expect Gary to rule on it at hard stop 2.
- Inactive (archived) documents: the plan states how they appear in each
  counter surface (expected: excluded from active compliance, historical
  records untouched) and verifies current behavior rather than assuming.
- No migration expected. If the plan discovers it needs schema, stop —
  RULING NOW back to planning chat.
- No policy-module semantic change. No signing-flow change. No writes
  anywhere in counting paths. FillableForm builder surfaces untouched.
  `canReadHrSignedRecord` untouched.

## Hard stops

1. After the audit (every counter surface enumerated, current denominator
   logic of each described, in/out marked), before the plan.
2. After the plan — which must include the zero-audience proposal and the
   forms statement — before any file is touched.
3. Not expected to trigger (no migration). If schema is needed, stop.

## Evidence rules (absolute)

- Database results carry branch identity in the same output — dev
  `br-broad-wave` / staging `br-square-feather` / production
  `br-sparkling-block`. Never `preview/main`.
- Browser observations name the org id
  (`org_3G02wO4QlVVSWppi8aqlnSZnsDa`) and Clerk instance
  (`verified-snapper-7`), captured before testing.
- No `&&` chains except the established commit-gate chain. Re-measure,
  don't cite.

## Verification expected before the work commit

Functional, on dev, fixtures DOC-1C-named, removed, removal asserted.
The fixture set must include at minimum:
- A store-audience Acknowledgment doc where one signer is ACTIVE-in-
  audience, one signer has been moved OUT of the audience (their signature
  must not count; their record must survive — assert both), one audience
  member is TERMINATED (must not appear in the denominator), and one
  corporate staff member (must not appear in a store audience).
- The same doc flipped to "all" — denominator becomes org-wide ACTIVE
  staff including corporate; the out-of-audience signer counts again.
- A zero-audience doc behaving per the hard-stop-2 ruling.
- An archived doc behaving per the plan's stated rule.
- Agreements-panel forms math measured before and after the change and
  asserted identical (forms behavior unchanged).
Every count asserted against an independently-computed expected set, not
against the code under test.

## Session end

Scope triage (FIX NOW / RULING NOW / COMMENT NOT A ROW / ROW), then the
report in plain English with work and docs SHAs. Do not push. The docs
commit updates the DOC-1 row: Phase C status, the zero-audience ruling
transcribed in Gary's words, and the carried checklist restated —
STORE-login (shared iPad) staging walk-through still unobserved; live
store-sweep assignment not yet observed on staging; hard stop 4 before any
production promotion (production `HrDocument` count on
`br-sparkling-block`, branch column in-output, nonzero stops the
promotion).
