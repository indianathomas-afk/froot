# CHK-4 (S4) CLOSE-OUT — RECORD THE WALKTHROUGH, FILE THE CLAMP DEFECT, FILE THE SQUARE-HOURS ROW

**Repo:** `~/Claude_Projects/Froot/froot` — branch: `staging`

## WHAT THIS SESSION IS

S4's staging walkthrough is substantially complete. This session records
it, fixes or files the one defect it found, files one new product row,
and leaves three clock-dependent checks as named open items. Docs plus
one scoped code fix (session's judgment per Step 2).

## GARY'S INPUTS (verbatim — if the ratification line below is blank,
STOP and ask him for it before writing the rider; do not assume it)

- Org/instance: org_3G02wO4QlVVSWppi8aqlnSZnsDa /
  verified-snapper-7, retrieved via window.Clerk.organization.id
  BEFORE testing (2026-08-09).
- RATIFICATION of the two proceeded rulings (drift-marker styling;
  STORE-role read-only visibility of missed rows):
  [GARY: type "ratified" here, or state changes]

## WALKTHROUGH EVIDENCE (2026-08-09, staging, screenshots on file
with Gary)

- PASSED — (i) explainer: opens beside "Expected window", full
  plain-words semantics incl. blank-end, clamp rule, no-hours
  fallback. DEBT-59 copy retirement confirmed on screen ("not yet
  used" gone; "Optional. Sets when this checklist is expected — it
  never hides it" present).
- PASSED — overdue flags live: Store View (Carson) showed Overdue
  badges on Mid-Shift, Opener, and both test templates, each with
  "Expected by <time> — it can still be completed"; Closer showed
  no badge inside its window — per-window discrimination confirmed.
  Execution page showed the amber Overdue banner, still completable
  (R3 rendered).
- PASSED — stores-page fallback signals: "No hours set — checklists
  for this store close at midnight + 3h..." with Set Hours link on
  every store without hours; Carson displayed its full week after
  hours were set. The hours dialog's own copy confirms Square
  resync never overwrites Froot hours.
- PASSED — admin Missed rendering per Gary ("working great");
  print view rendered fine.
- Store hours were SET on Carson during testing (07:00-21:00 all
  week, later closing changed to 17:00) — note for anyone reading
  staging data later.
- **FAILED — clamp form warning:** with Carson at 07:00-17:00
  (day close 20:00 = 13h after open), the template form accepted
  Ends = 20 with NO warning rendered anywhere (field, inline, or
  save). The engine-side clamp is not in question; the FORM WARNING
  (plan §12, S4 item 7) is absent or does not fire.
- OPEN (clock-dependent, tomorrow): the 409 on a Missed checklist;
  missed rows absent from crew list while present in admin (needs
  today's misses materialized overnight); Weekly-exclusion Query 1
  rerun (a Weekly template now exists on staging as of 2026-08-09
  evening — the vacuous zero becomes a real check after the next
  sweep).

## STEP 0 — LOCATION AND ANCHOR

```
cd ~/Claude_Projects/Froot/froot
pwd; git branch --show-current   # staging
git status --short               # clean (docs/prompts untracked ok)
git fetch origin                 # level with origin/staging
git rev-parse HEAD               # expected: S4's docs commit or a descendant
```

STOP on failure. Never push.

## STEP 1 — THE CLAMP-WARNING DEFECT

Investigate why no warning rendered at Ends = 20 against a store
closing 13h after open. Read the S4 code that was supposed to ship it
(plan §12 / S4 item 7) — was it built and gated on a condition that
can't fire (e.g. requires a single-store template, or requires ALL
applicable stores to have hours), or not built?

- If the fix is small and inside S4's shipped surface (the form):
  FIX NOW in this session — the warning fires when the end offset
  exceeds day close for AT LEAST ONE applicable store with hours;
  wording states which store(s) clamp and that the engine treats the
  window as ending at day close. Non-blocking. For templates where
  NO applicable store has hours, no warning (nothing to compare) —
  the explainer already covers that case.
- If it is genuinely larger, file it as a row with the measured
  evidence above and say why.

## STEP 2 — DOCS COMMIT

- CHK-4 rider: the walkthrough record per the evidence block, org
  line included, the ratification as Gary gave it, the failed check
  recorded honestly with its fix commit SHA (if Step 1 fixed it) or
  row id (if filed), and the three OPEN CHECKS named with their
  trigger ("after the next day-close sweep materializes 2026-08-09's
  misses"). CHK-4 stays in_progress until the open checks close —
  do NOT move it to staging-verified yet.
- FILE THE ROW — Square hours import: one-directional, on-demand
  import of business hours from Square's Locations API into
  StoreHours, per store, admin-initiated ("Import hours from
  Square" on the hours dialog or store card). Ground: Square
  already holds real hours for linked stores; hand-entry per store
  does not scale past Keva. Constraint already satisfied by design:
  Froot hours are never overwritten by resync (the S2/S4 dialog
  copy states it) — the import is a deliberate action, not sync.
  Track SQ- per house numbering. Related: CHK-2, S2 COMMENT 4
  (timezone overwrite), DEBT-66's env caveat does not apply.
- Note on the CHK-3/CHK-5 seam: DEBT-65's archived-template ruling
  remains the S5 entry gate (unchanged, cite don't restate).

`npm run build` gates every commit. Two-commit pattern if Step 1
produced code. Committed, NOT pushed.

## STEP 3 — REPORT

SHAs; what Step 1 found (built-but-gated vs absent) and what shipped
or got filed; the CHK-4 rider verbatim; the SQ row verbatim; Gary's
morning checklist verbatim: (1) rerun Query 1 (Weekly) on staging
expecting 0 with the Weekly template now existing; (2) crew list
(store view) does NOT show yesterday's misses while admin does;
(3) open one Missed row → read-only → task interaction refused
(the 409); (4) then tell the next session "open checks passed" so
CHK-4 can move to staging-verified. Triage counts; RULING NOW stops
the session.

## HOUSE RULES

Everything in CLAUDE.md; never push; short SHAs quoted in YAML;
`npm run lint` is not a gate (DEBT-33); exclude `src/generated/`
from greps; do not touch `../froot_docs/`; `preview/main` is a
fossil — never query it; no secret values anywhere.
