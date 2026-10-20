TIER 2 session. Read /Users/garythomas/Claude_Projects/Froot/froot/docs/prompts/2026-10-15_BUG-15_dashboard_header_date_hydration.md and execute it. Repo gate first, one command at a time. Stop where it says stop.

# BUG-15 — /dashboard header date causes React #418 after 5 PM Pacific — TIER 2

TIER 2: display-only fix on one screen, plus a refactor of one read-only
route's zone choice into a shared helper (no behaviour change there). No
schema, no rows written, no permission change. Commit only. Never push.
If the work turns out to need any of those, it is TIER 3: say so and STOP.

**Do not launch this session until MS-1 has been promoted to main.** The
approval said: "Hold the build. I'm promoting MS-1 to main first."

## The diagnosis (2026-10-15, read-only session — accepted)
On staging, /dashboard throws minified React #418 (hydration text mismatch,
`args[]=text`) in the evening Pacific, once UTC has rolled to the next day.
Confirmed in Incognito.

Root cause, reproduced at 20:30 PDT (03:30 UTC Oct 16) by server-rendering
`DashboardClient` under `TZ=UTC` and `TZ=America/Los_Angeles` and diffing the
whole HTML. Exactly one line differed:

```
< <p class="text-sm … mt-1">Friday, October 16<!-- --> · Keva Juice — Reno, NV</p>
> <p class="text-sm … mt-1">Thursday, October 15<!-- --> · Keva Juice — Reno, NV</p>
```

Source: `src/app/(app)/dashboard/dashboard-client.tsx:296`.
`headerDate = useMemo(() => new Date().toLocaleDateString("en-US", {weekday, month, day}), [])`
has no `timeZone`, so the server formats it in UTC (Vercel) and the browser
formats it in local time. `useMemo` does not help, because the server and the
browser each run it once.

Nothing else on /dashboard has date text in the server HTML. Every card shows a
skeleton until its client fetch lands, both banners fetch in effects, and saved
store/range selections read `null` on the server snapshot.

Already store-zone and **out of scope**: today so far, hourly cut-off, prior-year
comparison, MTD, days left, labor % and footnotes, rollup figures, "N days
overdue", "Nearest due", month names (`T12:00Z` anchor), and days since last
count (elapsed ms).

## The approval (2026-10-15, quoted verbatim)
> Diagnosis accepted. Proposed fix approved as TIER 2, with three additions:
>
> 1. The rollup header date and /api/dashboard/rollup must use the same time zone rule. Confirm they share one helper; if the org has a display time zone, use that for both.
> 2. Fixture: add a Denver (America/Denver) store case alongside Pacific and UTC.
> 3. File items 2 and 3 (use-labor-date todayStr/shiftDateStr, date-range-picker resolvePreset + calendar cut-off) as one ROW: "dashboard 'today' uses browser time zone, not store time zone". Item 4 (message times) stays a COMMENT.

### What the diagnosis session found on addition 1 (verify in A2/A3)
- **They do NOT share a helper today.** `src/app/api/dashboard/rollup/route.ts:58`
  inlines `const anchorTz = stores[0]?.timezone ?? "America/Los_Angeles"`.
  `src/app/api/calendar/due/route.ts:46` inlines the same pattern. That route is
  **out of scope**: do not touch it, and mention it in the report.
- **The org has no display time zone.** The only org-level zone is
  `Organization.timezone` (`prisma/schema.prisma:144`, DEBT-70a). Its schema
  comment says it is "Not a display preference" and is "only ever read at MINT
  time" (it is the fallback for PDF date stamps for corporate staff with no
  store). So the "if the org has a display time zone" condition is false, and
  the helper must NOT read `Organization.timezone`. If you think it should, that
  is a ruling for Gary: STOP and ask. Do not decide it yourself.
- The house default constant is `DEFAULT_TIME_ZONE` in `src/lib/hr.ts:259`. The
  helper uses it instead of the string literal.

