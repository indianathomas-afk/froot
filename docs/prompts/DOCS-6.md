Read /Users/garythomas/Claude_Projects/Froot/froot/docs/prompts/DOCS-6.md and execute it.

# DOCS-6 — CAL promotion docs pass

**TIER 1 — docs only.** No `src/` changes, no schema, no migrations, no prisma
commands of any kind. Proceed without audit ceremony; report what you changed.

**Save to:** `/Users/garythomas/Claude_Projects/Froot/froot/docs/prompts/DOCS-6.md`
**Branch:** `staging`. Commit only — never push.
**Today:** 2026-09-19. The promotion happened late 2026-09-18 Pacific; database
and git timestamps may read 2026-09-19 UTC. Use 2026-09-18 as the shipped date.

Read `/Users/garythomas/Claude_Projects/Froot/froot/CLAUDE.md` first. Run every
command one at a time. No `&&` chains. Never `git add -A` — stage only the files
this session touches.

---

## Why this session exists

Late 2026-09-18 Gary promoted six rows to production in one `--no-ff` merge of
`staging` into `main`: **CAL-1b, DOCS-4, CAL-2, CAL-2a, DOCS-5, CAL-2b**. The
board, the deploy log, and three house rules were all left owed. This session
pays them. Nothing else.

---

## Step 1 — Find the promotion merge. Do not assume its SHA.

```
git fetch origin
```
```
git log --oneline --merges -3 main
```

The newest merge on `main` is the CAL promotion. Confirm it with:

```
git log --oneline <MERGE_SHA>^1..<MERGE_SHA>^2
```

Expect roughly 16 commits, and expect to see `ed98ff2`, `9e39b56`, `00e2615`
among them. If the count or the SHAs don't match, STOP and report — do not
guess which merge is the promotion. Carry `<MERGE_SHA>` (short form) into every
step below.

## Step 2 — `docs/ROADMAP.yaml`: flip the six rows

File: `/Users/garythomas/Claude_Projects/Froot/froot/docs/ROADMAP.yaml`

For each of **CAL-1b, DOCS-4, CAL-2, CAL-2a, DOCS-5, CAL-2b**:

- `status: staging` → `status: shipped`
- add `shipped: 2026-09-18`
- **prepend** to `notes` (never rewrite): `REACHED MAIN 2026-09-18 in promotion <MERGE_SHA>.`

Then the debt rows this promotion touched:

- **DEBT-61** — closed at `ed98ff2` inside CAL-2. Confirm it carries an explicit
  `status:` and `commits: [ed98ff2]`. If status is `staging`, flip to `shipped`
  with the same prepended line. A debt row with no status reads as OPEN — do
  not leave it blank.
- **DEBT-101** — the "N days overdue counts from the due date" fix landed in
  CAL-2b (`00e2615`). Same treatment: explicit `status: shipped`, `commits`,
  prepended line.
- **DEBT-100** (stacked red banners) — read it and REPORT its state. Flip it
  only if the row itself, or a commit inside the merge, shows the fix landed.
  If you can't prove it, leave it open and say so.

Preserve-and-mark throughout. Corrections prepend with dates. Delete nothing.

## Step 3 — `docs/DEPLOY_LOG.md`: stamp the unpromoted entries

File: `/Users/garythomas/Claude_Projects/Froot/froot/docs/DEPLOY_LOG.md`

Per the 2026-09-18 ruling, the entries for these rows were written at
PRE-PUSH-CHECK time and marked **unpromoted**. Find them. Stamp each with
`<MERGE_SHA>` and the promotion date, and change the unpromoted marker to
promoted. Keep the entries proportionate — this was a one-evening promotion,
not a 243-line event.

Before committing:

```
grep -c '__' /Users/garythomas/Claude_Projects/Froot/froot/docs/DEPLOY_LOG.md
```

Must print `0`. If it doesn't, a placeholder token survived — fix it before
anything else.

## Step 4 — New debt row: the lookback finding

Append to `debt:` in `ROADMAP.yaml` (next free DEBT id — **read the file to
find it**, per DEBT-84; do not assume):

