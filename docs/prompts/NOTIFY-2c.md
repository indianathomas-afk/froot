Read /Users/garythomas/Claude_Projects/Froot/froot/docs/prompts/NOTIFY-2c.md and execute it.

# NOTIFY-2c — Per-user email controls in the Edit User grid

**TIER 2 expected** (reuse the capability arrays; no schema). If the audit
finds the capability model cannot carry this without a column, STOP and
report — it becomes TIER 3 and Gary decides.

**Save to:** `/Users/garythomas/Claude_Projects/Froot/froot/docs/prompts/NOTIFY-2c.md`
**Branch:** `staging`. Commit only — never push.
**Today:** 2026-09-20.

Read `/Users/garythomas/Claude_Projects/Froot/froot/CLAUDE.md` first. One
command at a time, no `&&`, never `git add -A`, `npm run build` gates every
commit. Report every `prisma` command verbatim.

---

## Why this session exists

Gary's ruling, 2026-09-20: an ADMIN decides, per user, which of Froot's
emails that user receives, from the Edit User dialog on `/users` — the
same place they decide what the user can do. This is NOT self-service
opt-out (ruled out earlier today and still ruled out): only admins set
it, on the user's row. Today the only user-addressed email is the
behind-pace alert (F-5: every ADMIN + the store's assigned MANAGERs).
More are planned. The grid must make each new email one line to add.

Rulings already made:
- Role-based recipients remain the default. Pace alerts: ADMIN and
  assigned MANAGER receive by default; STAFF never.
- The org-level toggle and threshold (`/settings/notifications`) are
  unchanged and sit above per-user control: org off → nobody, regardless
  of user settings.
- HR acknowledgment emails are NOT user-addressed (they go to typed
  addresses) and do not appear in the grid.
- No user-facing "unsubscribe" anywhere.

## Phase 1 — Audit (brief; report before building)

1. **The capability model.** `src/lib/permissions.ts`: how capabilities
   are declared (key, label, section, role defaults, grantable/deniable),
   how `can()` resolves role default + `grantedCapabilities` +
   `deniedCapabilities`, and how the `/users` Edit User grid renders
   sections. Report whether a capability can be declared as
   "deniable but not grantable beyond role" — pace alerts should not be
   grantable to STAFF.
2. **The grid.** `/users` page + Edit User dialog: where sections come
   from (a static list? derived from the declarations?), and the route
   that saves overrides (`PUT /api/users/[id]` or similar). Report
   file:line.
3. **The recipient query.** `src/lib/pace-alerts.ts:91-98` selects by
   role + assignment. Report how to add "and not denied" — an `array`
   filter on `deniedCapabilities` in the same query, or a post-filter
   through `can()` (which one keeps a single query and stays correct if
   `can()` has precedence rules the SQL can't express).
4. **Naming.** Propose the key namespace (`notify.paceAlerts`, or the
   file's convention) and the grid section label ("Email notifications").

**Forks — report with your lean; proceed on the lean unless flagged:**

- **F1 — Model.** Notification entries as capabilities in the existing
  arrays (lean, no schema) vs a dedicated `notificationPrefs` JSON/array
  column (only if F1's audit shows capabilities can't express
  "deniable, not grantable"). If the latter, STOP.
- **F2 — Filter placement.** In the Prisma query vs post-filter via
  `can()`. Lean: whichever finding 3 says is correct; correctness over
  one-query elegance.
- **F3 — What an unticked admin sees.** Nothing else changes — they
  keep every other admin power; only the email stops. Confirm the grid
  copy says exactly that.

## Phase 2 — Build

**Declaration.** One new capability: key per finding 4, section "Email
notifications", label "Receives behind-pace alert emails", help "Sent
when a store they manage falls behind its month-to-date goal. Admins
receive alerts for every store." Role default: ADMIN true, MANAGER true
(assignment still gates which stores), STAFF false and not grantable.
Deniable for ADMIN and MANAGER.

**Grid.** The section renders from the declaration like the others; no
special-casing. Unticking writes to `deniedCapabilities` through the
existing route. Re-ticking removes the denial.

**Recipient query.** Per F2. A denied user is excluded before the
`PaceAlertLog.recipients` array is written, so the log reflects who was
actually mailed.

**`/settings/notifications`.** The "Recipients:" line under pace alerts
becomes: "Sent to every admin and the store's assigned managers. Turn
this off for an individual user from their row on the Users page."
Link "Users page" to `/users`.

**Fixture.** `scripts/verify-f5-polish.ts` gains: an ADMIN with the
capability denied is not in the recipient list and not in
`PaceAlertLog.recipients`; a MANAGER denied likewise; a STAFF cannot be
granted it (the grant is rejected or ignored — assert whichever the
model does and say which). Report the count.

**Docs.** `docs/PERMISSIONS.md` (or wherever the capability catalogue
lives): the new section and the rule that notification capabilities are
deniable-only. `docs/FORECASTING.md`: recipient rule gains the per-user
denial.

## Phase 3 — Commit (two-commit pattern)

Commit 1: declaration, grid (if any change needed), query, settings copy,
fixture.
`feat(NOTIFY-2c): per-user email controls in Edit User; pace alerts honour deniedCapabilities`

Commit 2 (cites 1):
- `docs/ROADMAP.yaml`: new row NOTIFY-2c (`in_progress`, commits, F1–F3).
  NOTIFY-2b's `open:` unchanged. Add a line to the standing rulings on
  NOTIFY-2a's row: per-user control is admin-set, never self-service.
- `docs/DECISIONS.md`: NOTIFY-2c heading; the distinction between
  admin-set per-user control (allowed) and self-service opt-out (still
  ruled out); F1–F3.
- `docs/prompts/NOTIFY-2c.md`.
`docs(NOTIFY-2c): row, rulings — admin-set per-user email control (work <SHA>)`

## Staging verification (Gary)

1. Push. `/users` → Edit User on an ADMIN → new "Email notifications"
   section with the pace-alert row ticked. Untick, save, reopen: still
   unticked. Re-tick, save, reopen: ticked.
2. Same on a MANAGER. On a STAFF user the row is absent or locked with
   "Not granted by this role".
3. `/settings/notifications`: the Recipients line has the new sentence
   and the Users link works.
4. Pace toggle stays OFF. No cron on staging; the fixture is the
   recipient proof.

## Report

1. Findings 1–4 with file:line; F1–F3 as taken.
2. Both SHAs; fixture count; `npm run build`.
3. Prisma commands run.

## Out of scope

- Any new email. Any HR-email change. Self-service settings for staff.
- Digest, threshold, toggle (2a). Template (2b).
