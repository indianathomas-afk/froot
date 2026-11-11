Read /Users/garythomas/Claude_Projects/Froot/froot/docs/prompts/TAB-8.md and follow it.

# TAB-8 — Read-only route for the tablet's Tasks refresh

**TIER 2.** Contained change: one new read-only API route and the tablet refresh switched onto it. No schema, no migration, no permission change, no env var, no cron. Declare the tier before writing anything. **Escalate to TIER 3 and STOP** if any escalation trigger below fires.

## Repo gate

- Repo: `/Users/garythomas/Claude_Projects/Froot/froot`, branch `staging`.
- Tree clean apart from this prompt (untracked). Report `git log --oneline -1`, `origin/staging`, `main`.
- Staging carries TAB-4 (`0064bf9`, `e8cfa05`, `7397e35`, plus empty rebuild commits), pushed but **not promoted**. TAB-8 stacks on top of it.
- Read `docs/ROADMAP.yaml` for the TAB-8 row before writing. Never assume the "next free" id.

## The problem (plain English)

Every 60 seconds (TAB-5) the tablet asks the server what's on today's checklist and what's been done. It asks through a route that also does other work. When that route hiccups, the tablet keeps showing its last list, and nobody is standing there to notice. This matters most for tablets left on all day or overnight in stores.

## Phase 1 — brief audit (report it; continue unless a trigger fires)

1. **What the tablet's refresh calls today.** Name the exact route(s) and method(s) used by the Tasks panel's 60-second refresh, its first load, and TAB-5's date-change reload. Include the due list and overdue chip only if they share the same call.
2. **What that route writes.** List every write, side effect and AuditLog row on that path, such as creating or materialising a checklist, a status change, or a startedAt stamp. Say which of them the tablet actually relies on.
3. **How it fails today.** What the client does on a non-2xx, a thrown fetch, and an expired session. In particular, does it follow a redirect to /sign-in and treat the 200 HTML as success? That's CHK-8's defect class, and TAB-4 finding (h) shows it does happen on these tablets.
4. **The payload the Tasks panel needs.** Field by field, including anything TAB-4 added (PIN-required flag, staff list, greyed names), TAB-9's expanded detail, and the "Completing as" state.
5. **Who else uses that route.** Desktop checklist page, store-view, or anything else. They must be unchanged.

### Escalation triggers (STOP, report, wait for rulings)

- **The refresh is what creates the new day's checklist.** If TAB-5's overnight rollover depends on a write in the current refresh path, a read-only refresh would break rollover. Stop and report how the new day's checklist comes into being today.
- The new route needs a capability or role rule that doesn't exist today.
- The Tasks panel needs data that only a write path produces.
- More than the tablet client and one new route would have to change.

## Draft leans (Claude's design choices, ratified at PRE-PUSH-CHECK)

1. **One new GET route that only reads.** Name it after the audit, for example `GET /api/checklists/[id]/items`. It returns exactly the payload the Tasks panel uses today and nothing more.
2. **Same gates as task-log, in the same order:** orgId 401, org 404, checklist scoped to the org 404, store scope 403. No new capability (DEBT-107 stays open).
3. **Zero writes.** No create, update, upsert, delete, `$executeRaw` or AuditLog anywhere in the route or anything it calls. The fixture enforces this from the source.
4. **It reads tasks through `tasksForChecklist`** (`src/lib/checklist-tasks.ts`), as every checklist reader must (TPL-3 R1). Add the new route to `scripts/verify-tpl3.ts`'s checklist-reader list, with a dated note.
5. **The tablet's 60-second refresh and TAB-5's date-change reload switch to the new route.** Starting a checklist, ticking, unticking and submit keep their current routes.
6. **A failed refresh keeps the last good list** and never blanks the panel. Reuse TAB-5's offline guard if it already shows a stale state. Only if nothing shows today, add one quiet line ("Not updated since 10:42"), shown after 2 consecutive failures and cleared on the next success.
7. **The refresh fetch uses `redirect: "manual"`** and detects an expired sign-in (`type === "opaqueredirect"` or `status === 0`). It then shows TAB-4's "this device's sign-in has expired" message instead of treating the sign-in page as data.
8. **TAB-5's refresh rules are unchanged:** the 60-second timer, the store-local date reload, and skipping a refresh while a sheet or write is busy.
9. **Desktop and every other caller of the old route are unchanged.**

## Build

- Code, then the fixture `scripts/verify-tab8.ts`. It must cover:
  - the route's source has no write calls;
  - it calls `tasksForChecklist`;
  - the gate order;
  - the tablet refresh and date reload call the new route, and nothing else does;
  - desktop's call site is unchanged;
  - `redirect: "manual"` plus expired-session detection;
  - a failed refresh keeps the previous list (pure-function check);
  - database checks on dev: the payload matches today's route field for field for an open checklist, a fresh one and a past one, and the route returns 403 for a store outside scope.
- Each check needs a negative control where the check is structural.
- Re-run and report counts: TAB-1, TAB-1c, TAB-2, TAB-3, TAB-4, TAB-5, TAB-9, CHK-15, TPL-3. `npm run build` green; scoped eslint.
- Local check: if you need a temporary page, delete it before committing.

## Commits (never push)

- Stage only the files this session touched. No `git add -A`.
- **Work commit:** `feat(TAB-8): …`
- **Docs commit:** `docs(TAB-8): …`, covering the ROADMAP TAB-8 row (`in_progress`, work SHA) and a DRAFT DECISIONS entry listing the leans as built. Leave this prompt untracked; PRE-PUSH-CHECK folds it in.

## Report

- TIER, repo gate, audit answers 1–5, and whether any trigger fired.
- Route name and file, the leans as built, and any departures, each marked "(design choice)".
- Fixture counts, build and eslint results.
- Findings classified as FIX NOW / RULING NOW / COMMENT / ROW.
- Both SHAs and `git log @{u}..`. End with "Committed, NOT pushed."
