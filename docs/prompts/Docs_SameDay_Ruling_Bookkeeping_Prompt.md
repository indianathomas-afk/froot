# Docs bookkeeping — same-day coverage-shape ruling + session prompt file

**TIER:** 1 (docs only — no code, no migration, no build risk)
**Session type:** Single short Claude Code session. Two file writes, one commit. Nothing else.

---

## 0 · Rules

1. Work in the git root `~/Claude_Projects/Froot/froot` (lowercase `froot`).
2. **Insert the texts below VERBATIM.** Do not reword, summarize, or "improve"
   either block. The DECISIONS.md entry is Gary's ruling — his words are the
   ruling. Formatting may be adapted only as far as §1 allows.
3. Read `docs/DECISIONS.md` first and match its existing structure (heading
   level, dating style, attribution style) when placing the entry. If the file
   uses a different convention than the block below (e.g. different heading
   depth), adapt the *formatting* to match — never the *words*.
4. `docs/prompts/` is append-only — you are adding a new file, touching nothing
   existing in that directory.
5. No `&&` chains. Commit, do NOT push.
6. If anything is ambiguous (e.g. unclear where the entry belongs), STOP and
   ask rather than guessing.

---

## 1 · Append to `docs/DECISIONS.md`

Place this with the other Advanced Labor / coverage rulings, as a new dated
entry:

```markdown
## Same-day coverage shape (ruled 2026-08-19)

- The current day's demand shape uses the future-day template (4-week
  same-weekday average, last-year fallback) — never its own partial-day
  SalesHourlyCache. (Gary)
- Past days use their own complete cache. When today becomes yesterday, the
  card flips to actuals — that flip is intended. (Gary)
- The hours/budget/split path is unchanged — this ruling is shape-source only. (Gary)
- Hybrid intraday shapes (actuals-to-date + template remainder) are rejected. (Gary)
- "Today" is classified on the store-local day, not UTC. (Gary)
```

---

## 2 · Create `docs/prompts/Labor_Coverage_SameDay_Shape_Fix_Session_Prompt.md`

With exactly this content:

