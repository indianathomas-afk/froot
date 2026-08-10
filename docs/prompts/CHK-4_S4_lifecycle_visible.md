# CHK-4 (S4) — THE LIFECYCLE BECOMES VISIBLE: OVERDUE FLAGS, MISSED RENDERED, THE (i) EXPLAINER, DEBT-59's COPY RETIRED

**Repo:** `~/Claude_Projects/Froot/froot` — branch: `staging`

## WHAT THIS SESSION IS

S4 of the approved CHK phase. The plan is **already approved in full**
(Gary's ruling 2026-08-09, `docs/prompts/CHK-1_PLAN.md` §0-RULING). This
session **executes S4 per the approved plan**; it does not redesign it.
Read the plan artifact and `docs/prompts/CHK-1_SESSION_SKELETONS.md`
(S4 block) in full before touching anything. The CHK-4 row in
`docs/ROADMAP.yaml` carries the ships / proves / must-not-touch summary.

Context since the plan: S1-S3 are **promoted to production**
(merge `ac069c6`, 2026-08-10; both migrations verified on
br-sparkling-block: unlinked_tasks 0 / 32 sections; 4 lifecycle
columns; both unique indexes). The engine is live and sweeping hourly
on production. Materialized Missed rows exist on staging (~90) and
production; they currently render through the unmapped-status
fallback (`checklists/page.tsx:117`, the S1 COMMENT) — safe but
unlabeled. S4 gives every lifecycle state its face.

Ruled parameters that bind this session (do not reopen):
- R1 lifecycle semantics: overdue = live, nagging, completable;
  missed = closed fact, NOT actionable, leaves the working list.
- R3: nothing is ever hidden by a window; blank offsets = no
  expected window (never overdue); offsets are expectations, not
  gates; the (i) explainer states this in plain words.
- Overdue is **computed on read** via the single-definition
  predicates in `src/lib/checklist-lifecycle.ts` — no surface may
  re-derive its own overdue logic; every state read goes through
  the lib (the DEBT-26 discipline; a second definition is a defect).
- The window-clamp form warning (plan §12; the clamp itself shipped
  in S3's engine — S4 ships the warning).
- DEBT-59's field copy is retired ONLY because S4 makes it false —
  the new copy states what the offsets now actually do.

## OPEN CHECKS INHERITED (fold into this session's verification)

From CHK-3's rider, four S3 checks were closed on the cron's own
response bodies but never independently SQL-confirmed. Confirm each
with a query in this session's verification plan (staging; branch
named): Weekly/Monthly templates not materialized; isClosed-weekday
day-close behavior; the two 409s (log against closed checklist;
submit against closed checklist); pre-deploy rows untouched (NULL
expectations remain NULL).

From S3's triage, two cron-hardening COMMENTs land here if the cron
file is touched, else as comments at the site: log rejected cron
requests (the diagnosis gap that cost an afternoon); `.trim()` +
constant-time comparison on the secret check.

## STEP 0 — LOCATION AND ANCHOR

```
cd ~/Claude_Projects/Froot/froot
pwd                        # must end .../Froot/froot
git branch --show-current  # staging
git status --short         # clean
git fetch origin           # confirm level with origin/staging
git rev-parse HEAD         # expected: the gates docs commit (0e57d02) or a descendant
```

STOP on any failure. Never push.

## STEP 1 — BOOKKEEPING RIDER FIRST (drafted now, rides the docs commit)

The 2026-08-10 promotion is not yet reflected on the board. This
session's docs commit carries:
- CHK-1 → shipped (gate satisfied: production unlinked_tasks 0,
  32 sections, br-sparkling-block, 2026-08-10). CHK-2, CHK-3 →
  shipped likewise (structure query: 4 columns, both indexes).
- TPL-2, DEBT-41, and any other staging-status rows the ac069c6
  merge promoted → shipped per the DEBT-54 convention. Check the
  DEPLOY_LOG entry's list; flip what the convention says; leave
  ambiguous cases (DEBT-58's hardware caveat) with a note.
- DEPLOY_LOG completion note: push date, production evidence
  (both queries, branch named), and — if readable in the Vercel
  Runtime Logs without presenting a secret — the first scheduled
  production sweep's headline counts.

## STEP 2 — RE-VERIFY THE PLAN'S S4 ASSUMPTIONS AT HEAD

Re-measure, do not cite: the S4-named surfaces and their line
numbers (store-view checklist list, checklist execution page,
admin /checklists list incl. the :117 fallback, template-form
offsets block incl. the two DEBT-59 comment regions, print sheet,
STAFF nav badge query); the status values the UI currently maps;
what the engine actually writes (status strings for missed /
completed-late as committed in S3). Drift table in the report.

## STEP 3 — EXECUTE PER THE PLAN'S S4 SECTION

1. **Missed rendered everywhere**: proper badge/styling in admin
   list, store view, execution page (read-only closed state),
   print sheet. The :117 fallback stays as the safety net but no
   shipped status may reach it (that is the regression test).
2. **Overdue flag on live surfaces**: store-view list and
   execution page, computed via the lib predicates. Visual
   treatment distinct from Missed (live-and-urgent vs closed-fact).
3. **Missed leaves the crew's working list** (R1): filter at the
   store-view query/render layer; Missed remains visible in admin
   contexts. State exactly which lists retain it.
4. **Completed-late**: surfaced subtly where completed checklists
   render (badge or line), not alarming — it is a fact, not a
   fault.
5. **The (i) explainer** beside the offset fields: plain-words
   window/overdue/missed explanation per R3. Popover or dialog
   per existing form affordances — match the house pattern.
6. **DEBT-59 copy retirement**: the "not yet used" helper text
   replaced with the now-true description. The two DEBT-59
   comment blocks in template-form.tsx are updated to note the
   retirement (their preservation clause expired the moment the
   copy became false) — cite DEBT-59 and this session.
7. **Window-clamp warning** on the form when endOffset would
   exceed day close for any applicable store context — wording
   proposal in the report; non-blocking warning, not an error.
8. **Stores page fallback signal**: the "no hours set — day
   close defaults to midnight+3h" note per store (the CHK-2
   handoff), linking to the hours editor.
9. **STAFF nav badge**: confirm/adjust its count query so Missed
   does not inflate an actionable-work badge (R1: missed is not
   actionable).

**MUST NOT TOUCH**: the engine (`checklist-lifecycle.ts` logic,
cron mechanics beyond the two hardening COMMENTs if the file is
already open), migrations/schema, labor, handoff notes,
permissions.ts. **/reports is S5** — DEBT-63's under-count and
DEBT-65's archived-template question stay parked; do not "fix"
report tiles while styling statuses.

## STEP 4 — COMMITS AND GATES

Two-commit pattern:
- **Commit 1 — code.** Scoped eslint (no pipes; exclude
  handoff-notes.tsx if the DEBT-33 baseline error would fire,
  stated in the message) + `npm run build`.
- **Commit 2 — docs.** CHK-4 → in_progress with commit 1's SHA
  quoted; the Step 1 bookkeeping riders; the inherited-checks
  confirmations recorded on the CHK-3 rider (each with its query
  result placeholder for Gary's staging run). `npm run build`.

Committed, **NOT pushed**.

## STEP 5 — REPORT (Gary's verification is a real browser pass again)

1. SHAs; drift table; what shipped vs the plan, deviations flagged.
2. The four inherited-check queries for Gary (staging, branch
   named), with expected results stated.
3. **Gary's staging walkthrough, org-ID-first** (`⌥⌘C`,
   `window.Clerk.organization.id`, write it down before anything):
   - An overdue checklist shows its flag on the store view and
     execution page (state how to manufacture one if none is
     currently overdue — e.g. a test template with a short window).
   - A Missed checklist: absent from the crew list, visible and
     properly badged in admin, read-only on open, 409 on any log
     attempt.
   - Completed-late badge on an applicable row (or state how to
     produce one).
   - The (i) explainer opens and reads right; the offsets helper
     copy is the new text; the clamp warning fires when provoked.
   - Stores page shows the fallback note on a no-hours store and
     no note on Carson (has hours).
   - Print sheet renders Missed/section states correctly.
   - DEBT-59 spot-check IF template-form.tsx offsets regions
     changed beyond copy (flag loudly if so).
4. Triage: FIX NOW / RULING NOW / COMMENT / ROW. **RULING NOW
   stops the session.** Report counts.

## HOUSE RULES

Everything in `CLAUDE.md`; never push; additive-only schema (none
expected); `npm run lint` is not a gate (DEBT-33); short SHAs
quoted in YAML; exclude `src/generated/` from greps and verify
hits by reading; do not touch `../froot_docs/`; `preview/main` is
a fossil — never query it; no secret values anywhere.
