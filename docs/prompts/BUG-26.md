Read /Users/garythomas/Claude_Projects/Froot/froot/docs/prompts/BUG-26.md and follow it.

# BUG-26 — Archived templates show "Active"; "1 templates selected"

**TIER 2** (one conditional plus copy, no schema). Declare the tier before writing anything.
Branch: `staging`. Commit only — never push. Stage only the files you touch.
Gate: staging and main must both be at `80293ca`. If they aren't, STOP.

## The bug (filed in `8c81feb`, seen on staging 2026-11-04)
On `/templates` → Archived tab:
1. Archived cards still show a green **"Active"** badge. The badge is a ternary at `templates-client.tsx:~424`, `isActive ? "Active" : "Inactive"`, that never checks `isArchived`.
2. The bulk bar reads **"1 templates selected"**.

## Draft rulings (Gary ratifies at PRE-PUSH-CHECK)
- **R1:** A card's badge reads **"Archived"** in a muted grey style whenever `isArchived` is true, whatever `isActive` is. Otherwise the badge keeps today's behaviour.
- **R2:** The bulk bar pluralises correctly: "1 template selected", "2 templates selected".

## Brief audit (a few lines; no stop unless something below fires)
1. Find every place the badge ternary, or a copy of it, renders: cards, the table view if there is one, the view page. Fix them all the same way.
2. Read the existing badge variants. Use whatever muted or secondary style already exists; add no new colours or tokens.
3. Check the bulk-bar copy for any other count strings with the same plural bug on this page. Fix only those on this page, and list others elsewhere as a COMMENT.

**Stop only if** `isArchived` and `isActive` mean something other than what R1 assumes. For example, archiving might also flip `isActive`, or `isActive` might be dead. If so, report and STOP.

## Build
1. Make the conditional and copy changes.
2. Fixture `/Users/garythomas/Claude_Projects/Froot/froot/scripts/verify-bug26.ts`, no DB needed. Source checks:
   - the badge expression handles `isArchived` first, everywhere it renders;
   - no `"templates selected"` string remains without a count-aware form.
3. Make a work commit and a docs commit. The docs commit carries:
   - the BUG-26 row, `planned` → `in_progress`, with nothing deleted;
   - a DECISIONS.md draft of R1–R2;
   - a short UNPROMOTED DEPLOY_LOG entry.

Classify out-of-scope findings as FIX NOW / RULING NOW / COMMENT / ROW. Report the prisma commands run (verbatim; `npm run build` runs `prisma generate`), the SHAs and `git log --oneline @{u}..`.

## Staging test (Gary, after PRE-PUSH-CHECK and push)
On `/templates` → Archived, the card shows a grey **"Archived"** badge. Tick one card and the bar reads "1 template selected"; tick two and it reads "2 templates selected". The Active tab is unchanged.
