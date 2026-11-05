Read /Users/garythomas/Claude_Projects/Froot/froot/docs/prompts/PROMOTE-DOCS_2026-11-04_BUG-23.md and follow it.

# PROMOTE-DOCS 2026-11-04 — BUG-23

**TIER 1** (docs only, no code, no schema). Declare the tier before writing anything.
Branch: `staging`. Commit only — never push. Stage only the files you touch.

## Gate
- Staging and main must both be at `f24b18e`. If either isn't, STOP and report.
- Production merge: `f24b18e` (first parent `a9ee8fb`, second parent `ced65fc`), carrying `b9b7389`, `87723dc`, `db7e3f1`, `1b598c6`, `ced65fc`. There is no migration. Rollback: `git revert -m 1 f24b18e`.

## Before writing, ask Gary two questions and record his answers in his own words
1. On www.usefroot.com, did a template with history (e.g. the Opener Checklist) show **Archive** in place of Delete?
2. Did a brand-new throwaway template show **Delete**, and did it delete cleanly?

Staging evidence, already seen in chat on 2026-11-04: "Overdue Test" showed Archive, archived to the Archived tab, and the Archived tab offered Unarchive. The throwaway-delete step was not run on staging.

Do not write placeholder tokens into any file. If Gary hasn't answered, STOP.

## Edits (one docs commit)
1. `/Users/garythomas/Claude_Projects/Froot/froot/docs/DEPLOY_LOG.md`: stamp the BUG-23 UNPROMOTED entry with `f24b18e` and 2026-11-04. Add the staging evidence and Gary's production answers. Heading counts must be equal before and after.
2. `/Users/garythomas/Claude_Projects/Froot/froot/docs/ROADMAP.yaml`: set the BUG-23 row to `shipped: 2026-11-04` with the merge SHA, deleting nothing. BUG-24 and BUG-25 stay `planned`.
3. File one new TIER 1 row, taking the next free id after reading the file: on `/templates` → Archived tab, archived cards still show a green "Active" badge, and the bulk bar reads "1 templates selected". Both issues predate BUG-23. Seen on staging 2026-11-04.
4. Commit the untracked `/Users/garythomas/Claude_Projects/Froot/froot/docs/prompts/PROMOTE-DOCS_2026-11-04_TPL-3.md` and this prompt file. Leave the other untracked prompt files alone.
5. Run `npm run build` and confirm the roadmap generator parses.

Report the commit SHA and `git log --oneline @{u}..`. Then Gary pushes staging, checks out main, merges staging, pushes main, checks out staging, merges main, and pushes staging.
