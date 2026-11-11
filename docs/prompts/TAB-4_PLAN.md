# TAB-4 plan — per-person PIN on shared tablets

**TIER 3.** Written 2026-11-10 after Gary's rulings (pasted in chat the same day) and before
any build. Companion to `docs/prompts/TAB-4_AUDIT.md`, which stays as written. Gary's Q7 asked
for the exact routes **before building**, so this file lists them and the session stops for his
go-ahead.

At `staging` = `f3e5695`. Nothing built, no migration, no prisma command run.

The rulings are quoted in the DRAFT DECISIONS entry at docs-commit time, in Gary's words.
Where this plan makes a design choice he did not rule on, it says **(design choice)** so it can
be overridden.

---

## 1. The gate in one sentence

While the org switch is on, **any write that records a person, made by a STORE login, in
either view**, must carry (a) a real staff member who passes the CHK-15 rules and (b) a valid
PIN token for exactly that staff member, store, org and login. Otherwise it is refused with a
sentence. Personal logins (ADMIN / MANAGER / STAFF) are never asked.

If the switch is on and either env var is missing, every such write is **refused** (503, "PINs
aren't set up in this environment — ask an admin"). It never falls through to "no check".

---

## 2. Routes — the exact list (Q7)

Found by listing every Prisma relation that points at `StaffMember` (14 relations on 12
models), then every API route that takes a staff id in its body, then checking each route's
role gate. Not by searching for a guard name.

### 2a. GATED — the PIN token is checked here

| Route | What changes |
|---|---|
| `POST /api/checklists/[id]/task-log` | **Tick branch only.** After `resolveTaskLogStaff` succeeds, before the Pending → In Progress write: if the gate applies, refuse a null name ("Team Member" / "Manager" send `"manager"` → null) and refuse a missing/invalid/mismatched token. Success returns a fresh 10-minute token (Q8 sliding). |
| `POST /api/calendar/occurrences/[id]/complete` | Same gate, store = the occurrence's `storeId`. **Plus CHK-15 parity for every login** (Q7): the staff check moves from "in the org" (`route.ts:111-118`) to `resolveTaskLogStaff` — in the org, ACTIVE, assigned to the store or `isCorporate`. Success returns a fresh token. |

### 2b. NEW routes

| Route | Who | Does |
|---|---|---|
| `POST /api/tablet-pin/verify` | Any signed-in login with the store in scope (in practice the STORE login) | Body `{ staffId, storeId, pin }`. Checks CHK-15 rules, lock, PIN. Right → token. Wrong → count; 5th wrong → lock 5 min + one AuditLog row. Locked → refuse without comparing. Same refusal for "no such person" and "not in this store", so it leaks nothing. |
| `PUT /api/staff/[id]/pin` | ADMIN: anyone. MANAGER: staff in their stores **and their own record**, but **not** a staff record linked to another MANAGER or an ADMIN (Q5 ii). | Body `{ pin }` (4 digits). Sets or resets; clears the counter and lock; AuditLog `staff.pin.set` / `staff.pin.reset`. Returns `{ hasPin: true }` only. |
| `POST /api/settings/tablet-pin` | ADMIN (`settings.access`) | Turns the switch on/off; refuses **on** with 409 if either env var is missing. AuditLog row. Calendar toggle pattern. |

"Linked to a MANAGER or ADMIN" = `StaffMember.userId` → `User.role` in this org. A staff record
with no login is ordinary staff. "Own record" = the MANAGER's own staff record
(`StaffMember.userId` = their user id).

### 2c. NOT gated — and why

| Route | Why it is out |
|---|---|
| `task-log` **un-tick** | Deletes a row and records nobody. CHK-15: an un-tick is never refused. |
| `POST /api/checklists/[id]/submit` | **Records no person.** `Checklist` has no completedBy column; on a calendar-backed checklist it stamps the occurrence's `completedByUserId` (the login) and leaves `completedByStaffId` null (`submit/route.ts:147-153`). Gary's Q7: "checklist submit if it records a person" — it doesn't. |
| `POST /api/messages` (`authorStaffId`) and `checklists/[id]/handoff-messages` | Q11: "Messages are unchanged." (handoff messages take no staff id at all.) |
| `POST /api/upload/checklist-photo` | Writes a blob only; the person lands through task-log, which is gated. |
| HR: `hr/documents/[id]/acknowledgments`, `hr/documents/[id]/signed-record`, `hr/forms/[id]/submissions`, `hr/returns`, `hr/training/assignments` (+ `bulk`), `hr/training/assignments/[id]/lessons/[lessonId]`, `hr/documents/[id]/audience` | A STORE login can't record a person through any of them: each refuses anyone but ADMIN/MANAGER when acting for someone else (`acknowledgments:91`, `signed-record:82`, `forms/submissions:57`, `returns:34`, training via `requireHrTrainingManageAccess` = ADMIN/MANAGER, `access.ts:129-130`). Audience is document configuration, not a record of who did something. |
| `/api/my/training/.../lessons/[lessonId]` | Self only — the login is the person. |
| `PATCH /api/staff/[id]` and other staff admin | Edits a staff record; STORE is not in `staff.manage`. |

### 2d. Screens that call a gated route (every renderer)

| Screen | Calls | Change for a STORE login with the switch on |
|---|---|---|
| Tablet Tasks panel (`dashboard/tablet-home.tsx`) | task-log | Name sheet hides the two generic options; no-PIN names greyed "No PIN — ask a manager"; tap a name → PIN pad → chip. Token rides the chip, swapped on every save. |
| Tablet due list (`tablet-home.tsx:1516`) | calendar complete | Today sends `{}`. Gains name sheet + PIN before Complete. **(design choice)** It reuses a token already held for that store if one is live; otherwise asks. |
| Desktop execution page (`store-view/checklist/[id]/checklist-execution-client.tsx`) | task-log | Per-task picker hides the generics, greys no-PIN names; picking a name with no live token for that person opens the PIN pad. |
| Desktop due banner (`components/calendar-due-banner.tsx:198`) | calendar complete | Today sends `{}`. Gains the same name + PIN step. |
| Calendar occurrence detail (`calendar/occurrence-detail.tsx:123`) | calendar complete | Its existing staff picker gets the same rules + PIN step. |

All five use one shared piece: a name list that knows `hasPin`, a digits-only masked PIN pad
(lifted from the TAB-1 `ValueSheet` key grid), and a small hook holding `{ staffId, storeId,
token }` in memory only. Nothing goes in localStorage; a reload drops it.

**Q10 idle clear.** The tablet chip and its token clear on the TAB-9 5-minute idle.
**(design choice)** The three desktop screens also drop a held token after 5 minutes without a
touch, since it is the same shared device; the token would expire at 10 minutes anyway.

Personal logins, and every login while the switch is off, see exactly today's screens.

---

## 3. Schema (one migration, all additive)

```
StaffMember.pinHash            String?
StaffMember.pinSetAt           DateTime?
StaffMember.pinFailedAttempts  Int       @default(0)
StaffMember.pinLockedUntil     DateTime?
Organization.tabletPinRequired Boolean   @default(false)
```

No backfill: every org lands off, every staff member lands with no PIN.
Generated with `npx prisma migrate diff --from-config-datasource --to-schema
prisma/schema.prisma --script -o prisma/migrations/<ts>_tab4_tablet_pin/migration.sql`, then
**STOP** for Gary to apply to dev. No commit before that and a green fixture.

## 4. Secrets (Q4)

- `TABLET_PIN_PEPPER` — mixed into the scrypt input. **Rotating it invalidates every PIN**; said
  in the code comment, in CLAUDE.md's env list and in DECISIONS.
- `TABLET_TOKEN_SECRET` — HMAC-SHA256 key for tokens. Rotating it only ends open sessions.
- Either missing → settings card says "not configured" and won't switch on; gated writes and
  `verify` refuse with a clear 503. Local `.env` gets throwaway dev values by hand (never pulled).

Hash string: `scrypt$N$r$p$salt$hash`, 16-byte salt, `timingSafeEqual`.
Token: `base64url(payload).base64url(hmac)`, payload `{ s: staffId, st: storeId, o: orgId,
u: userId, exp }`, 10 minutes, never stored.

## 5. Nobody ever sees a hash (Q5 iv)

The audit counted 22 unselected `prisma.staffMember` reads in `src/app/api`, any of which could
hand a full row to `NextResponse.json`. Rather than audit each, **the Prisma client omits
`pinHash` globally** (`omit: { staffMember: { pinHash: true } }` in `src/lib/prisma.ts`), and
only `src/lib/tablet-pin.ts` opts back in. Screens get `hasPin: boolean`, nothing else.
(`pinFailedAttempts` / `pinLockedUntil` are not secret; they stay readable.)

## 6. Lockout (Q9)

Wrong PIN → atomic increment. On the 5th: `pinLockedUntil = now + 5 min`, counter back to 0, one
`staff.pin.lockout` AuditLog row. While locked: refuse with "Too many tries — try again in N
minutes", no compare, no count. Lock expired → next attempt starts from a clean count. Right PIN
→ counter 0. Locks are per staff member, across stores (Gary: "lock that staff member").

## 7. Settings card (Q1, Q7)

New "Shared tablets" card on `/settings` (ADMIN). Switch, "not configured" state when an env
var is missing, and a readiness line per store: "University: 9 of 14 active staff have PINs".
Information only — it never blocks switching on.

## 8. `/staff/[id]`

A "PIN" row: "PIN set" / "No PIN" (never the PIN), and Set PIN / Reset PIN opening a 4-digit
entry entered twice. Shown only to a viewer the route would allow (§ 2b).

## 9. Fixtures

New `scripts/verify-tab4-pin.ts`: hash + verify; wrong PIN; pepper change breaks verify; lockout
on the 5th failure and unlock after the window (clock injected); counter reset on a right PIN;
token sign / verify / expiry; token for another staff member, store, org or login refused;
task-log refused without a token while on, accepted while off, accepted for a personal login
while on; unnamed STORE tick refused while on; calendar complete gated the same way and refusing
a terminated or unassigned name for everyone; generic options hidden while on; missing env var
refuses (never skips); PIN-set permission matrix (ADMIN / MANAGER own / MANAGER store staff /
MANAGER on another MANAGER / out-of-scope); no response carries `pinHash`.

Re-run at their current counts: `verify-chk15`, `verify-tab1-today`, `verify-tab1c-due-chip`,
`verify-tab2-messages`, `verify-tab3-layout`, `verify-tab5-refresh`, `verify-tab9-cards`.
Local check through a temporary mocked page under `/menu`, deleted before committing.

## 10. Commits (after Gary applies the migration and the fixture is green)

1. Work commit, including the migration.
2. Docs commit: ROADMAP TAB-4 → the built-not-yet-checked status (preserve and mark); new
   backlog row "email a manager on repeated lockouts", with the notifications work; DRAFT
   DECISIONS entry quoting Gary's rulings; MIGRATIONS.md entry; CLAUDE.md env list gains the two
   vars.

Committed, never pushed.

---

## Addendum — Gary's go-ahead, 2026-11-10 (appended; nothing above is edited)

Gary accepted the three design choices, with one condition on #1: the "Completing as …" chip
is visible on the tablet due list whenever a reused token is in play. He asked the session to
confirm the readiness line (§ 7), the backlog row (§ 10) and fail-closed writes when an env var
goes missing after the switch is on (§ 1, § 4) — all three were already in the plan.

Build requirements he added, which bind the build:

- **Atomic lockout.** One conditional `UPDATE … RETURNING` reserves the attempt *before* the
  compare (`pinFailedAttempts < 5`, not locked), so parallel tries cannot get past 5. The lock
  is set by a second conditional update that only one request can win.
- `crypto.timingSafeEqual` for both the token signature and the PIN hash.
- The token check verifies expiry, person, store, org and login — not just the signature.
- **The verify route is the only code that reads `pinHash`.** Everything else learns "has a
  PIN" from `pinSetAt` (written in the same update as the hash). Raw SQL is checked separately,
  since the global omit does not cover it.
- Fixtures additionally cover: a STORE login ticking from the Desktop view without a token is
  refused; A's token refused for B; an expired token refused; the 6th try locked out; a MANAGER
  can't reset an ADMIN's PIN; the switch refuses to turn on with a var missing; a tick fails
  closed with a var missing.
