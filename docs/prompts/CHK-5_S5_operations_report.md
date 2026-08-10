# CHK-5 (S5) — THE OPERATIONS REPORT: MISSED SURFACES WHERE MANAGERS LOOK, AND THE PHASE'S BOOKS CLOSE

**Repo:** `~/Claude_Projects/Froot/froot` — branch: `staging`

## WHAT THIS SESSION IS

S5 of the approved CHK phase — the final build session. The plan is
**already approved in full** (`docs/prompts/CHK-1_PLAN.md` §0-RULING).
This session executes S5 per the plan and the S5 skeleton
(`docs/prompts/CHK-1_SESSION_SKELETONS.md`), then closes out the
CHK phase's related rows on the board. Read both artifacts plus the
CHK-5 row before touching anything.

## GARY'S INPUTS (verbatim — if either slot below is blank, STOP and
ask before proceeding; do not assume)

- **DEBT-65 RULING (the S5 entry gate):** should archived templates
  generate checklists at all?
  [GARY: rule here — recommended: "archiving stops generation
  entirely; archived templates generate nothing, materialize
  nothing, and appear in no report going forward; existing rows
  from archived templates are (a) deleted as fiction where
  never-started, or (b) kept as history where human-touched"]
- **CHK-4 OPEN CHECKS:** the three browser checks (crew list clean /
  admin shows Missed / read-only + refusal).
  [GARY: "passed" — or state what failed. If not yet run, this
  session's Step 1 verification plan includes them; they MUST pass
  before CHK-4 flips to verified in this session's docs commit.]

## RULED PARAMETERS THAT BIND (do not reopen)

- R4: missed checklists appear in an operations report — by store,
  by day, by template. Completed-late surfaceable there too.
- Role gate: reports.view per the PERM-5 grid (the existing
  /reports gate) — no new capability, no permissions.ts edits.
- All state reads via checklist-lifecycle.ts predicates and
  templateInLifecycle() — the report derives NOTHING itself
  (DEBT-26 discipline; the CHK-3 defect showed what a second
  definition costs).
- DEBT-63 (reports page silently omitting Non-Compliant from
  totals) is IN SCOPE — the report rebuild is where that
  under-count dies; fix it here, close the row.
- DEBT-61 (frequency-aware generation) is NOT in scope — Weekly
  rows excluded from the report per templateInLifecycle(), the row
  stays open, cite it where the exclusion shows.

## STEP 0 — LOCATION AND ANCHOR

```
cd ~/Claude_Projects/Froot/froot
pwd; git branch --show-current   # staging
git status --short               # clean (untracked docs/prompts ok)
git fetch origin                 # level with origin/staging
git rev-parse HEAD               # expected dc90ff6 or a descendant
```

STOP on failure. Never push.

## STEP 1 — RE-VERIFY AT HEAD, THEN BUILD

Re-measure, don't cite: the current /reports page (what it reads,
where DEBT-63's omission lives, what the tiles claim), the
Missed/completed-late data shape as the engine actually writes it,
store/date/template query patterns already in use. Drift table in
the report.

Then build per the S5 skeleton:

1. **The operations report view** on /reports (or its checklist
   section): missed and completed-late by store × day × template,
   date-ranged, org-scoped, reading ONLY via the lifecycle
   predicates. Daily templates only (templateInLifecycle) with the
   exclusion stated in the UI where a manager would wonder ("Weekly
   templates are not yet tracked — DEBT-61" in honest plain words,
   not a row citation on screen).
2. **DEBT-63 fix**: the existing tiles/totals count Non-Compliant
   correctly (per R1's day-close semantics, Non-Compliant converts
   to Missed at close — reconcile what live-day tiles should show
   vs closed-day history, per the plan).
3. **DEBT-65 execution per Gary's ruling above**: generation stops
   for archived templates (the generator finally reads isArchived);
   the sweep already can't touch them if generation stops; existing
   archived-template rows handled per the ruling's (a)/(b) split —
   any data cleanup presented as SQL for Gary, surgical WHERE, the
   CHK-3 cleanup's pattern.
4. **No-hours fallback column** on the report (the CHK-3 handoff:
   dayCloseSource visible where managers read), completing the
   second visible-fallback signal.

MUST NOT TOUCH: the engine's predicates and cron beyond reading;
template-form.tsx; labor; handoff notes; permissions.ts; schema
(additive-only if truly needed — expect none).

## STEP 2 — CLOSE THE PHASE'S BOOKS (docs commit)

Gary's instruction: clear out related roadmap issues. Specifically,
with preserve-and-mark throughout:

- CHK-4 → staging-verified (the three open checks per Gary's input
  above + the defect-trilogy resolution already on the rider).
- CHK-5 → staging with this session's SHAs on completion.
- DEBT-63 → closed (fixed here), commit quoted.
- DEBT-65 → closed per Gary's ruling, commit quoted, the ruling
  text recorded verbatim.
- DEBT-61 → stays OPEN; rider updated: the engine and report now
  exclude non-Daily honestly (gates at materialization, closing,
  and report), so the row's remaining scope is generation-time
  frequency awareness + honest Weekly lifecycle semantics.
- The CHK phase entry: all five sessions accounted for; what
  remains before phase-shipped is one promotion + production
  evidence queries — state them.
- Sweep for any other row that claims something S1-S5 made false
  (grep the CHK/DEBT riders for stale claims; correct with dated
  lines, delete nothing).

## STEP 3 — COMMITS, REPORT

Two-commit pattern; npm run build gates each; committed NOT pushed.
REPORT: SHAs; drift table; what the report page shows (describe the
rendered shape); any cleanup SQL for Gary verbatim; Gary's
walkthrough (short — org-ID first, then: report shows the Aug 9-10
misses by store; a completed-late row if one exists; the Weekly
exclusion note; the no-hours column; DEBT-63's totals now honest);
the roadmap diff summary (rows closed/updated); triage counts —
RULING NOW stops the session.

## HOUSE RULES

Everything in CLAUDE.md; never push; short SHAs quoted in YAML;
npm run lint is not a gate (DEBT-33); exclude src/generated/;
do not touch ../froot_docs/; preview/main is a fossil; no secret
values anywhere.
