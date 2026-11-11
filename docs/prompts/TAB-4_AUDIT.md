# TAB-4 audit — per-person PIN on shared tablets

**TIER 3** (declared by the prompt; schema change, new verification route, change to what a
shared login may record). Audit-only so far: no file outside this one has been touched, no
migration generated, no prisma command run.

Written 2026-11-10 by the TAB-4 session, at `staging` = `origin/staging` = `f3e5695`,
`main` = `8417fc3`. All findings are from reading code at that commit. **No database was
queried**, so no row counts appear here and no branch label is needed.

Everything in § 3 is the planning chat's recommendation plus this audit's adjustments. **None
of it is a ruling.** Gary's answers go in the DECISIONS entry, quoted, after he gives them.

---

## 0. Repo gate — passed

```
git rev-parse --show-toplevel  → /Users/garythomas/Claude_Projects/Froot/froot
branch                         → staging
origin/staging                 → f3e5695  (contains f3e5695: yes)
main / origin/main             → 8417fc3
git status --porcelain         → ?? docs/prompts/TAB-4.md   (expected, left unstaged)

f3e5695 docs(PROMOTE): TAB-3 migration confirmed applied on production (8417fc3)
28c38ec docs(PROMOTE): TAB-1→TAB-9 shipped in merge 8417fc3
8417fc3 Merge branch 'staging'
1a0424d docs(TAB-9) PRE-PUSH-CHECK: entry ratified, prompt of record, DEPLOY_LOG entry, status -> staging
5da4897 fix(TAB-9): HR chip hidden on STORE logins, no labor dollars, idle scroll-to-top, rollover never blocked by scroll (fixes 44b80c5)
```

---

## THE HEADLINE FINDING — "Tablet mode" is not something the server can enforce on

Read this before § 3, because it changes leans 2 and 8.

**Tablet mode is a per-device cookie that any user can flip with one tap.**

- `src/lib/view-mode.ts:14` — `VIEW_COOKIE = "froot_view"`; anything but the literal
  `"tablet"` is desktop.
- `src/components/layout/view-switch.tsx:9-15` — "Every role sees it (it changes how this
  device draws Froot, never what anyone may see or do)". The switch writes the cookie with
  `document.cookie` and refreshes. It is in the desktop sidebar footer
  (`sidebar.tsx:645`) and the tablet rail (`tablet-shell.tsx:162`).
- `src/app/(app)/dashboard/page.tsx:131` — the only thing the cookie decides is which
  dashboard renders.

The task-log route *could* read that cookie (a same-origin `fetch` sends it). But a rule of
the form "refuse a **Tablet-mode** tick without a PIN token" is bypassed like this: tap
**Desktop** on the same iPad → open the checklist from store-view → the desktop "Who completed
this task?" picker posts to the **same** `POST /api/checklists/[id]/task-log` with any name and
no token. A hand-made request without the cookie does the same.

So lean 8 as written is a UI gate with extra steps, which is exactly what the prompt says it
must not be (§ 2 point 2: "actually enforced, not just a UI gate").

**What the server CAN know, and nobody can flip: the login's ROLE.** `Role` is
`ADMIN | MANAGER | STAFF | STORE` (`prisma/schema.prisma`, `enum Role`). STORE accounts are
the shared iPad logins — `permissions.ts:464` and `:602` say so in as many words, and TAB-9
already keys the tablet HR chip on it (`tablet-home.tsx:1596`, `src/lib/tablet-cards.ts:182`).
A personal login is already accountable without a PIN: every TaskLog row stamps
`completedByUserId` with the login (`task-log/route.ts:158`).

So the enforceable version of the lean's intent ("desktop is usually a personal login") is:
**the PIN requirement applies to ticks made by a STORE login, in either view.** Personal logins
(ADMIN / MANAGER / STAFF) are unchanged in both views. The cost: on a STORE login the desktop
execution page also needs the PIN step, which contradicts "the desktop picker is unchanged"
(lean 2, prompt § 2 point 8). This is put to Gary as **Q2** below.

---

## 1. Staff model

**The record** — `StaffMember` (`prisma/schema.prisma`):
`id, organizationId, squareTeamMemberId?, displayName, fullName?, fullNameLocked,
squareFullName?, email?, status ("ACTIVE" | "TERMINATED"), terminatedAt?, userId? @unique,
signingCycle, rehiredAt?, isCorporate, startDate?, startDateManual, squareStartDate?,
milestoneEligible, createdAt`. Store membership is `StoreStaffAssignment`
(`staffMemberId, storeId, isPrimary`). **Nothing about a PIN, a secret, or failed attempts
exists today.**