## Repo gate (one command at a time, paste each result)
pwd                → must end in Froot/froot
git status         → on staging, tree clean, up to date with origin/staging
git log --oneline -5
If any check fails: STOP and report. No `cd` unless the gate fails.

## Phase 1 — brief audit (TIER 2: name files and why, then proceed)
A1. Re-read `dashboard-client.tsx` around the header (`headerDate`) and its
    `stores` prop type. Confirm line 296 is still the only clock read in the
    server-rendered tree (grep the dashboard folder,
    `src/components/calendar-due-banner.tsx` and `build-info.tsx` for
    `new Date`, `Date.now` and `toLocale`).
A2. Read `src/app/api/dashboard/rollup/route.ts` around `anchorTz`. Confirm
    the inline rule, and confirm `src/lib/hr.ts` exports `DEFAULT_TIME_ZONE`.
A3. **Same anchor store, or the helper proves nothing.** The page builds its
    store list from `getUserStoreScope()` (isAdmin / storeIds, `isActive`,
    `orderBy name asc`). The rollup route builds it from
    `dbUser.role === "ADMIN"` / `dbUser.storeAssignments` (`isActive`,
    `orderBy name asc`). Report whether the two always produce the same
    `stores[0]` for the same user. If they can differ (scope source, role
    rules, ordering), STOP and report: one helper over two different lists is
    not one rule.
A4. Read `node_modules/next/dist/docs/` on server→client props for this Next
    version (AGENTS.md). Only plain serialisable props cross the boundary.
A5. `docs/ROADMAP.yaml`: confirm BUG-15 and BUG-16 are still free (BUG-14 was
    the highest on 2026-10-15). If either is taken, use the next free id and
    say so.

## Phase 2 — build
1. **Shared helper.** In `src/lib/reports.ts`, next to `localDateStr`, add
   something like `dashboardAnchorTimeZone(stores: { timezone: string }[]): string`
   that returns `stores[0]?.timezone ?? DEFAULT_TIME_ZONE`. Add a comment
   saying it is the one rule for the rollup's "today", used by both the route
   and the page header, and that `Organization.timezone` is deliberately not
   read (DEBT-70a, mint-time only).
   Also add a pure formatter, `dashboardHeaderDate(instant: Date, timeZone: string): string`,
   built on `Intl.DateTimeFormat("en-US", { timeZone, weekday: "long", month: "long", day: "numeric" })`.
   The fixture tests these two functions.
2. **Rollup route.** Replace the inline `anchorTz` with the helper. The
   behaviour must not change.
3. **Page.** In `src/app/(app)/dashboard/page.tsx`, add `timezone: true` to
   the store `select`. Compute `const now = new Date()` once. Pass each store a
   `headerDate: dashboardHeaderDate(now, s.timezone)`, and pass
   `rollupHeaderDate: dashboardHeaderDate(now, dashboardAnchorTimeZone(stores))`.
   The existing `const now = Date.now()` in the count-recency block is a
   different variable in a different scope. Leave it alone and do not rename
   it into a clash.
4. **Client.** In `DashboardClient`, delete the `useMemo` and read
   `isRollup ? rollupHeaderDate : store?.headerDate ?? ""`. The client never
   reads the clock for this text. Switching stores swaps to that store's own
   string; there is no recomputation. The page stays frozen at load time,
   exactly as the old `useMemo([])` was, so do not add a midnight timer.
5. Touch nothing else. Items 2–4 below are not in this session.

## Fixture — `scripts/bug15-dashboard-header-date-fixture.tsx`
A pure script: no DB, no network. Run with
`npx tsx --tsconfig tsconfig.json scripts/bug15-…` from the repo root (no-save
install, as the other verification scripts do). Print PASS/FAIL per case and
exit non-zero on any FAIL.

**F1 — formatter, pinned instants (process-TZ independent):**

