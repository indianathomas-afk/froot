# TIER 1 — BOOK-AL: Post-ship recorder — Advanced Labor Phases 1–3

**Session type: DOCS ONLY.** No source files, no schema, no build required.
One recorder commit. Everything below was ruled by Gary on 2026-08-19 in the
planning chat after the production promotion succeeded and all production
checks passed (including the STORE privacy check).

Repo: `~/Claude_Projects/Froot/froot` (verify with
`git rev-parse --show-toplevel`). Work on `staging`. Before editing, run
`git fetch origin` and confirm whether `origin/main` (promotion `5e2f4d7`,
deploy-log commit `78e02bc`) is ahead of staging; if it is a clean
fast-forward, take it first so the board edits sit on a branch that carries
its own promotion record.

Preserve-and-mark everywhere — prepend, never delete.

## Task 1 — L-2 flips to shipped

`docs/ROADMAP.yaml` L-2 row: status → `shipped`, prepending a dated note:
promoted to production in merge `5e2f4d7` (2026-08-19), Phases AL-1/AL-2/AL-3
(work commits `be705a2`, `8a28f61`, `f47e3bd`, `fa86bae`), production
verified same day incl. roster with real names/pay after staff import and
the STORE privacy check (tommy@keva.com — no wage, no tips).

## Task 2 — ADVANCED_LABOR.md phase map

Mark Phases 1, 2, 3 as PRODUCTION (2026-08-19, `5e2f4d7`). Leave the
remaining-items list (OT, salaried allocation, per-person tip attribution,
unmapped locations) as-is.

## Task 3 — File CRON-1 (future row, parked by ruling)

New ROADMAP row, id `CRON-1`, size S, status `parked`:
"Register the labor-timecards cron on production." Notes: the route
`/api/cron/labor-timecards` is built and deliberately absent from
vercel.json (AL-1 Q7 ruling). Gary's 2026-08-19 ruling: back burner —
dashboard-triggered sync is sufficient until the team reports staleness or
until alerts/end-of-day reports need always-warm data. Revisit trigger:
first staleness complaint, or the first alerting feature.

## Task 4 — File BUILD-2 (the 7am build anomaly)

New ROADMAP row, id `BUILD-2`, size S, status `in_progress` (Gary is
investigating tonight in the planning chat with the two Vercel logs):
"2026-08-19 07:03 production redeploy of 27ae79a failed — prisma migrate
deploy: 'The datasource.url property is required' — same commit built green
2026-08-18 ~22:00 and the 2026-08-19 promotion (5e2f4d7) built green."
Notes: build ran without cache; npm allow-scripts warned that
@prisma/engines and prisma postinstall scripts were not covered. Neither
env vars nor code changed between the good and bad builds (verified in
Vercel settings 2026-08-19 morning). Suspected build-environment one-off;
evidence pending the log diff.

## Task 5 — Pending-identification note (Gary, later this week)

Prepend to the L-2 shipped note (or the ADVANCED_LABOR.md remaining list,
whichever the file structure favors): the 5 unmapped Square location IDs
(13KAHQ…, 2K1XTK…, 779FNA…, 7W133C…, CD2APE…) remain unidentified; Gary to
classify (closed / test / real-but-unimported) this week.

## Commit

One recorder commit, e.g.
`docs(roadmap): L-2 shipped (5e2f4d7); file CRON-1, BUILD-2; phase map to production`
No push — Gary pushes.