**Who has a login.** A staff member has their own login only when `StaffMember.userId` links
to a `User` row (or HR's `resolveSelfStaff` matches them by email — `src/lib/hr.ts`, used by
`getActiveStaffSelf`, `src/lib/auth.ts:197`). Square-imported staff have no `userId` until
someone invites them (`api/staff/[id]/invite`). On a juice-bar counter most shift staff are
expected to be in the no-login group — not measured here; no DB was queried.

**How the picker's list is built** — identical query on both surfaces:

| Surface | File | Filter |
|---|---|---|
| Desktop picker | `store-view/checklist/[id]/page.tsx:60` | `organizationId`, `status: "ACTIVE"`, assigned to the checklist's store, `displayName asc` |
| Tablet name sheet | `dashboard/tablet-data.ts:143` | same, one query for every store the login sees, split per store (`staffFor`, :154) |

The generic options are not rows: the client prepends "Team Member" and "Manager"
(`tablet-home.tsx:59-60`; desktop `checklist-execution-client.tsx:597-603`). **Both send the
literal `"manager"`**, which the server saves as **no name** (`task-log-staff.ts:35`).

Small pre-existing mismatch (not TAB-4's to fix): the server also accepts an `isCorporate`
staff member who is **not** assigned to the store (`task-log-staff.ts:56`), but neither picker
lists them, so that acceptance path is reachable only by a hand-made request.

---

## 2. Task-log write path

`POST /api/checklists/[id]/task-log` (`src/app/api/checklists/[id]/task-log/route.ts`), in order:

1. Clerk `orgId` → org row (:9-14).
2. Checklist by `id` + `organizationId` (:16).
3. Store scope: non-ADMIN must hold the store (`getUserStoreScope`, :30).
4. 409 if the day has closed (:40).
5. Task belongs to this checklist (CHK-3 / TPL-3, :61).
6. Existing log read (:73). **Ticks only:** `resolveTaskLogStaff` (:80-88).
7. Pending → In Progress + sections snapshot (:91).
8. Toggle: delete if it existed (un-tick, never refused), else create (:133-164) with
   `completedByUserId` = the login and `completedByStaffId` = the resolved id.

**How `completedByStaffId` is validated today** — `src/lib/task-log-staff.ts` (CHK-15):
null / `""` / `"manager"` → saved as null, **never refused** ("nobody is ever blocked from
completing a task", :11-13); non-string → refused; must be **in this org**, **ACTIVE**, and
**assigned to the checklist's store or `isCorporate`**. The cross-org refusal deliberately
reads the same as "doesn't exist" (:19-21). So yes — it checks org **and** store, since
CHK-15 (Gary 2026-10-17). It does **not** check that the person is physically present; nothing
can today.

**Where a proof check must sit to be real:** inside this route, on the tick branch, **after**
`resolveTaskLogStaff` succeeds and **before** the Pending → In Progress write (so a refused
first tick leaves the checklist untouched — the same placement CHK-15 chose and documents at
:75-78). Untick stays un-gated. The natural home is a second helper beside
`resolveTaskLogStaff`, called from the route, so the rule has one definition.

**Every caller of this route** (enumerated per CLAUDE.md § Verifying a guard covers every path —
searched for `task-log` across `src/`, not for a guard name):

- `src/app/(app)/dashboard/tablet-home.tsx:787-791` — tablet tick.
- `src/app/(app)/store-view/checklist/[id]/checklist-execution-client.tsx:262-268` — desktop tick.
- (`upload/checklist-photo/route.ts` and `submit/route.ts` mention it in comments only; neither
  writes a TaskLog name.)

Two callers, one route — so a server rule in the route covers both views, which is exactly why
the rule must be keyed on something both views share and nobody can flip (the role), not on the
view.

**The other route that names a completer** — `POST /api/calendar/occurrences/[id]/complete`
(`route.ts:111-118`) accepts `completedByStaffId` with an **org check only** (no ACTIVE, no
store check — it predates CHK-15's tightening). The tablet's due list sends `{}`
(`tablet-home.tsx:1518-1522`), so tablet calendar completions are already anonymous and TAB-4
does not touch them. Noted in § 5 triage.

---

## 3. Secrets and hashing without a new dependency

**Already in use:** Node's built-in `crypto` only — `createHash` (HR forms, signed PDFs, blob
files), `randomBytes` (Square OAuth state, blob paths), `randomUUID`, and
`createHmac` + `timingSafeEqual` in `src/lib/square-webhook.ts:14,26` (the one existing HMAC
verifier — the pattern to copy). `package.json` has no bcrypt / argon / jose / jsonwebtoken.
`crypto.scrypt` is available with no install. **No new dependency is needed for any lean.**

**Hash format (proposal):** `scrypt$<N>$<r>$<p>$<salt b64>$<hash b64>` in one nullable text
column, 16-byte random salt, `timingSafeEqual` on compare. Encoding the parameters lets them be
raised later without a migration.

**An honest limit on what hashing buys for a 4-digit PIN.** There are 10,000 PINs. If the
database leaked, a salted scrypt hash of a 4-digit PIN falls to brute force in seconds — the
salt stops precomputed tables, not a 10,000-try loop. Hashing guarantees nobody *reads* a PIN
off a row or a screen; it does not protect a stolen database. The **lockout** is the real
defence. A cheap improvement with no dependency: mix a server-side secret ("pepper") into the
hash input, so the database alone is not enough. Put to Gary as part of **Q4**.

**Which secret can sign the short-lived token.** Env vars the app reads today (from
`process.env.*` across `src/`): `CRON_SECRET`, `CLERK_WEBHOOK_SECRET`,
`SQUARE_APPLICATION_SECRET`, `SQUARE_WEBHOOK_SIGNATURE_KEY`, `RESEND_WEBHOOK_SECRET`,
`INSTAGRAM_APP_SECRET`, `ANTHROPIC_API_KEY`, blob tokens. `CLERK_SECRET_KEY` is read by the
Clerk SDK, not by our code.

- **`CRON_SECRET` — no.** It is presented by hand, so it has a rotation ritual
  (CLAUDE.md § Provisioning a secret…). Coupling PIN tokens to it means every cron-secret
  rotation also has to be thought about here.
- **Any third-party secret (Square, Instagram, Resend, Clerk webhook) — no.** Rotating those
  belongs to their own integrations.
- **`CLERK_SECRET_KEY`, domain-separated (HMAC it with a fixed label first) — works with no
  new env var.** Weakness: the Clerk **dev** instance is shared by local and staging (memory
  note), so local and staging would share the signing key. Low risk (tokens last ~10 minutes
  and bind real row ids), but not clean.
- **A dedicated new env var, e.g. `TABLET_PIN_SECRET` — recommended.** Preview + Production in
  Vercel, local `.env` by hand. It is never typed by a human, so the password-manager rule does
  not bite, and losing it costs nothing but ten minutes of tokens. **If it is missing, the PIN
  routes answer 503 and the setting cannot be switched on** (fail closed, the N-1c
  `ANTHROPIC_API_KEY` precedent). This is a Vercel provisioning step for Gary, not a dependency.

**Token shape (proposal):** `base64url(payload).base64url(HMAC-SHA256(payload))`, payload
`{ staffId, storeId, orgId, userId (the logged-in User), exp }`. Binding the **login** as well
as the staff member and store means a token cannot be lifted off one device's session and
replayed from another login. Held in React state only — never localStorage — so a reload
drops it, the same as the chip today. Not stored server-side; expiry is the only revocation.

---

## 4. Rate limiting

**There is no lockout pattern anywhere.** No `lockedUntil`, `failedAttempts` or similar column
in the schema. (`lockout`/`rate limit` hits in `src/` are Clerk restricted mode, Instagram's
rate limit, Square cron backoff and the label reader — none is a per-person attempt counter.)

**The closest precedent is N-1c's label-read limit** — `src/lib/label-read-run.ts:11-46`:
"30 reads/hour and 300/day per org **via audit rows**", counted from `AuditLog` so it holds
across serverless instances. That suggests a zero-schema lockout, but it has two flaws for this
job:

- `writeAuditLog` **swallows insert failures** (`src/lib/audit.ts:34-48`, by design — "writes
  NEVER block the user action"). A failed insert would under-count, so the lockout would **fail
  open**. Fine for a spend limit; wrong for a security counter.
- It writes a row **per wrong PIN**, which is more audit noise than lean 9 describes.

**Smallest schema that does it properly** — two columns on `StaffMember`, added in the same
migration as the PIN hash:

```
pinFailedAttempts Int       @default(0)
pinLockedUntil    DateTime?
```

Wrong PIN → atomic `updateMany … increment`; on reaching 5, set `pinLockedUntil = now + 5 min`,
reset the counter, write **one** `staff.pin.lockout` AuditLog row. Right PIN → reset the counter.
A check while `pinLockedUntil > now` refuses without comparing the PIN (so it reveals nothing).

**Full proposed schema change** (all additive, nullable or defaulted, no backfill — every
existing row lands "no PIN, setting off"):

```
StaffMember.pinHash           String?
StaffMember.pinSetAt          DateTime?
StaffMember.pinFailedAttempts Int       @default(0)
StaffMember.pinLockedUntil    DateTime?
Organization.tabletPinRequired Boolean  @default(false)   // name to be confirmed
```

The org flag follows the `calendarEnabled` / `milestonesEnabled` pattern — a dedicated column,
**not** an `activeModules` entry (that list is the billable add-ons; schema comments at
`Organization.calendarEnabled` explain why).

**Strength, stated plainly so the 5/5 numbers are a choice, not an accident.** 5 tries per
5 minutes is up to 1,440 guesses a day per name — on average a 4-digit PIN falls in about 3½
days of non-stop guessing at the counter, every lockout leaving an AuditLog row. An optional
escalation (for example: 3 lockouts in a day → locked until a manager resets the PIN) would
close that. Not in the leans; offered as a sub-question of **Q9**.

---

## 5. Where a PIN would be set

**`/staff/[id]`** — the staff profile (`src/app/(app)/staff/[id]/page.tsx`, with
`staff-edit-actions.tsx`). Its writes go through `PATCH /api/staff/[id]`
(`src/app/api/staff/[id]/route.ts:32-58`): `can(actor, "staff.manage")` (`MANAGE` =
ADMIN + MANAGER, `permissions.ts:178,248`), then **ADMIN org-wide, MANAGER only for a staff
member already assigned to one of their stores** (:55), cross-org or out-of-scope → 404. That
is exactly lean 5's "ADMIN, and MANAGER for staff in their own stores". A PIN set/reset belongs
in its **own** route (e.g. `POST /api/staff/[id]/pin`) with the **same** two gates, rather than a
new field on the generic PATCH — so a PIN can never ride along with a name edit, and its audit
row is unambiguous. `staff.manage` is deniable per user (PERM-5 `deniedCapabilities`), which
would also remove PIN reset — consistent.

**One gap in that gate for this use.** A MANAGER can reset the PIN of *any* staff member in
their store — including the staff record linked to an **ADMIN** or another MANAGER — and then
tick as that person. Whether a reset of a higher-or-equal role's record should need ADMIN is
put to Gary inside **Q5**.

**`/my`** — `src/app/(my)/my/page.tsx:32` calls `getActiveStaffSelf()`, which returns
`unavailable` unless **`hrModuleAvailable()` and `activeModules` includes `"hr"`**
(`src/lib/auth.ts:197-206`). **So `/my` exists only for orgs with HR on, and only for staff who
have their own login and resolve to a StaffMember.** A "change my own PIN" control there would
reach nobody in an org without HR, and none of the no-login shift staff in any org. Put to Gary
inside **Q5**.

**PERM-8 / `grantedCapabilities`.** `GRANTABLE_CAPABILITIES` today holds one entry
(`staff.import.square` for MANAGER, `permissions.ts:515-620`); STORE and STAFF are excluded
from grants by name. No capability touches PINs. **Who can set or reset a PIN today: nobody — no
PIN exists.** Using `staff.manage` adds no new capability row; a dedicated `staff.pin.manage`
row would let an ADMIN deny PIN resets to one manager without denying staff edits. The audit's
lean is to reuse `staff.manage` (smaller, and matches the prompt's lean 5); flagged in **Q5**.

---

## 6. Settings home

Org feature switches live on **`/settings`** (`src/app/(app)/settings/page.tsx`) as their own
cards — Calendar (:321, `calendar-actions.tsx` → `POST /api/calendar/toggle`), Staff
Milestones (:368), etc. — behind `settings.access` (ADMIN_ONLY, not grantable,
`settings/page.tsx:26`). **`/settings/display`** has a Tablet tab, but it is about which cards
show and in what order (`settings/display/page.tsx:10-17`), not who may do what.

**Recommendation:** a new "Shared tablets" card on `/settings` (beside Display Settings), with a
`Switch` and its own ADMIN-only toggle route on the `/api/calendar/toggle` pattern. Turning it on
is refused (409 with a sentence) if the signing secret is missing. Toggle on/off writes an
AuditLog row.

---

## 7. Audit logging

**Yes — no schema change needed.** `AuditLog` is `organizationId, userId? (Clerk user id),
action (free text), entityType (free text), entityId?, metadata Json?, createdAt`, indexed on
`[organizationId, entityType, createdAt]`; written through `writeAuditLog`
(`src/lib/audit.ts:34`). Proposed rows:

| Event | action | entityType / entityId | metadata |
|---|---|---|---|
| PIN set (first time) | `staff.pin.set` | `StaffMember` / staff id | `{ by: "admin"\|"manager"\|"self" }` |
| PIN reset | `staff.pin.reset` | `StaffMember` / staff id | `{ by }` |
| Lockout | `staff.pin.lockout` | `StaffMember` / staff id | `{ storeId, attempts: 5, until }` |
| Setting on/off | `org.tablet_pin_required` | `Organization` / org id | `{ before, after }` |

`userId` is the acting login's Clerk id (on a lockout, the STORE login at the counter).
Successful checks write nothing (lean 9). Because `writeAuditLog` swallows failures, these rows
are a record, not an enforcement mechanism — enforcement is the columns in § 4.

---

## 8. Desktop picker — confirmed path

- List: `src/app/(app)/store-view/checklist/[id]/page.tsx:57-67` (same filter as the tablet).
- UI: `checklist-execution-client.tsx:593-603` — "Who completed this task?", "Team Member" and
  "Manager" both `selectStaff(task.id, "manager")`.
- Write: `logTask()` at `checklist-execution-client.tsx:262-268` → the **same**
  `POST /api/checklists/[id]/task-log`, body `{ taskId, completedByStaffId, photoUrl }`.

It can be left **completely unchanged only if** the server rule is keyed on something the
desktop view never meets. Under Q2's recommended answer (STORE logins), it is unchanged for
every personal login and **gains the PIN step on STORE logins only**. Under the cookie answer it
is unchanged, and it is also the bypass.

---

## 9. Other facts the build will need

- **The number pad.** `ValueSheet` (`tablet-home.tsx:1410-1460`) has `±`, `.`, a 6-character
  cap and a `°F` suffix. "Reuse" means lifting its key grid into a small shared pad with a
  digits-only, masked (●●●●) mode — not reusing `ValueSheet` as is.
- **The chip does NOT clear on idle today.** `person` state lives in `TasksPanel`
  (`tablet-home.tsx:628`), keyed by `store:day` (:574); it clears on submit, partial submit,
  checklist change (:985) and reload. The TAB-9 idle timer (:356-374) collapses cards but does
  not reach `person`. Lean 10 is new behaviour and needs the idle signal passed into the panel.
- **Lean 7 reverses a stated CHK-15 principle on this surface.** `task-log-staff.ts:11-13`:
  "Team Member … saves null and is **never refused** — nobody is ever blocked from completing a
  task." Hiding the generic options is only a UI gate unless the server also refuses a null name
  from a STORE login while the setting is on. With both, a store whose staff have no PINs yet
  **cannot tick anything** on its iPad until a manager sets PINs. Put to Gary as **Q7**.
- **Staff with no login can only ever get a PIN from a manager or admin** — which makes lean 6
  ("No PIN — ask a manager") the normal first-day state for most of a store, not an edge case.

---

## 10. Questions for Gary (the leans, adjusted by this audit)

Each is a recommendation. Answer yes / no / pick, or in your own words.

- **Q1 — Off by default, per org.** New org switch "Require a PIN on shared tablets", default
  off; nothing changes until an ADMIN turns it on. *Lean: yes.*
- **Q2 — What the PIN applies to. (Changed by the headline finding.)**
  (a) **Ticks made by a STORE login, in either view** — enforceable; personal logins unchanged
  everywhere; desktop execution page gains the PIN step on STORE logins only. *Lean.*
  (b) Ticks made while the device is in Tablet mode — matches the original lean, but anyone can
  tap Desktop and skip it, so it is a UI gate.
  (c) Every tick in the org, any login.
- **Q3 — The flow.** First tick → name sheet → name → PIN pad (digits-only version of the TAB-1
  pad) → verified → "Completing as …" chip; later ticks ride the chip. *Lean: yes.*
- **Q4 — The PIN.** 4 digits, salted `scrypt`, never shown back. Sub-question: also mix in a
  server secret ("pepper") so a leaked database alone can't reveal PINs? *Lean: yes, and yes.*
- **Q5 — Who sets it.**
  (i) ADMIN, and MANAGER for staff in their own stores, set/reset on `/staff/[id]` (reusing
  `staff.manage`, no new capability row). *Lean: yes.*
  (ii) Should resetting the PIN of a staff record linked to an ADMIN (or another MANAGER) need an
  ADMIN? *Lean: yes, ADMIN only for those.*
  (iii) Self-change on `/my` — note `/my` only exists in orgs with HR on, and only for staff with
  their own login. Build it in v1 anyway, or leave it out of v1? *Lean: leave it out of v1;
  managers set PINs.*
  (iv) A reset forces a new PIN; nobody can see an existing one. *Lean: yes.*
- **Q6 — Staff without a PIN while required.** Greyed out, "No PIN — ask a manager", can't be
  picked. *Lean: yes.*
- **Q7 — Generic options while required.** Hide "Team Member" / "Manager" **and** have the
  server refuse an unnamed tick from a STORE login — knowing that until PINs are set, that iPad
  can't tick anything. *Lean: yes, both halves.* (Alternative: hide them but still accept unnamed
  ticks server-side.)
- **Q8 — Real enforcement.** A correct PIN returns a signed token (~10 min) bound to staff
  member, store, org and the login; while the setting is on the task-log route refuses a STORE
  login's tick without a valid token for that `completedByStaffId`. Tokens expire; never stored.
  Signing secret: a **new env var `TABLET_PIN_SECRET`** (you add it in Vercel, Preview +
  Production), with the feature refusing to switch on if it's missing — or derive it from the
  Clerk secret key with no new env var? *Lean: yes; new env var.*
- **Q9 — Lockout.** 5 wrong PINs for one name → locked 5 minutes, one AuditLog row per lockout,
  successes write nothing, set/reset write a row; counted in two new StaffMember columns, not in
  AuditLog. Sub-question: add escalation (e.g. 3 lockouts in a day → locked until a manager
  resets)? *Lean: yes to the base; no escalation in v1.*
- **Q10 — Chip timeout.** The chip (and its token) also clear after the 5-minute TAB-9 idle.
  *Lean: yes.*
- **Q11 — Messages unchanged.** Tablet messages still post as the logged-in account; a PIN on
  messages is a separate row. *Lean: yes.*

---

## 11. Triage of findings not fixed by this session

| # | Finding | Sort |
|---|---|---|
| 1 | Tablet mode is a client cookie; a view-keyed PIN rule is bypassable | **RULING NOW** — Q2 |
| 2 | Lean 7 reverses CHK-15's "never blocked" on STORE logins | **RULING NOW** — Q7 |
| 3 | `/my` is HR-gated, so self-service PIN change reaches few people | **RULING NOW** — Q5 (iii) |
| 4 | MANAGER can reset the PIN on an ADMIN-linked staff record | **RULING NOW** — Q5 (ii) |
| 5 | AuditLog-counted lockout would fail open | **RULING NOW** — folded into Q9 (columns instead) |
| 6 | Calendar complete route checks org only, not ACTIVE / store (pre-CHK-15) | **COMMENT** — tablet sends no name there; not TAB-4's scope. Mention in the build report; a ROW only if Gary wants it |
| 7 | Server accepts an unassigned `isCorporate` staff id the pickers never list | **COMMENT** — pre-existing, by CHK-15 design, harmless |

Counts: FIX NOW 0 · RULING NOW 5 · COMMENT 2 · ROW 0.

---

## 12. What happens next

Nothing is built. No migration exists. On Gary's answers the session builds exactly what he
rules (prompt § 4), generates the migration with `prisma migrate diff` only, and **stops** for
him to apply it to dev before any commit (CLAUDE.md § A migration STOPS the session).

Prisma commands run in this session so far: **none.**
