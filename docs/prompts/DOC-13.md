Read /Users/garythomas/Claude_Projects/Froot/froot/docs/prompts/DOC-13.md and follow it.

# DOC-13 — Due dates on /my/documents and the /staff/[id] Documents tab

**TIER 2** — display only. No schema, no migration, no new API route. If the audit shows any of those is needed, STOP and report before building. Declare the tier before writing anything.

## Repo gate

1. Confirm you are in `/Users/garythomas/Claude_Projects/Froot/froot` (lowercase), on `staging`, and that `staging`, `main`, `origin/staging` and `origin/main` all point at `8829de1`. Tree clean except this prompt. If not, STOP and report.
2. Read `/Users/garythomas/Claude_Projects/Froot/froot/CLAUDE.md` and the DOC-13 and DOC-8 rows in `/Users/garythomas/Claude_Projects/Froot/froot/docs/ROADMAP.yaml`. If DOC-13 describes something other than this, STOP and report.

## What Gary wants

DOC-8 put due dates on `/my`, `/hr/compliance` and the `/staff/[id]` Compliance tab. Two surfaces still don't show them (DOC-8 F9): an employee's `/my/documents` list, and the Documents tab on `/staff/[id]`. Tap from `/my` into documents today and "Was due Oct 27" disappears. Before Gary sets a real "Sign within" on a production document, these must match.

## Draft rulings (Gary ratifies at PRE-PUSH-CHECK)

1. **One source.** Both surfaces use DOC-8's `documentDueState()` and the wording helpers in `src/lib/hr-due-wording.ts`. No new due-date logic anywhere. The two surfaces can never disagree with `/my` or `/hr/compliance`.
2. **Same wording as DOC-8 F7.** "Due in d days" / "Due tomorrow" / "Due today" before the deadline; "Was due {Mon D}" plus the existing red Overdue treatment after it.
3. **Order.** Overdue first (most overdue first), then due soon (soonest first), then everything else in today's existing order — matching `/my`.
4. **Unchanged where there's no N.** Documents without a due date, signed documents, and the `recordMissing` case look exactly as they do today.
5. **Visibility unchanged.** Whoever can see the Documents tab today sees the due dates; no new permission.

## Brief audit (report in a few lines, no separate file)

- Paths for `/my/documents` and the `/staff/[id]` Documents tab, and where each gets its rows.
- Whether each already has, or can cheaply get, the same items `computeStaffComplianceDetails` builds — or whether `documentDueState()` must be called per row with the same inputs. Either way, prove the inputs are the ones compliance uses (hire anchor, grant date, `signWithinDaysSetAt`, re-sign cycle, member time zone).
- Anything that contradicts a draft ruling → STOP and report.

## Build

- Touch only those two surfaces and any shared row component they use. No changes to `hr-compliance.ts` logic; if a small export is needed, say so in the report.
- Fixture: extend `scripts/verify-doc8-due-dates.ts` or add `scripts/verify-doc13-surfaces.ts` — for one member with an overdue, a due-soon and a no-N document, both surfaces' labels and order equal what `/my` and the compliance items produce. Re-run `verify-doc8-due-dates` and `verify-doc2-by-document` at their existing counts.
- `npm run build` green; scoped eslint on changed files (bare `npm run lint` fails, DEBT-33).

## Commits (commit only, never push)

Stage only files you touched — no `git add -A`.

1. Work commit: `DOC-13: due dates on /my/documents and the /staff/[id] Documents tab`
2. Docs commit:
   - DOC-13 row → `in_progress` with commits; draft rulings above appended to `/Users/garythomas/Claude_Projects/Froot/froot/docs/DECISIONS.md` marked **DRAFT — awaiting Gary's ratification** (newest-first).
   - DOC-8 row: prepend a dated rider moving the overdue state from "not observed" to observed — staging, 2026-10-28 07:18 PDT, Tommy Thomas's `/my` shows "Test - Handbook Regression · 0/7 checkpoints · Was due Oct 27" with the red Overdue badge, sorted above his training item (org not recorded).
   - This prompt.

## Report

Tier, audit findings, files changed, both SHAs, fixture count, regression counts, build result, prisma commands run (verbatim — expect only the `prisma generate` inside the build), out-of-scope findings classified FIX NOW / RULING NOW / COMMENT / ROW, and a staging test plan for Gary (he tests on staging after push): Tommy's `/my/documents` shows "Was due Oct 27" in red on Test - Handbook Regression, sorted first; Tommy's `/staff/[id]` Documents tab as `indianathomas` shows the same; a document with no due date looks exactly as before; phone width reads cleanly.
