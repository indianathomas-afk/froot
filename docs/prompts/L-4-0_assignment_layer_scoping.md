TIER 3 session (scoping only — no code, no schema, no migration). Read /Users/garythomas/Claude_Projects/Froot/froot/docs/prompts/L-4-0_assignment_layer_scoping.md and execute it. Repo gate first, one command at a time. Stop where it says stop.

# L-4-0 — Labor assignment layer: row correction + phase split — TIER 3

## Why TIER 3 with no code

This session writes no code and runs no Prisma command beyond what `npm run build`
does (`prisma generate`, not a migration — note it, don't treat it as a breach).
It is TIER 3 because it fixes the design that every L-4 build session will be
held to: the data model, who a "person" is, and where Square stops. Plan-first,
hard stops, one docs commit at the end. No riders.

## What L-4 is (plain English)

Today the Weekly Labor Model plans hours and headcount — "Las Brisas needs 3
people Monday 7–2." L-4 puts names on it — "Maria, Monday 7–2 at Las Brisas."
Scope: named-person shifts, GM days off, per-person breaks. Its first visible
payoff: a manager split between Las Brisas and UNR stops drawing a
"Manager expected 07:00–14:00" band on both stores' charts the same day,
because Froot finally knows which store she's at which day (residue inherited
from R7-C on 2026-08-23, recorded on the L-4 row).

## The two defects on the row (Gary's finding — verify, don't cite)

1. **The "Square push" half is dead.** The row (written 2026-08-05/06) says
   write-back needs TIMECARDS_WRITE. Gary's ruling of 2026-08-18 says Froot
   never writes to Square and requests no `_WRITE` scope. The row never
   acknowledges this.
2. **The blocker is stale.** It says "BEHIND L-2." L-2 shipped 2026-08-19
   (merge 5e2f4d7). The blocker's own text already says the Froot-only layer
   "is not gated by any of this and could be scoped independently."

## Repo gate (one command at a time, paste results)

```
pwd
```
→ must end in `Froot/froot` (lowercase). If it ends in capital-F `Froot`,
STOP — Gary re-runs the `froot` alias.

```
git status
```
→ on `staging`, tree clean. Anything else: STOP.

```
git log --oneline -3
```
→ report HEAD. Gary's last paste showed `c416ee3` on staging and main.
If HEAD differs, say so out loud before going further.

## Phase A — read (read-only, report findings)

Read the files themselves. Never assume from this prompt or from memory of
prior sessions (DEBT-84). Where this prompt conflicts with the file at HEAD,
the file wins and you say so.

A1. `/Users/garythomas/Claude_Projects/Froot/froot/docs/ROADMAP.yaml` — the
    full L-4 row verbatim, plus L-2, L-3, R7-C, R7-D, R7-E, DEBT-83, CRON-1.
    Note the file's convention for (a) closing a blocker, (b) correcting a
    title, (c) the next free IDs if sub-rows are needed.

A2. `/Users/garythomas/Claude_Projects/Froot/froot/docs/DECISIONS.md` — print
    the 2026-08-18 read-only ruling VERBATIM. Confirm it covers TIMECARDS_WRITE
    explicitly or by its general wording; say which. If no such ruling exists
    as Gary described it: STOP, report, RULING NOW.

A3. `/Users/garythomas/Claude_Projects/Froot/froot/prisma/schema.prisma` — list
    every model that could be the "person" on a shift: Clerk-backed users,
    the staff/roster records AL-3's staff import created, Positions, and any
    Square team-member mirror. For each: key, org/store scoping, whether people
    without a Froot login exist in it. Also list every model or type named or
    containing `Shift` (the row says the bare word is already spent twice —
    re-measure). Confirm whether `SquareScheduledShift` was ever built or only
    named.

A4. Labor engines — `src/lib/labor-plan.ts`, `labor-coverage.ts`,
    `labor-budget.ts`, `labor-daily.ts`, `labor-week.ts`, `labor-actuals.ts`:
    where the manager expected-window band is computed and drawn (file:line),
    where the GM 40-hr cap lives, and what the core engines import today.
    The L-2 boundary rule (core engines never gain a Square-sourced input)
    still holds; note that Froot-entered assignments are NOT Square-sourced,
    so the rule does not by itself forbid them feeding core — flag it as a
    ruling item, don't decide it.

A5. Permissions — `src/lib/permissions.ts` and
    `/Users/garythomas/Claude_Projects/Froot/froot/docs/PERMISSIONS_INVENTORY.md`:
    which roles see labor surfaces today, and the AL-3 rule that the capability
    decides whether to RUN THE QUERY, never whether to render the cell.

