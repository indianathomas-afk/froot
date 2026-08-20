# Schedule/Actual Overlay — S1 Discovery Scout · Session Prompt

**Module:** Advanced Labor / schedule overlay track (pre-build)
**TIER:** 2 (read-only discovery — no migrations, no source changes, NO COMMITS)
**Builds on:** Same-day shape fix shipped (BUG-9, merge 248a80b); overlay scope
rulings in DECISIONS.md (2026-08-20)
**Session type:** Single Claude Code session. Observe and report. Build nothing.

---

## 0 · How to run this session

1. **Precondition A:** `docs/DECISIONS.md` contains the entry
   "Schedule/actual overlay, scope rulings — 2026-08-20 (Gary)". STOP if absent.
2. **Precondition B — credentials law:** this session uses the LOCAL DEV
   environment only (.env → dev Neon branch br-broad-wave). It must NOT
   connect to staging or production databases (Neon-console-only rule) and
   must NOT read or handle deployed-environment secrets. The Square org
   token it uses is the dev DB's stored, consented, read-only grant.
3. **Read-only, both directions.** No source edits, no migrations, no deps,
   no commits. A temporary probe script is allowed but must live in an
   uncommitted scratch path (e.g. scratch/probe-scheduled-shifts.ts),
   be listed in the report, and be deleted before the session ends.
   `git status` clean at exit.
4. Structural read-only law applies as always: the OAuth grant has no write
   scopes (SQ-WB-1) — every call in this session is a read by construction.
   Use the shared SQUARE_VERSION constant. ScheduledShift is Beta at Square:
   document observed reality, not documented claims, and note any place the
   two differ.
5. No `&&` chains. Findings triage: FIX NOW / RULING NOW / COMMENT / ROW —
   but since this session cannot fix, FIX NOW items are reported as
   URGENT findings, not fixed.
6. Deliverable is the REPORT (§4), pasted back to planning. Nothing else.

---

## 1 · API probe — observe ScheduledShift reality

Using the dev org token, against the real Square API:

1. **Endpoint + auth:** confirm the exact ScheduledShift search/list endpoint,
   that TIMECARDS_READ authorizes it (LABOR-0B claimed this, verified at
   source — now verify at runtime), and record the HTTP status story:
   success, and what an auth-insufficient response would look like.
2. **Real payloads:** fetch scheduled shifts across a date window wide enough
   to find data (suggest: −14 days to +28 days, all locations). Record 2–3
   complete raw example objects (redact nothing structural; mask only
   personal names if present → "REDACTED_NAME").
3. **Field inventory:** every field observed, its type, and whether it was
   always present or sometimes absent across the sample. Special attention:
   - team_member reference (how it links to our SquareTeamMemberWage /
     roster rows)
   - position/job reference (this drives the color feature — how is the
     position identified? id? name? does it match the AL-3 roster's
     position data?)
   - start/end times (timezone representation — UTC? location-local?
     offset? this decides how the overlay buckets hours)
   - draft vs published state (do we see drafts? is there a flag? the
     overlay should presumably show published only — flag as a ruling
     question if drafts are visible)
   - location reference, and any pagination/cursor mechanics
4. **Empty vs error:** if some/all locations have no schedules (migration to
   Square Scheduling is in progress), record what "no schedules" looks like
   vs what an error looks like — seam (c) rendering depends on telling
   these apart.
5. **Version note:** record the SQUARE_VERSION used and any Beta warnings or
   headers in responses.

## 2 · Codebase seam audit (read-only; quote file:line)

1. **The sync pattern to clone:** map the timecard sync's anatomy —
   sync-state table row, claim/cooldown mechanism, trigger site on the
   dashboard, error handling — as the checklist S2 will clone for
   schedules. File:line for each element.
2. **Where the overlay data will enter the card:** the Coverage card's
   chart layer (labor-coverage-card.tsx) — where do overlay series props
   attach without touching the suggested-curve computation? Confirm the
   import direction wall: nothing in labor-plan.ts / labor-coverage.ts may
   import from any future schedule module. Name what currently imports what.
3. **Actuals-by-hour:** confirm clocked-in-count-by-hour is derivable from
   the existing SquareTimecard rows (fields needed, open-timecard handling
   for the current hour), as a pure function candidate for the overlay's
   "actual staffing" series. No building — just confirm feasibility and
   name the fields.
4. **PERM-5 seam:** where the capability override for this feature plugs in —
   the existing pattern (labor.actuals.view as the model), file:line, and
   the proposed capability name for the overlay (report a suggestion).
5. **Color override seam:** where a per-position stored color would live —
   is there an existing positions/roster table row to extend (additive
   column), and where would the deterministic default be computed?
6. **Store timezone:** confirm how the card's hour axis derives store-local
   hours today, and that scheduled-shift times can be mapped into the same
   bucketing (given whatever §1.3 found about timezone representation).

## 3 · Proposals (drafts for planning review — nothing is decided here)

1. **SquareScheduledShift table design** — columns, types, indexes — derived
   from the OBSERVED payload shape, additive-only philosophy, mirroring
   the timecard table's conventions where they fit.
2. **Sync module sketch** — one paragraph: what S2 builds, cloned from
   which timecard pieces.
3. **Open ruling questions for Gary** — anything §1/§2 surfaced that needs
   a decision before S2 (e.g. drafts visibility, position mapping
   ambiguities, pagination limits, data gaps at unmigrated stores).

## 4 · Report format

Sections mirroring §1–§3, file:line on every code claim, raw payload
examples included, every DB statement naming the branch (br-broad-wave
expected — anything else is a violation of Precondition B). End with the
findings triage and confirmation that scratch files are deleted and
`git status` is clean.

## 5 · Out of scope (do not do)

- Any commit, any source edit, any migration, any new dependency.
- Any connection to staging/production databases or secrets.
- Any Square write call (structurally impossible; listed for the record).
- Any change to sync, webhook, cron, OAuth, or SQUARE_VERSION.
- Building any part of S2/S3/S4.
