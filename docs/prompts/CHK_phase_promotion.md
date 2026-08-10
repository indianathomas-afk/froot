# CHK PHASE PROMOTION — S4 + S5 TO PRODUCTION: THE PHASE SHIPS

**Repo:** `~/Claude_Projects/Froot/froot` — branch: `staging`

## WHAT THIS SESSION IS

The CHK phase is verified end to end on staging (Gary, 2026-08-09/10).
This session records the final verifications, closes CHK-4 and CHK-5,
files the last findings, writes the DEPLOY_LOG entry, executes the
promotion mechanics per WORKFLOW.md §2 as amended, and STOPS at the
push. Gary pushes. This is the phase's closing artifact.

## VERIFICATION EVIDENCE (Gary, org_3G02wO4QlVVSWppi8aqlnSZnsDa /
verified-snapper-7, captured before testing both days)

**S5 walkthrough, 2026-08-09/10, staging:**
- Operations Report live at /reports/operations: missed +
  completed-late by store/day/template, date-ranged; day-close
  source per store ("Store hours" Carson, "Midnight fallback" for
  the eleven unset); totals include Missed (DEBT-63's under-count
  dead — 68 of 70 at first read, 110 of 110 after the Aug-9 close);
  the "What this report does not cover" panel renders with the
  Weekly line ("'no misses' means 'not tracked yet' — not 'all
  done'"), the tracking-start disclosure, and the eleven
  midnight-fallback stores named.
- Store View: crew list shows today only; misses inherit nothing.
- Aug-9 day close verified by query after a manual sweep
  (2026-08-10 ~06:45): Carson's four → Missed/closed=true
  (2 marked from started rows, 2 materialized); the Weekly "test"
  row correctly left Pending/open (templateInLifecycle holding);
  templatesExcluded=1 across all 12 stores; beforeTemplateCreation
  0; errors 0. Report absorbed the close (Carson 6→10; headline
  110/110).

**FINDINGS from the final pass, to record/file:**
1. **Staging has no heartbeat** — Vercel cron schedules fire only
   on Production (established in CRON-DIAG, now operationally
   confirmed: no scheduled sweep ran overnight on staging; the
   manual 06:45 beat performed a full correct close). Record on
   the CHK-3 rider: all staging sweeps ever run were manual; this
   is platform behaviour, not defect. PRODUCTION'S schedule is
   real — its days close unattended (verifiable there post-
   promotion).
2. **Yesterday's misses are reported but not browsable** — the
   admin Checklists page is today-only with no date navigation;
   a Missed row's only surfaces are the report aggregates and
   direct URL. Check 7 therefore closed as engine-proven (S3's
   409 + closedAt on every closed row) with the browser path
   NOTED AS A GAP. File as a small row: date navigation or a
   drill-through from the report to individual checklists —
   UX-track or CHK follow-on per house numbering, with this
   evidence.

## STEP 0 — LOCATION AND ANCHOR

```
cd ~/Claude_Projects/Froot/froot
pwd; git branch --show-current   # staging
git status --short               # clean (untracked docs/prompts ok)
git fetch origin                 # level with origin/staging
git rev-parse HEAD               # expected: the S5 correction commits or a descendant
```

STOP on failure. Never push.

## STEP 1 — DOCS COMMIT ON STAGING (before the merge, so the
verified state is what promotes)

- **CHK-4 → staging-verified**: rider with the full check record —
  the seven checks, the org line, the clamp-warning defect found
  and fixed (bbb5734), the three clock-dependent checks closed
  with this morning's evidence, check 7's engine-proven-with-gap
  status stated plainly.
- **CHK-5 → staging-verified**: rider with the S5 walkthrough
  evidence above, including the corrections arc (the phantom
  17/3/14, the flag-gate fix, the honest DELETE-0 closure) cited,
  not restated.
- **CHK-3 rider**: the no-heartbeat finding (1) appended, dated.
- **File the browsability row** per finding (2).
- **The CHK phase entry**: five sessions built and verified; what
  ships in this promotion (S4: lifecycle visible — overdue flags,
  Missed rendered, the (i) explainer, DEBT-59 copy retired, clamp
  warning; S5: the operations report, DEBT-63 fix, DEBT-65
  archived-gate on both flags, the disclosure panel); what remains
  after: production evidence queries only.
- Sweep for riders the last 24h made stale (the CHK-4 open-checks
  language, any "pending the sweep" phrasing) — dated corrections,
  preserve-and-mark.

`npm run build` gates. Committed, NOT pushed — rides the promotion.

## STEP 2 — DEPLOY_LOG ENTRY per §2 AS AMENDED (written before the
push)

Date; what promotes (every staging commit since the 2026-08-10
morning promotion `bca5df1` — the S4 close-out + clamp fix, the
CHK-3 defect-trilogy fix + cleanup rider, S5 + its corrections,
all riders; enumerate by `git log bca5df1..HEAD --oneline` and
summarise by theme); NO migrations in this range (verify — S4/S5
shipped none; say so explicitly in the entry); DAY-ONE BEHAVIOUR
note: the operations report goes live reading production's
existing Missed data (the engine has been closing production days
unattended since 2026-08-10's first promotion — the report will
show real numbers immediately, likely ugly, honestly); the
archived-template gate now guards both flags (production's five
inactive-flagged templates, if any, stop generating — measure,
don't assume: state the query for Gary); rollback = the tested
three-line recipe, merge-SHA slot to fill.

## STEP 3 — PROMOTION MECHANICS per §2 as amended, up to the push

checkout main; pull; merge staging --no-ff (message per
convention); fill the rollback SHA per §2's corrected instruction;
build-gate. STOP at the push. Ambiguity in §2 = STOP and report.

## STEP 4 — REPORT

SHAs (docs commit, merge); DEPLOY_LOG verbatim; Gary's post-push
checklist in order:
1. git push origin main; git push origin staging
2. Watch the Production build → Ready (no migrations expected —
   flag if the build log shows one)
3. Production spot-check (~3 min): /reports/operations renders
   with real numbers; one store's day-close source line; the
   disclosure panel; a template form shows the (i) and clamp
   warning at a large Ends value
4. The production evidence query for the archived-gate (from
   Step 2) — branch named
5. git checkout staging
6. OPTIONAL satisfaction: the production heartbeat check — query
   production for yesterday's closed rows; they closed themselves.
Triage counts; RULING NOW stops the session.

## HOUSE RULES

Everything in CLAUDE.md; never push; short SHAs quoted in YAML;
npm run lint is not a gate (DEBT-33); exclude src/generated/;
do not touch ../froot_docs/; preview/main is a fossil; no secret
values anywhere.