| Instant | Zone | Expected |
|---|---|---|
| `2026-10-16T03:30:00Z` | America/Los_Angeles | `Thursday, October 15` |
| `2026-10-16T03:30:00Z` | America/Denver | `Thursday, October 15` |
| `2026-10-16T03:30:00Z` | UTC | `Friday, October 16` |
| `2026-10-16T06:30:00Z` | America/Denver | `Friday, October 16` (Denver past midnight) |
| `2026-10-16T06:30:00Z` | America/Los_Angeles | `Thursday, October 15` (Pacific not yet) |

The 06:30Z pair is the Denver case that matters: it fails if anything quietly
hard-codes Pacific.

**F2 — anchor helper:**
- stores sorted `[Denver store, Pacific store]` → `America/Denver`
- `[]` → `DEFAULT_TIME_ZONE`

**F3 — no hydration mismatch.** `renderToString` `DashboardClient` with fixture
props:
- one Pacific store, one Denver store
- `headerDate` values from the F1 formatter at the pinned instant
- the rollup date from the anchor helper

The script re-runs itself as a child process (`process.execPath` with the same
args) under `TZ=UTC`, `TZ=America/Los_Angeles` and `TZ=America/Denver`. Assert
the three HTML strings are byte-identical, and assert the header `<p>` contains
the expected store-local date. Before the fix, this check fails with exactly the
diff above.

Note: `react` resolves from the repo's `node_modules` only when the script lives
inside the repo. The diagnosis session needed `NODE_PATH` because it ran from a
scratch directory.

## Gates and commits
1. Run the fixture: every case must PASS. Paste the output.
2. **Commit 1** (code): helper, route, page, client, fixture script.
   `git add` those paths only. Heredoc the message.
3. **Commit 2** (docs). Add to `docs/ROADMAP.yaml` under `bugs:` (fields
   allowed: id/title/status/shipped/commits/notes; NO `blockers`, NO `open`):
   - **BUG-15.** status `in_progress`; commits = Commit 1's SHA (record it in
     this second commit, never amend Commit 1). Notes must cover: root cause
     with file:line, the helper and the `Organization.timezone` non-use, fixture
     results, "unverified on staging — load /dashboard after 5 PM Pacific
     (UTC has rolled over) on a Pacific store, a Colorado store and All
     locations, and check for no #418 and the store-local date in the header", and the COMMENT for item 4 below.
   - **BUG-16** — title: "dashboard 'today' uses browser time zone, not store
     time zone". status `planned`, no commits. Notes:
     - **Item 2:** `src/app/(app)/dashboard/use-labor-date.ts` `todayStr()` /
       `shiftDateStr()` use browser-local time. They set the labor cards'
       default day and week, the "today" button, and the back/forward limits.
     - **Item 3:** `src/app/(app)/dashboard/date-range-picker.tsx`
       `resolvePreset()` uses browser-local `new Date()` for the Sales
       "Today/Yesterday/This week/This month" presets and the rollup's default
       "This month". Its calendar cut-off `disabled={{ after: new Date() }}` is
       browser-local too.
     - Neither can cause #418, because both run only after hydration. Both are
       wrong only when the viewer's zone differs from the store's (e.g. a
       Pacific viewer on a Colorado store between 11 PM and midnight Pacific).
       `/api/dashboard/sales` clamps `end > today`, which hides some of it.
       Fixing it changes what the cards request, so it is behaviour, not
       display.
   Then `npm run build` (prebuild typechecks ROADMAP.yaml; a bad row fails
   Vercel). Paste the result. If the build fails on the row, fix the row in
   a third commit.
4. Say "committed, NOT pushed". Never push.

## Report
- The A1–A5 results.
- The fixture output.
- Both SHAs and the build result.
- Triage: **FIX NOW** (done) / **RULING NOW** (only if A3 or the org-zone
  question forced a stop) / **COMMENT** / **ROW**, with counts.

**COMMENT (item 4), in the BUG-15 notes and the report, not a row:**
`dashboard-client.tsx:92-100`. Team-message relative times and dates format in
the browser's zone. That is arguably correct for the reader, and it only runs
after the fetch, so it cannot mismatch.

Then STOP.