> **A template-backed calendar event backdated more than the day-close sweep's
> 2-day lookback creates checklists the sweep never judges.** Found 2026-09-18
> during CAL-2 staging verification. The materialise run creates the checklist
> for the backdated date; day-close only looks back 2 days, so those rows sit
> Pending forever, never Missed. Not cosmetic — it is silent non-compliance
> that never surfaces on the Operations Report. FIX DIRECTION: either refuse a
> start date older than the lookback in the Add-to-Calendar form, or widen the
> sweep to "everything still Pending with a due date in the past." Ruling
> needed on which. No status (open).

Write it in the file's own voice; the content above is what must be in it.

## Step 5 — The CAL-2 migration breach: confirm the ledger, add the row

File: `/Users/garythomas/Claude_Projects/Froot/froot/docs/MIGRATIONS.md`

The CAL-2 build session applied its migration to **dev** at ~19:50Z on
2026-09-18 while reporting that it had not. The ledger is supposed to already
record this. Confirm the entry exists and reads plainly as a breach. If it is
missing, add it.

Then check `ROADMAP.yaml` for a DEBT row about this breach. If none exists,
add one (next free id): what happened, that it was caught by the migration
ledger not by the session report, and that the hardenings in Step 6 are the
response. Open, no status.

## Step 6 — Three hardenings

Each is a few lines. Add them where the existing rule they extend already
lives; do not create new sections when an existing one fits.

1. **Claude never runs a migration.** In
   `/Users/garythomas/Claude_Projects/Froot/froot/CLAUDE.md`, in the migrations
   rules: Claude Code may run `npx prisma migrate diff` only. Never `migrate dev`,
   `migrate deploy`, `migrate reset`, or `db execute`. Gary applies migrations
   in the Neon console. State this as a hard rule with the 2026-09-18 breach as
   the reason.

2. **Sessions report prisma commands verbatim.** In
   `/Users/garythomas/Claude_Projects/Froot/froot/docs/WORKFLOW.md`, in the
   session completion rules: the session report lists every `prisma` command
   the session ran, copied exactly, or the literal line "No prisma commands
   run." A report that omits this is incomplete.

3. **PRE-PUSH-CHECK flips status on push.** In
   `/Users/garythomas/Claude_Projects/Froot/froot/docs/prompts/PRE-PUSH-CHECK.md`,
   Step 4: add a line that the check sets the row's `status: staging` in the
   same pass, per WORKFLOW.md session rule 4. The check is the last thing that
   runs before Gary pushes, so it is the step that owns the flip.

## Step 7 — Verify the board still parses

```
node /Users/garythomas/Claude_Projects/Froot/froot/scripts/generate-roadmap.mjs
```

Report the phase count and the debt open/resolved split it prints. If the
generator fails, fix the YAML — nothing else in this session depends on
anything but a clean parse.

## Step 8 — Commit

Stage only: `docs/ROADMAP.yaml`, `docs/DEPLOY_LOG.md`, `docs/MIGRATIONS.md`,
`docs/WORKFLOW.md`, `docs/prompts/PRE-PUSH-CHECK.md`, `CLAUDE.md`,
`docs/prompts/DOCS-6.md`. One commit:

```
docs(DOCS-6): CAL promotion pass — six rows shipped at <MERGE_SHA>, deploy log stamped, lookback + migration-breach rows, three hardenings
```

Do not push.

---

## Report format

Short. In this order:

1. `<MERGE_SHA>` and the commit count you verified in Step 1.
2. The rows flipped, and DEBT-100's state with your evidence.
3. The two new DEBT ids.
4. Whether the MIGRATIONS.md breach entry existed or was added.
5. Generator output (phase count, debt split).
6. The commit SHA.
7. **Prisma commands run:** the verbatim list, or "No prisma commands run."
   (This session should print the second line. Rule 2 of Step 6 applies to
   the session that writes it.)

## Out of scope

- Enabling the calendar for any production org. That is Gary's action in the
  UI after this lands.
- CAL-3 scoping.
- Any fix for the lookback finding or DEBT-100. Rows only.
- Reordering ROADMAP.yaml.
