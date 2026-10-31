TIER 3 session. Read /Users/garythomas/Claude_Projects/Froot/froot/docs/prompts/BUG-17_heal_open_timecards.md and execute it. Repo gate first, one command at a time. Stop where it says stop.

# BUG-17 — Heal stale open timecards + 24h guard — TIER 3

## What this is (plain English)

Froot only re-checks Square timecards by the day they started. Once that day
leaves the sync window, a card Froot stored while it was still open never gets
its clock-out. In Froot it stays open forever. That inflates labor % and cost,
makes every later shift count as on time, and makes the Day Inspector show
thousands of paid hours.

This session ships two fixes together:
1. **Heal:** each sync also asks Square for the real state of old open cards,
   by ID.
2. **Guard:** a card open for more than 24 hours is never counted as paid time
   or attendance.

## Evidence on record (Gary, Neon console, 2026-10-31)

- **staging `br-square-feather-a63z92vz`:** 155 open-older-than-24h cards across
  8 stores, oldest start 2026-08-20 22:00 UTC. Per store: Las Brisas 58, South
  Reno 44, Carson 29, Meadowood Mall 9, UNR 7, Southgate 5, Spanish Springs 2,
  University Village 1. `status_says_closed` was 0 everywhere: Froot itself
  still says OPEN.
- **production `br-sparkling-block-a620qvg4`:** 0. Production is clean today,
  because its nightly sync keeps cards inside the window.

## Rulings this session builds against (read them; don't re-decide)

The `docs/DECISIONS.md` 2026-10-31 TIMECARD-HEAL-0 entry, ratified as written,
plus `docs/prompts/TIMECARD-HEAL-0_AUDIT.md` for the cites. Quote all five
verbatim in Phase A. Expected:

1. **N = 24h.** An open timecard older than 24 hours is counted as unknown,
   never as paid time or attendance.
2. **Heal and guard ship together.**
3. **Heal by ID, capped:** at most 25 cards per store per run, inside
   `syncTimecardsForStore`, so it runs from both the nightly cron and staging's
   dashboard sync.
4. **A 404 on heal is logged, not acted on.**
5. **Inspector paid hours count only the viewed day.**

Plus the standing rules: **read-only toward Square** (GET only; no new
scope), and the L-2 boundary.

## OUT

- No schema change, no migration. If you conclude one is needed: STOP, RULING
  NOW.
- No deleting or hiding cards Square says don't exist (ruling 4).
- No new Square scope, and no write call.
- No manual re-sync button. That's a separate ROW finding from the audit.
- No change to the midnight-crossing Inspector display. Also its own ROW.

## Repo gate (one command at a time, paste results)

```
pwd
```
→ must end in `Froot/froot`. If it ends in capital-F `Froot`, run
`cd /Users/garythomas/Claude_Projects/Froot/froot` and run `pwd` again.

```
git status
```
→ on `staging`, tree clean except this prompt file.

```
git log --oneline -2
```
→ report both. The top should be the TIMECARD-HEAL-0 PRE-PUSH-CHECK commit,
level with origin.

## Phase A — read (read-only, report with file:line)

A1. Quote the five rulings and the BUG-17 row's notes verbatim.
A2. **`syncTimecardsForStore`** and its callers (cron, dashboard sync at
    labor-dashboard.ts:197-229, the manual route). Report:
    - the existing fetch helper;
    - token handling;
    - error and rate-limit handling;
    - timeouts;
    - how the dashboard awaits the sync (does page render block on it?).
A3. **The Square "retrieve timecard by ID" endpoint.** The audit said the
    exact REST path still needs checking. Read it from the local `square` CLI
    schema offline, as the audit did. Confirm:
    - it's a GET;
    - it's covered by the timecard read scope Froot already holds;
    - the response shape;
    - the 404 shape.
    Make no live Square calls from this session.