```markdown
# Labor Coverage — Same-Day Demand-Shape Fix · Session Prompt

**Module:** Advanced Labor / L-3 forecast core (core-adjacent — tread carefully)
**TIER:** 2 (contained fix, brief audit then proceed; STOP and report if the audit contradicts the mechanism below)
**Builds on:** L-3 + AL-1..3, all on main (promoted 2026-08-19, merge 5e2f4d7)
**Session type:** Single Claude Code session. One contained fix. No scope creep.

---

## 0 · How to run this session

Standard Froot workflow (`../../CLAUDE.md`, `../WORKFLOW.md`):

1. **Precondition — do not build until this is true:** `docs/DECISIONS.md`
   contains Gary's ruling (in his words) covering: today uses the future-day
   demand template; past days use their own complete cache; the elapsed-day
   flip back to actuals is intended. If the ruling is absent, STOP and say so.
2. Brief read-only audit first (§2) — quote file:line for each item. If the
   mechanism differs from §1, STOP and report before touching anything.
3. **No migration expected. No new deps. No scope changes, no version changes,
   no webhook/cron changes.** Nothing new feeds the forecast engine — this fix
   only changes *which existing sales-cache slice* shapes the current day.
4. `npm run build` must pass before any commit (hard gate). Both verify
   scripts green (`verify-labor-budget.ts`, `verify-labor-coverage.ts`).
5. Two-commit pattern: work commit, then docs/recorder commit (ROADMAP row
   status + this row's notes). Commit only — Gary pushes.
6. No `&&` chains. Out-of-scope findings → FIX NOW / RULING NOW / COMMENT /
   ROW triage in the session report; ROW is last resort.

---

## 1 · The mechanism being fixed (from the planning session, 2026-08-19)

The coverage demand-shape source branches on date classification:

- **today/past** → `SalesHourlyCache` for that date
- **future** → 4-week same-weekday average (fallback: last-year same-weekday)

`computeDailyCoverage` (`src/lib/labor-coverage.ts`) is pure and distributes
the day's entire hourly budget proportional to whatever demand array it gets.
On the **current day**, today's cache only contains elapsed hours — so the
whole budget is crammed into the morning and post-now hours sit at floor-1,
filling in hour by hour as sales land. Same-day only; past and future days
have complete shapes and render correctly.

**The fix:** reclassify the boundary. `date < today` (store-local) → that
date's own cache, as now. `date >= today` → the existing future-day template
(4-week same-weekday average, existing fallback). Today's *hours* still come
from the goal→budget→split path — untouched. Only today's *shape* source
changes. Recomputation is deterministic: day-of renders the same curve the
future-day view showed yesterday (same goal row, same 4 completed weekdays,
same pure math), and it stays stable all day instead of mutating from
actuals-to-date.

---

## 2 · Audit checklist (brief; quote file:line for each)

1. **The classification site.** Where today/past vs future is decided — the
   `/api/labor/coverage` route and/or the `labor-forecast.ts` / demand-shape
   helper. Quote the exact branch.
2. **Timezone of "today."** Confirm the boundary is the **store-local day**,
   not UTC. Prisma stores UTC; a UTC boundary would misclassify evenings
   (store-local 6pm = next-day UTC). Report how the existing code derives
   "today" (shared date hook / store timezone handling) and whether the fix
   must reuse it. If classification is currently UTC-based, report it as a
   finding — do not silently widen scope; the fix should land store-local.
3. **The template helper.** The existing 4-week same-weekday average function
   + its last-year fallback — confirm it can be called for today's date
   without modification (the window must be the last 4 *completed* same
   weekdays, excluding today).
4. **All consumers of the demand shape.** Dashboard Labor Coverage card and
   the Weekly Plan day detail both ride `/api/labor/coverage` — confirm both
   inherit the fix with no divergent second code path. Report any other
   consumer.
5. **Cache population cadence for today** (how/when today's `SalesHourlyCache`
   fills) — one paragraph, to close the loop on the hourly-rolling symptom.
   Read-only; no sync changes.

---

## 3 · Deliverable

- The one branch change at the classification site: `date < today`
  (store-local) → per-date cache; `date >= today` → future template.
- Past-day behavior byte-identical. Future-day behavior byte-identical.
- **Fixture:** add a case to `scripts/verify-labor-coverage.ts` (or the
  appropriate verify script per the audit): the current day's demand shape is
  the template shape, not the partial per-date cache; a past date still uses
  its own cache. Keep it pure (inject "today" — do not read the clock inside
  the assertion).
- If the shape source is labeled anywhere in the UI (e.g. tooltip/legend),
  report whether today's label needs to say "projected shape" — report only,
  no UI redesign.

---

## 4 · Out of scope (do not build)

- Schedule/actual overlay, ScheduledShift ingest, any new sync — next session.
- Hybrid intraday shapes (actuals-to-date + template remainder) — rejected.
- Per-day shape overrides / holiday patterns — future conversation.
- Anything touching timecards, wages, cron registration, OAuth, SQUARE_VERSION.
- Any change to how *hours* are budgeted or split.

---

## 5 · Definition of done

- Audit reported with file:line quotes; mechanism confirmed (or STOPPED).
- Branch change landed; store-local boundary; build green; both verify
  scripts green including the new same-day fixture case.
- No migration, no new deps, no other files drifting.
- Work commit + docs commit (ROADMAP row updated). NOT pushed.
- Out-of-scope findings triaged as text, not fixed.
```

---

## 3 · Commit

One docs commit covering both files. Suggested message:

```
docs: same-day coverage shape ruling + fix session prompt
```

Do NOT push. Report the commit hash and stop.