Report Phase A as a short findings list with file:line cites.

## Phase B — plan (then HARD STOP)

Propose, in this order:

**B1. Row correction text** — exact YAML you'd prepend to the L-4 row, following
the file's own preserve-and-mark convention (nothing deleted, closures dated
2026-10-30, prepended):
- Blocker "BEHIND L-2": closed, citing L-2 shipped 2026-08-19 / 5e2f4d7.
- Square push half: struck from L-4 scope, citing the 2026-08-18 ruling by its
  DECISIONS.md heading. State plainly that reopening it would need a NEW ruling
  and its own row, not an edit to this one. The old "batch L-2 and L-4 scopes
  into one consent" argument is retired with it — say so.
- Title: if the convention allows a title change, propose the new title with the
  old one preserved in notes; if not, a prepended correction only. Say which
  the file supports.
- Status stays `planned` (status = where the code is; no code exists).

**B2. Sub-phase split** — lean, not a menu. Starting proposal, adjust to what
Phase A found:
- **L-4a — data model.** Additive migration: an assignment model (person ×
  store × date × start/end) + GM days off. Not named bare `Shift`. Fixture.
  No UI.
- **L-4b — scheduler UI + write routes.** Manager builds a week against the
  existing plan's headcount; capability-gated per A5.
- **L-4c — per-person breaks.** Planned break windows on an assignment.
- **L-4d — chart band reads assignments.** Manager band draws only at the store
  she's assigned that day; falls back to today's behavior when no assignment
  exists. Closes the R7-C residue. Do NOT widen the label (the row forbids it).
For each: tier, size, what it touches, what it explicitly does not.

**B3. RULING NOW items** — each one sentence, with your lean:
1. Square push: struck (lean) vs. reopened by new ruling.
2. Who is the "person": which model from A3 a shift keys on (lean: the roster
   entity that includes people without logins — staff without Froot accounts
   still work shifts).
3. Do assignments feed core engines (labor-plan / coverage / the GM cap), or
   sit beside them as a comparison layer like labor-actuals? State the
   consequence of each for the "drop the tables, everything renders
   byte-identically" boundary test.
4. Breaks: planned annotation only, or checked against Nevada rest/meal rules?
   (Lean: annotation only in L-4c; any compliance warning is its own row, as the
   Nevada OT warning was on L-2.) Do not encode labor law from memory.
5. Visibility: which roles see named schedules, and whether a STORE-role user
   sees other people's shifts at their own store.
6. Anything else Phase A surfaced.

Classify every out-of-scope finding FIX NOW / RULING NOW / COMMENT / ROW
(ROW is last resort). FIX NOW is limited to the L-4 row itself in this session.

### ═══ HARD STOP ═══
Print B1–B3. For each ruling item, print a one-sentence draft wording and ask
Gary: "Ratify as written, or give me your wording." Write nothing until he
replies. Record his reply verbatim.

## Phase C — write (only after Gary's go)

C1. Prepend the approved correction to the L-4 row in
    `/Users/garythomas/Claude_Projects/Froot/froot/docs/ROADMAP.yaml`.
    Add sub-rows only if Gary approved them, at IDs read from the file.
    No `meta.updated` key.
C2. Add each ruling Gary ratified to
    `/Users/garythomas/Claude_Projects/Froot/froot/docs/DECISIONS.md` in HIS
    words verbatim (or the draft he ratified as written). Unratified items stay
    out — list them in the report as open.
C3. Write the agreed design (B2 as approved + rulings + Phase A findings with
    cites) to `/Users/garythomas/Claude_Projects/Froot/froot/docs/LABOR.md`
    under a new "L-4 · Assignment layer" section, so L-4a's prompt has a
    file to point at instead of chat history.
C4. No `__` placeholder tokens in anything written. Check:
    ```
    grep -c '__' docs/ROADMAP.yaml
    ```
    → report the count before and after your edit; it must not rise.
C5. Gate:
    ```
    npm run build
    ```
    → must pass. Confirm no error line above the summary.
C6. Stage only the files you touched (no `git add -A`), including this prompt
    file. One docs commit:
    `docs(L-4-0): row corrected (L-2 blocker closed, Square push struck per 2026-08-18), phase split, rulings`
    Single commit is correct here — there is no work commit to cite.
C7. ```
    git status
    ```
    → clean.

## Report and stop

Commit SHA, files changed, rulings ratified vs. open, and the approved L-4a
scope in three lines. Do NOT push. Do NOT start L-4a. Next step is Gary's
PRE-PUSH-CHECK.
