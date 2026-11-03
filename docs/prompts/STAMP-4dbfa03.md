# STAMP-4dbfa03 — promotion stamp for N-1e and N-1e-UI — TIER 1

TIER 1: docs only, one commit on `staging`. Never commit on `main`. Never push.

Saved as `/Users/garythomas/Claude_Projects/Froot/froot/docs/prompts/STAMP-4dbfa03.md`.

## Repo gate (one command at a time)

`pwd` ends in `Froot/froot` (capital-F: STOP and tell Gary). `git status`: on
`staging`, clean apart from untracked prompts. HEAD `4dbfa03`.
`git log --oneline -3`.

## What happened

Gary promoted on 2026-11-03: merge `4dbfa03` (`--no-ff`), main
`a00fa1e..4dbfa03`, staging fast-forwarded. Carried `c33df9d` (a00fa1e stamp),
N-1e (`218e984`, `55f092e`, `bb26400`) and N-1e-UI (`23ea7d3`, `ffda710`,
`9d2d955`) — 7 commits, 37 files.

Migration `20261103010000_n1e_label_inbox`: production `finished_at`
2026-11-03 17:08:19.627415+00 (Neon `br-sparkling-block-a620qvg4`, branch id
read from the server in the same output) — 9:08 AM Pacific.

Staging evidence (before promotion): three labels dropped into the inbox
(Almond Breeze Original PDF, Thirster Coconut Milk screenshot, Oregon
Ice-Cream Vanilla Yogurt screenshot); the searchable picker worked (typing,
keyboard choice, list scrolls and stays on screen); all three matched and
Confirmed; Read all ran; the review queue applied and skipped; a product web
page link and `http://localhost` were both refused; the inbox survived closing
and reopening the tab.

## Do

Follow `docs/WORKFLOW.md` § 2 and `docs/prompts/STAMP-a00fa1e.md`:

1. `docs/DEPLOY_LOG.md`: stamp the UNPROMOTED N-1e and N-1e-UI entries as
   promoted in `4dbfa03` on 2026-11-03, with the evidence above (merge facts
   from git). Heading count unchanged; insertions plus the heading changes.
2. `docs/MIGRATIONS.md`: fill the N-1e production row with the `finished_at`
   above; mark any "not yet" text spent, not deleted.
3. `docs/ROADMAP.yaml`: N-1e row → `shipped` with `4dbfa03` and a dated rider
   (including the N-1e-UI picker fix). Preserve-and-mark; nothing deleted.
4. Commit this prompt with the docs. `npm run build` must pass. One commit.

## Report and stop

SHA, files touched, diff summary. Do not push.
