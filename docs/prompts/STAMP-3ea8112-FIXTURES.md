# STAMP-3ea8112-FIXTURES — N-5 promotion stamp + the five red fixtures — TIER 2

TIER 2: one small code fix (eng1 route patterns — changes what the engagement
report records from now on), four fixture-only fixes, and a docs-only
promotion stamp. Work commit (code + fixtures), then docs commit citing it.
`npm run build` gates commits. Never commit on `main`. Never push.

Saved as `/Users/garythomas/Claude_Projects/Froot/froot/docs/prompts/STAMP-3ea8112-FIXTURES.md`.

## Repo gate (one command at a time)

`pwd` ends in `Froot/froot` (capital-F: STOP and tell Gary). `git status`: on
`staging`, clean apart from untracked prompts and the expected untracked
`docs/prompts/FIXTURE-TRIAGE_AUDIT.md`. HEAD `3ea8112`. `git log --oneline -3`.
**Only this session writes to the repo** — if another Claude Code session is
open on it, STOP and tell Gary.

## Part 1 — fixture fixes (from `docs/prompts/FIXTURE-TRIAGE_AUDIT.md`)

Read the audit first; it is the text of record for each cause.

1. **eng1 — FIX NOW (code).** `ROUTE_PATTERNS` is missing 18 real pages (Help,
   Calendar, notification settings, Milestones, BevSpot import, all Nutrition
   pages incl. `/nutrition/labels`, `/nutrition/publish`), so they've been
   recorded as `/other` since 2026-09-04. Add them; the fixture is right. This
   changes only what is recorded **from now on** — no backfill of past rows.
   Gary approved this in planning chat 2026-11-03.
2. **nav1 — fixture + Gary's ruling.** Five nutrition sidebar links were added
   by N-1 … N-3 and N-1e. Update the approved list exactly as Gary rules in the
   pointer message that launched this session (his words go into DECISIONS
   verbatim, DRAFT, ratified at PRE-PUSH-CHECK), plus a "nutrition module off"
   scenario. If the pointer carries no ruling, STOP and ask.
3. **hr8 — fixture only.** Update expectations to the two rulings that came
   after it (R1 complete only once the signed record exists, `32205a4`; R2 a
   signature on an earlier version still counts, `457a57f`).
4. **ms5 — fixture only.** Fix the DST calendar flake (the time-zone split is
   computed on today's offset but applied to an earlier date). Not a leak —
   confirm Cara's CSV row still carries no raise date.
5. **notify14 — fixture only.** Stop hard-coding Monday 2026-11-02; derive the
   test week so the weekly duplicate guard can't collide with the real week.

Then run **every** fixture in `scripts/verify-*.ts`. Target: **all green**.
Report each file's own summary line (pass/total) — don't count ✓ lines by
grep. Any still red: STOP and report.

## Part 2 — promotion stamp for `3ea8112` (docs commit)

Gary promoted N-5 + N-5-SYNC on 2026-11-03: merge `3ea8112` (`--no-ff`), main
`4dbfa03..3ea8112`, staging fast-forwarded. Carried `3945425` (4dbfa03 stamp),
N-5 (`a9ff45e`, `4ad86a5`, `e32e22c`), N-5-SYNC (`9a069ca`, `2556904`,
`0b48da3`) — read the exact count and file count from git.

Migration `20261103020000_n5_square_modifiers`: production `finished_at`
2026-11-03 21:54:06.247507+00 (Neon `br-sparkling-block-a620qvg4`, branch id
from the server) — 1:54 PM Pacific.

Evidence:
- Staging, before promotion: Sync from Square completed (no timeout) —
  234 categories, 1,271 sales items, 595 modifiers; Recipes → Modifiers listed
  add-ons grouped by Square list.
- Production, after promotion: Sync from Square completed — 234 categories,
  1,271 sales items, 595 modifiers. BevSpot preview (Las Brisas file): 31
  recipes ready + 127 modifier recipes (+6 prep), "not one of your Square
  items" down to 240 (from ~491). Gary applied **158**. Spot checks: "No Banana
  (add 2oz juice)" = Bananas −1.6 oz (dry) with negative cost; "Add Peanut
  Butter (1 scoop Blended in)" = Peanut Butter +1 oz (dry); Menu Nutrition →
  Modifiers showed signed calories. New To-fix item: "Pitaya (Dragon Fruit)"
  name matches more than one thing (1 recipe, hand fix later).

Follow `docs/WORKFLOW.md` § 2 and `docs/prompts/STAMP-4dbfa03.md`:
DEPLOY_LOG — stamp the UNPROMOTED N-5 entry (with its N-5-SYNC note) as
promoted in `3ea8112`, heading count unchanged; MIGRATIONS — fill the N-5
production row; ROADMAP — N-5 row → `shipped` with `3ea8112` and a dated
rider. Preserve-and-mark; nothing deleted.

## Docs commit

Also: ROADMAP riders for the fixture fixes (or a small new row if the
conventions call for one — read the file); DECISIONS — Gary's nav1 ruling in
his words, DRAFT; commit `FIXTURE-TRIAGE_AUDIT.md` and this prompt.

## Report and stop

Work SHA, docs SHA, files touched, every fixture's own summary line, the
stamp diff summary. Do not push.