A4. **Every reader of timecards that produces a number or a flag:**
    - labor-actuals (labor % and cost, including the dashboard, summary and
      rollup ranges);
    - attendance.ts:183-190 (on-time pairing, no-show);
    - tips, if any;
    - labor-inspector.ts (paid hours, Open/stale, Double).
    Say where a shared helper can apply the 24h guard once, so they all agree
    (the audit's lean).
A5. The fixture precedent for mocked fetch and an injected clock, if one
    exists. Dev has 0 timecards (audit A5), so the fixture uses made-up data.

## Phase B — plan (then HARD STOP)

B1. **Heal design.**
    - Which cards it selects: open, start older than the window, oldest first,
      at most 25.
    - How it calls Square, and how results are upserted. Use the same upsert
      path the sync already uses, so a healed card looks exactly like a
      normally synced one.
    - The 404 log line.
    - What happens on a Square error mid-heal. The rest of the sync must still
      succeed.
B2. **Latency.** Staging runs the heal on dashboard load. 25 sequential
    fetches per store could slow `/dashboard` noticeably. Measure or estimate
    the cost from A2, and propose how to keep render fast: bounded
    concurrency, a time budget, or not awaiting the heal. If this needs a
    choice, it's RULING NOW.
B3. **Guard design.** The one helper, and how each reader from A4 uses it.
    - What "unknown" looks like on the Day Inspector: tag text and bar
      drawing. Keep the existing "Open, stale" look unless there's a reason.
    - What the rest of the UI shows: excluded silently, or a small "N
      timecards need review" note? Lean: a note where a number would otherwise
      quietly drop.
B4. **Ruling 5 design.** How Inspector paid hours get clipped to the viewed
    day.
B5. **Fixture** `scripts/verify-bug17-heal.ts`: mocked Square responses,
    injected clock, made-up data. It must prove:
    - a stale open card heals to CLOSED with Square's clock-out;
    - the cap of 25;
    - a 404 is logged and the card is left alone;
    - a Square error doesn't fail the sync;
    - the 24h guard removes a stale card from labor %, cost and attendance;
    - a card open under 24h still counts. Someone mid-shift is real;
    - Inspector paid hours are clipped to the day;
    - **the boundary test:** with no open card older than 24h in the data,
      every existing number (labor %, cost, on-time, Inspector hours for
      same-day cards) is byte-identical to HEAD. That's production's state
      today, so production's numbers must not move;
    - no rows left behind, if any DB is touched (dev-only SELF-1 guard).
B6. **RULING NOW items** (B2 at least), one sentence each, with your lean and a
    draft wording.
B7. Classify out-of-scope findings FIX NOW / RULING NOW / COMMENT / ROW. File
    the audit's two ROW findings (the midnight-crossing Inspector hours, and
    no manual timecard re-sync on staging) as `planned` rows in Phase D unless
    they're already filed. Say which.

### ═══ HARD STOP 1 ═══
Print B1–B7. For each ruling: "Ratify as written, or give me your wording."
Write nothing until Gary replies. Record his reply verbatim.

## Phase C — build

C1. Build the approved design.
C2. Run the fixture. Paste the full pass/fail list. Any failure: STOP.
C3. Run `npm run build`. It must pass with no error line above the summary.
C4. Stage only the files you touched. Work commit:
    `fix(BUG-17): heal stale open timecards by id; 24h guard on paid time and attendance`

## Phase D — docs commit (cites the work SHA)

D1. `docs/ROADMAP.yaml`:
    - BUG-17: prepend a block with what shipped, the work SHA, rulings by
      heading, the fixture line, and the 155 / 0 evidence above with branch
      ids. Status `in_progress`.
    - File the two audit ROW findings if not already filed.
    - No `meta.updated` key.
D2. `docs/DECISIONS.md`: Gary's B6 rulings verbatim, as one dated entry at the
    top.
D3. `docs/LABOR.md`: a short section on the heal and the guard, with file:line
    and a pointer to the fixture.
D4. Placeholder count before and after. It must not rise.
D5. Run `npm run build`. Stage only the docs you touched plus this prompt.
    Docs commit:
    `docs(BUG-17): row in_progress, rulings, LABOR.md, prompt`
D6. `git status` shows a clean tree.

## Report and stop

Report:
- both SHAs, the files changed, the fixture result line, and rulings ratified
  vs. open;
- every Prisma command run, exactly as typed;
- **a staging check for Gary,** in plain English:
  - how many `/dashboard` loads it takes to heal Las Brisas's 58 cards, given
    the cap of 25 and which stores the dashboard sync covers;
  - the Neon-console query to re-count stuck cards per store afterwards;
  - what the Day Inspector should look like once healed.

Do NOT push. Next is Gary's PRE-PUSH-CHECK.
