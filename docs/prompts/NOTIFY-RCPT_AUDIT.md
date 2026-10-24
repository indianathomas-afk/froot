# NOTIFY-RCPT — Phase 1 audit

**TIER 3. Read-only. Written 2026-10-23 by the NOTIFY-RCPT audit session.**
Prompt: `docs/prompts/NOTIFY-RCPT.md`. Nothing was built and nothing was committed.
This file records what was believed when it was written. Do not edit it afterwards.

---

## 0. Headline

**Most of the draft target model already exists.** NOTIFY-6 (`docs/prompts/2026-10-18_NOTIFY-6_AUDIT.md`)
built an email-kind registry in code (`src/lib/notifications/registry.ts`) and a single
dispatcher (`src/lib/notifications/dispatch.ts`). Every email Froot sends goes through
that dispatcher. Recipients are already resolved in one function, `eligibleRecipients()`
at `dispatch.ts:393`. It runs the kind's resolver, then `can()`, then `exclude`, then a
lower-cased de-dup. Each recipient already gets their own message.

What NOTIFY-RCPT actually adds is narrower than the prompt's plan assumed:

1. A per-org, per-kind **extras layer** merged into `eligibleRecipients()`. The kinds' own
   resolvers stay as they are and become the "role default".
2. The **address book** table and the **picks** table.
3. Two new registry fields: a description of the role default for the UI, and whether a
   kind accepts extras.
4. A **reason** stamped on each recipient and recorded with the message.
5. The **hub UI**.

Build step 2 in the prompt says to "replace each consumer's own recipient code". There is
no per-consumer recipient code left to replace. Producers do not resolve recipients; the
kinds do, and only the dispatcher calls them. That step becomes "add the extras layer to
the one resolver".

**Five findings change the plan:**

- **A — hr.ack has no role default.** Its whole recipient list IS `hrAckRecipients`. Its org
  switch is "the list is non-empty" in two places: `kinds/hr-ack.ts:43` and the producer's
  early return at `hr-ack-notification.ts:96`. If the column stops being read and both are
  not moved to "has at least one active pick", every signed-ack email stops the moment F1's
  migration lands. This is the single most dangerous line in the build.
- **B — `can()` silently drops picked users who are not ADMIN or MANAGER** on pace and
  milestone, because `notify.*.receive` is `MANAGE` and is not grantable (new fork F8).
- **C — a contact's address can bypass a user's denial.** Contacts carry no `user`, so
  `can()` is skipped for them (`dispatch.ts:405`). A contact whose email equals a denied
  user's email gets the email anyway (new fork F9).
- **D — DEBT-106 is live and leaks into pick lists.** A departed admin's `User` row keeps
  `role=ADMIN` and its email. A picker built from `User` rows would list departed people,
  and a departed person who was picked keeps receiving mail (new fork F10).
- **E — milestone extras widen a privacy boundary** that MS-4b drew on purpose: "a Store A
  manager must never read a Store B employee's milestone", and corporate staff go to
  ADMINs only (new fork F11).

Dev migration level: **empty diff. Dev is at schema.** (§ 8)

---

## 1. Repo gate

| Check | Result |
|---|---|
| `git rev-parse --abbrev-ref HEAD` | `staging` ✅ |
| `git status --short` | **Not empty.** Two untracked files, both saved prompts: `docs/prompts/DOCS-NOTIFY-PROD_2026-10-23.md` and `docs/prompts/NOTIFY-RCPT.md` (this session's own prompt). No tracked file is modified. |
| `git log --oneline -1` | `cd62c36 docs(DOCS-NOTIFY-PROD): production email flip 2026-10-23, lost-email window, DEBT row` ✅ |
| `git log --oneline main..staging` | empty ✅ |
| `git log --oneline staging..main` | empty ✅ |
| `git log --oneline @{u}..` | empty: no unpushed commits |

**Judgement on the untracked files.** The prompt says to stop on a surprise. Two untracked
saved prompts are not code drift: one is this session's instruction, and the other is the
previous session's prompt that was never added. The audit is read-only, so I continued.
Gary should decide whether `DOCS-NOTIFY-PROD_2026-10-23.md` gets committed with the next
docs commit.

---

## 2. Every email consumer

### 2.1 The single send path

There are no direct `EmailSender.send()` calls outside `src/lib/notifications/dispatch.ts`.
That file has two kinds of send:

- `consoleEmailSender.send` for dry runs (`dispatch.ts:556` and `:864`).
- `transport.sender().send` in `sendOne` (`dispatch.ts:604`). This is the only real send,
  with one recipient per message.

`getEmailSender()` is also called once in `src/app/api/cron/pace-alerts/route.ts:34` to
build the transport. That call does not send anything by itself.

A grep for `resend|nodemailer|sendgrid|postmark` across `src/` (excluding `generated/`) hits
only:

- `notify.ts`, `dispatch.ts` and `notification-log.ts` (the pipeline itself)
- `webhooks/resend/route.ts` (inbound delivery events)
- two "Resend or revoke it in Clerk" strings in the invite routes. Those are Clerk's
  invitations, not Froot email.

Clerk sends its own invitation emails. Those are outside Froot and outside this model.

### 2.2 Registry (`src/lib/notifications/registry.ts:24`)

`KINDS = [paceAlertKind, hrAckKind, testKind, milestoneKind]`. Four kinds:

| Kind | Producer and trigger | Recipients today (the kind's `resolveRecipients`) | Store-scoped? | `can()` capability | Org on/off switch |
|---|---|---|---|---|---|
| `pace.alert` "Behind-pace alert" | `src/lib/pace-alerts.ts:141` (`processPaceAlertForStore`). Called by the daily cron `GET /api/cron/pace-alerts` (`vercel.json` `0 15 * * *`). Retries come from `GET /api/cron/notify-dispatch` (`15 * * * *`, trigger `sweep`). | `kinds/pace-alert.ts:47`: `prisma.user.findMany({ where: { organizationId, OR: [{ role: "ADMIN" }, { role: "MANAGER", storeAssignments: { some: { storeId: payload.storeId } } }] } })`, filtered to non-empty email. | **Yes**: the store's MANAGERs, plus every ADMIN. | `notify.pace.receive` | `Organization.paceAlertsEnabled`. Checked in the cron's store query (`cron/pace-alerts/route.ts`, `organization: { paceAlertsEnabled: true }`) and again by `enabled` at dispatch. Threshold is `paceAlertThresholdPct`. Written by `PUT /api/pace-alerts/settings`. |
| `hr.ack` "Signed acknowledgment" | `src/lib/hr-ack-notification.ts:145` (`sendAckNotification`), scheduled by `scheduleAckNotification` inside `after()` from `ensureSignedRecord`'s create branch (`src/lib/hr-signed-pdf.ts:803`). Retries come from the hourly sweep. | `kinds/hr-ack.ts:47`: `org.hrAckRecipients.map((email) => ({ email }))`. These are plain addresses with no `user`. | No | none | **The list itself.** `enabled: (org) => org.hrAckRecipients.length > 0` (`kinds/hr-ack.ts:43`), plus the producer skips before enqueue when the list is empty (`hr-ack-notification.ts:96`, HR-16 F3). There is deliberately no separate toggle (`api/hr/settings/route.ts` comment: "two controls that can disagree … is one more than this needs"). |
| `milestone.reached` "Milestone reached" (grouped, `per-recipient-daily`) | `src/lib/milestone-alerts.ts:221` (`enqueueNotification`) / `:216` (`recordKnownNotification`), inside the same daily pace-alerts cron. Sweep retries only intents with `attempts > 0` (C3). | `kinds/milestone.ts:108`: every ADMIN, plus MANAGERs with a `StoreUserAssignment` to any of the employee's stores. **Corporate staff → ADMINs only.** Returns `[]` for an inactive or ineligible member or an archived milestone. `exclude` (`:160`) drops the employee by linked user id and by matching email. | **Yes**, by the employee's stores. | `notify.milestone.receive` | `milestoneAlertsEnabled && milestonesActive(org)`, plus `checklistMilestonesEnabled` for checklist milestones. Written by `PUT /api/milestone-alerts/settings`. |
| `test` "Test" | `POST /api/notify/test` (`route.ts:93`), ADMIN only (`requireAdmin`, `:57`). Dispatched inline. | `[{ email: payload.to }]`, the caller's own Clerk primary email, resolved by the route. `sandboxBypass: true`. | No | none | `() => true` |

**Out of scope, but noted:** `test` must never accept extras. Its whole security model is
"it can only reach the person clicking" (`kinds/test.ts`).

### 2.3 Producer-side logic that reads recipient counts

`pace-alerts.ts` (around line 180) branches on `r.candidates === 0` to log "no admin/manager
recipients" rather than "every admin/manager has behind-pace alerts denied". Once extras
exist, `candidates` includes extras, so both messages need new wording (for example "no
recipients (role or extra)"). This is log text only, but `scripts/verify-f5-polish.ts` may
pin it. Check that fixture in build step 2.

---

## 3. `hrAckRecipients` — every read and write

| Where | Read/Write | What it does |
|---|---|---|
| `prisma/schema.prisma:134` | — | `hrAckRecipients String[] @default([])`, added by migration `20260920120000_hr16_ack_recipients`. |
| `src/app/api/hr/settings/route.ts:85` | **WRITE** | `PUT`, gated by `hrModuleAvailable` → `requireAdmin` → Zod. Free text is split on `\n , ;`, each address validated, lower-cased, de-duped, **max 10**. Empty is allowed and is how sending is turned off. |
| `src/app/(app)/settings/notifications/page.tsx:114` | READ | Passes the list to `HrAckRecipientsField` (`hr-ack-recipients.tsx`, which `fetch`es `PUT /api/hr/settings`). Shown only when `hrModuleAvailable` and the org has `hr` active. |
| `src/lib/hr-ack-notification.ts:80, :96, :153` | READ | Loads the org with the list, silently skips with no intent when it is empty, and puts the list into the failure outcome. |
| `src/lib/notifications/kinds/hr-ack.ts:43, :48` | READ | The `enabled` switch and the resolver. |
| `src/lib/notifications/dispatch.ts:364` (`ORG_SELECT`) and `define.ts:17` (`NotificationOrg`) | READ | Loaded into every dispatch's org view. |
| `scripts/verify-notify6.ts:192, :615, :619, :682, :685` | fixture WRITE | Seeds `[A, B, C]` / `[OTHER]`, then empties and refills the list to test expiry. |
| `scripts/verify-notify5.ts:392` | fixture WRITE | Seeds a list. |

**HR-15b rehire and R1 `recordMissing`: neither reads the column directly.** Both reach the
email through `ensureSignedRecord`. Its create branch calls `scheduleAckNotification`
(`hr-signed-pdf.ts:803`), and the comment there names both cases:

- The R1/R2 `recordMissing` mint goes through `POST /api/hr/documents/[id]/signed-record`
  (`route.ts:105`).
- The ceremony goes through `/api/hr/documents/[id]/acknowledgments` (`route.ts:358`).
- An HR-15b rehire mints a new `signingCycle`, so it notifies again.

So **there is exactly one consumer of the column**: the `hr.ack` kind plus its producer's
pre-enqueue skip. The new model has to replace both reads together (finding A).

### 3.1 Row counts for Gary (Neon console; I did not connect)

Run on **`br-square-feather`** (preview/staging) and on **`br-sparkling-block`**
(production). The branch id comes back inside the result.

```sql
SELECT current_setting('neon.branch_id', true) AS branch,
       count(*)                                                   AS orgs,
       count(*) FILTER (WHERE cardinality("hrAckRecipients") > 0) AS orgs_with_list,
       coalesce(sum(cardinality("hrAckRecipients")), 0)           AS addresses
FROM "Organization";
```

The next query gives the detail the backfill needs. It shows which listed addresses are
also a Froot user's email in the same org, which matters for F9:

```sql
SELECT current_setting('neon.branch_id', true) AS branch,
       o.id, o.name, a.addr,
       EXISTS (SELECT 1 FROM "User" u
               WHERE u."organizationId" = o.id AND lower(u.email) = a.addr) AS is_user_email
FROM "Organization" o, unnest(o."hrAckRecipients") AS a(addr)
ORDER BY o.id, a.addr;
```

---

## 4. Capabilities

From `src/lib/permissions.ts`:

| Key | Baseline | In `ENFORCED_CAPABILITIES` (deniable on the /users grid) | In `GRANTABLE_CAPABILITIES` |
|---|---|---|---|
| `notify.pace.receive` | `MANAGE` (ADMIN, MANAGER), `:505` | yes, `:1005`, area "Email notifications" | **no** |
| `notify.milestone.receive` | `MANAGE`, `:511` | yes, `:1014` | **no** |

`GRANTABLE_CAPABILITIES` (`:584`) holds only `staff.import.square` and `calendar.manage`.
There is **no** `notify.*` key for `hr.ack` or `test`.

**Where `can()` filters recipients:** in one place, `dispatch.ts:405-417`, and only when the
kind has a `capability` **and** the resolved recipient has a `user`. A recipient with no
`user` (an `hrAckRecipients` address today, a contact tomorrow) is never checked.

**Milestones do have their own denial key: `notify.milestone.receive`.** Confirmed.

**Standing rule check.** "`notify.*` keys only remove a person, never add one" holds today.
The key is never used to add anyone; the kind's resolver decides who is a candidate. The
extras layer keeps this as long as `can()` stays a filter after the merge (F3).

**Finding B, in detail.** `can()` returns false for a STORE or STAFF user on both keys
(baseline `MANAGE`, not grantable). So if an admin picks a STORE login as an extra on pace
alerts, that pick is silently dropped at dispatch. For pace and milestone, a user pick only
does anything for a MANAGER: an ADMIN already gets every store by default, and STORE/STAFF
are refused. For `hr.ack`, which has no capability, any user pick works.

---

## 5. `/settings/notifications` today

File: `src/app/(app)/settings/notifications/page.tsx`. It is a server component.

- **Gate:** `getCurrentUser()` then `can(actor, "settings.access")`, otherwise redirect.
  `settings.access` is `ADMIN_ONLY` (`permissions.ts:291`) and is neither deniable nor
  grantable. Each write route re-checks with `requireAdmin()` (PERM-2):
  `api/hr/settings`, `api/pace-alerts/settings`, `api/milestone-alerts/settings`,
  `api/notify/test`.
- **Header:** title, one line of description, `TestSendButton`.
- **Cards, in order:**
  1. **"Signed-acknowledgment emails".** Shown only if `hrModuleAvailable`. If HR is active
     for the org it shows `HrAckRecipientsField`; otherwise a disabled line.
  2. **"Behind-pace alerts".** The toggle (`PaceAlertsToggle`), `PaceAlertThresholdField`,
     and a hard-coded "Recipients: sent to every admin and the store's assigned managers…
     Users page" paragraph.
  3. **"Milestone emails".** Shown only if `hrAvailable`. If milestones are on: the toggle,
     a hard-coded "Recipients:" paragraph, and "Send a sample to me". Otherwise a disabled
     line.
  4. **"Recent emails"** (`RecentEmails`, from `listRecentEmails`). Not gated by module.
- **Client islands:** `hr-ack-recipients.tsx`, `pace-alerts-actions.tsx`,
  `test-send-button.tsx`, `recent-emails.tsx` (server).

**Where a Recipients section goes:** each card's existing "Recipients:" paragraph is the
slot. A new shared server component, for example `recipients-section.tsx`, would render:

- the role-default line from a registry field instead of hard-coded copy
- an "Also send to" client island, for example `also-send-to.tsx`

A new **"Contacts"** card would sit above "Recent emails" and is not gated by module.

New routes, all `requireAdmin` and org-scoped:

- `GET/POST /api/notify/contacts` and `PATCH /api/notify/contacts/[id]` (edit and archive)
- `PUT /api/notify/recipients/[kind]` (replaces the picks for that kind)

`hr.ack` picks must stay behind `hrModuleAvailable`, as `/api/hr/settings` is today.
Contacts must **not** be HR-gated, because pace alerts use them too.

`PUT /api/hr/settings` and `HrAckRecipientsField` are replaced by the generic picker. Under
preserve-and-mark, the route should **refuse** writes (410 with a pointer) rather than keep
writing a column nobody reads.

---

## 6. What a send records today

There are two records per recipient attempt:

- **`NotificationMessage`** (the pipeline's own log): `organizationId, kind, mode, provider,
  providerMessageId, to, subject, status, error, intentId | intentIds[]`. There is one row
  per recipient. A grouped milestone summary leaves `intentId` null and fills `intentIds`.
  Delivery events hang off it as `NotificationEvent`.
- **`AuditLog`** with `entityType "Notification"`, written by `recordEmailAttempt`
  (`notification-log.ts`). `metadata = { kind, provider, mode, recipients: [to], subject,
  resendId?, error?, withheld?, notificationMessageId? }`. This is the parallel write that
  NOTIFY-9 is scheduled to stop.
- `NotificationDelivery` (`intentId, recipient, userId?, messageId, state`) exists **only in
  live mode**. Dry-run and sandbox write none (R1).

**There is no reason field anywhere.** Adding one is additive. Proposal:
`NotificationMessage.recipientReasons String[] @default([])` (values `role`, `extra-user`,
`extra-contact`; an array because one address can qualify more than one way), plus
`reasons` in the AuditLog metadata. Putting it on `NotificationDelivery` instead would lose
dry-run and sandbox sends, which are exactly the ones an admin tests with. For a grouped
message, store the union across the intents it covers.

`listRecentEmails` (`notification-log.ts:209`) can show the reason as a small tag. That is
optional and not required by the prompt.

---

## 7. Proposed schema

Additive only. Names follow the existing `Notification*` family.

```prisma
/// NOTIFY-RCPT. The org address book: people who get Froot email but may never log in.
model NotificationContact {
  id             String    @id @default(cuid())
  organizationId String
  name           String
  /// Lower-cased on write, like hrAckRecipients.
  email          String
  /// F5: archived, never hard-deleted. Archived = in no pick list and receives nothing.
  archivedAt     DateTime?
  createdAt      DateTime  @default(now())
  updatedAt      DateTime  @updatedAt

  organization Organization            @relation(fields: [organizationId], references: [id], onDelete: Cascade)
  picks        NotificationRecipientPick[]

  /// One row per address per org. Re-adding an archived address un-archives it.
  @@unique([organizationId, email])
}

/// NOTIFY-RCPT. "Also send to": one row per (org, kind, person). Exactly one of userId / contactId.
model NotificationRecipientPick {
  id             String   @id @default(cuid())
  organizationId String
  /// A registry kind key ("pace.alert", "hr.ack", "milestone.reached"). Not an FK, since kinds live in code.
  kind           String
  userId         String?
  contactId      String?
  createdAt      DateTime @default(now())

  organization Organization         @relation(fields: [organizationId], references: [id], onDelete: Cascade)
  user         User?                @relation(fields: [userId], references: [id], onDelete: Cascade)
  contact      NotificationContact? @relation(fields: [contactId], references: [id], onDelete: Restrict)

  @@unique([organizationId, kind, userId])
  @@unique([organizationId, kind, contactId])
  @@index([organizationId, kind])
}
```

Plus `NotificationMessage.recipientReasons String[] @default([])`.

**Hand-appended to the migration SQL.** `migrate diff` will not generate either of these, so
they must be reviewed by eye:

- `ALTER TABLE "NotificationRecipientPick" ADD CONSTRAINT … CHECK (("userId" IS NULL) <> ("contactId" IS NULL));`
  Prisma does not model CHECK constraints and ignores them in later diffs, so this does not
  cause drift. Verify that on the first post-migration `migrate diff`.
- The F1 backfill INSERTs (§ 10).

**No per-org-per-type settings table in this phase.** The prompt suggested one as an
example. Nothing needs it yet: each kind's switch is already an `Organization` column,
F6 defers turning off the role default, and scheduling is the next phase. NOTIFY-8 also
plans a "generic per-org setting table". **Coordinate the name with NOTIFY-8** so that two
generic tables don't appear.

**Cascades:**

- **Org deleted → Cascade.** No app path deletes an `Organization`. Only fixtures do
  (`verify-ms1/ms4a/ms5/notify6/f5-polish`). Cascade means those teardowns don't have to
  learn the new tables. Note that 67 of 68 existing `Organization` relations use the
  default (Restrict); `Cascade` here is a deliberate exception, chosen for fixture hygiene.
  If Gary prefers the house default, every fixture teardown must delete picks and contacts
  first.
- **User deleted → pick Cascade.** `DELETE /api/users/[id]` hard-deletes the row
  (`route.ts:372`), so the pick disappears with it. An admin's "Also send to" list can
  therefore shrink without anyone choosing it. Acceptable, because the person is gone, and
  recorded so it doesn't surprise anyone.
- **Contact → pick Restrict.** Contacts are archived, never deleted (F5), so a delete that
  would orphan a pick is an error by design.
- **A departed user (DEBT-106)** is **not** a deleted user. `organizationMembership.deleted`
  (`webhooks/clerk/route.ts:294`) only unlinks staff and deletes `StoreUserAssignment` rows.
  The `User` row keeps its `role` (ADMIN included), its email and its `organizationId`.
  `/users` builds its list from **Clerk memberships**, so the departed person is invisible
  there but still present in the database. Consequences:
  - A picker that lists `User` rows shows departed people.
  - A departed person who was picked **keeps getting extras**. This is the extras version
    of DEBT-106's existing pace-alert leak, and it applies to MANAGER picks too, not only
    ADMIN.

  See F10.

---

## 8. Dev migration level

Command, verbatim (the form prior TIER 3 audits used):

```
npx prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --script
```

Result: **`-- This is an empty migration.`** Target host `ep-late-water-a6k53nv2`, which is
the dev endpoint per `docs/DECISIONS.md:240/378/869`. `env | grep -c DATABASE_URL` printed
`0`, so `.env` supplied the URL. The latest migration folder is
`20261022040811_ms6_milestone_eligible`. **Dev is level with the schema; nothing is
missing.**

Prisma commands run this session, verbatim: the one above. No others. No `migrate dev`,
`deploy`, `reset`, `resolve` or `db execute`.

---

## 9. ROADMAP

- **Next free NOTIFY id: `NOTIFY-12`.** The existing ids are NOTIFY-1, 2a(/2b/2c), 3–11;
  NOTIFY-11 shipped 2026-10-20.
- **Next free DEBT id: `DEBT-121`.** The highest is DEBT-120.
- Both were confirmed unreferenced: no hit in `docs/`, `src/`, `scripts/` (excluding
  `generated/`), and `git log -S` returns nothing for either.

**Overlaps:**

- **DEBT-106** (planned): the departed-admin leak. It directly affects user picks (F10). It
  should become a **blocker** on the user-pick half of NOTIFY-12, or be fixed first.
- **NOTIFY-8** (planned), P1 one-click unsubscribe, ruled "before a second tenant". The
  ruled design says unsubscribe "denies that kind's notify.*.receive for that user… and,
  for an hrAckRecipients address, removes it from the list". After NOTIFY-12 there is no
  list, so the unsubscribe target becomes:
  - a contact: remove the pick, or archive the contact (Gary to rule)
  - an extra user on a kind with no capability (`hr.ack`): remove the pick

  **NOTIFY-8's notes need a pointer to NOTIFY-12.** NOTIFY-8 also plans a generic per-org
  setting table (see § 7).
- **NOTIFY-7** (planned), suppression: per recipient address. It is unaffected, but the
  dispatcher filter it adds should run after the extras merge, so suppression applies to
  extras too.
- **NOTIFY-9** (planned), parallel AuditLog retirement: the `reasons` field I propose for
  AuditLog metadata only lives until NOTIFY-9. `NotificationMessage.recipientReasons` is the
  durable copy.
- **DEBT-120** (console-mode warning): out of scope per the prompt.

---

## 10. Forks for Gary

Each fork gives a lean. **Leans are recommendations, not rulings.**

**F1 — existing `hrAckRecipients`.**
Lean: **as drafted.** The migration backfills each address into `NotificationContact` with
`name = the address` (the column holds no names). Each also becomes an `hr.ack` pick. The
column stays in place, unread, marked in `schema.prisma` and on a DEBT row to drop later.

The backfill SQL is hand-appended to the migration. Ids come from `gen_random_uuid()::text`
because Postgres cannot mint a cuid; ids are opaque strings, so that is fine. The backfill
runs on each branch at `migrate deploy`, so production backfills itself.

**This change must ship in the same release as the code change for finding A.** Rollback
caveat: reverted code reads the column, which still holds the pre-migration list. Any picks
edited after the migration would be ignored after a revert.

**F2 — can "Also send to" pick Froot users, or only contacts?**
Lean: **both**, as drafted. One correction to the premise: a user pick does **not** follow
the Clerk email live. The dispatcher reads `User.email` from the database, which the
`user.updated` webhook keeps in sync. That is the same source the role default already
uses, so it is consistent. It is not literally Clerk.

**F3 — denied user who is also picked.**
Lean: **denial wins**, as drafted. It falls out of the existing order (resolver → `can()` →
de-dup) as long as picked users carry their `user` record. **Gap: see F9.**

**F4 — store-scoped emails and extras.**
Lean: **extras get every store's pace alert**, as drafted. Per-store extras are deferred.

**F5 — deleting a contact.**
Lean: **archive**, as drafted. `archivedAt` is set. Archived contacts drop out of pickers
and the resolver. Their picks are kept, so un-archiving restores them. The UI says
"archived" rather than deleting picks.

**F6 — switching off a kind's role default.**
Lean: **not in this phase**, as drafted. File it as deferred on the NOTIFY-12 row.

**F7 — who manages contacts and picks.**
Lean: **ADMIN only**, as drafted. That means `settings.access` on the page and
`requireAdmin()` on each route.

**F8 — picking a user whose role can never hold the kind's capability** (new; finding B).
For pace and milestone, STORE and STAFF are refused by `can()` (baseline `MANAGE`, not
grantable), so the pick would save and then silently never send.

Lean: **the picker for a kind with a capability lists only users whose role baseline holds
it** (ADMIN and MANAGER). `can()` still re-checks at send time. A per-user-denied MANAGER is
shown with a "receiving off on Users page" note rather than hidden, so F3 is visible.

The alternative, "extras bypass the role baseline but honour denial", would make a picked
pick the first way a `notify.*` key effectively *adds* someone. That reverses the standing
rule, so it is not recommended.

**F9 — a contact whose address is a Froot user's address** (new; finding C).
Contacts have no `user`, so `can()` never sees them, and a denied user could be re-added
through the address book.

Lean: **at send time, an extra-contact whose lower-cased email matches a `User.email` in the
same org is resolved as that user**: denial applies, and the reason stays `extra-contact`.
For `hr.ack`, which has no capability, this changes nothing, so the backfill stays exact.

Also: the contact form warns, without blocking, when the address belongs to a user ("pick
them as a user instead").

**F10 — departed users in pickers and picks** (new; finding D, DEBT-106).
Lean:

- **The picker lists users from Clerk memberships**, the same source as `/users`. Departed
  people therefore never appear.
- **Make DEBT-106 a blocker on user picks.** At send time the database cannot tell a
  departed user from a current one, and guessing from proxies such as "has no store
  assignment" would also drop legitimate ADMINs. Either fix DEBT-106 first by marking
  departed `User` rows on `organizationMembership.deleted`, or ship contacts-only first and
  user picks after DEBT-106.

The cheapest honest path is to build the schema for both now and enable user picks in the
UI only after DEBT-106 closes.

**F11 — milestone extras and the privacy boundary** (new; finding E).
MS-4b deliberately scoped milestone mail by store (B5 item 6) and sends corporate staff to
ADMINs only.

Lean: **extras on milestones receive what an ADMIN receives** (every store, corporate
included). The card says so in the picker's help text. `exclude` still applies, so an extra
never hears about their own milestone. The admin who picks is the one making the
disclosure choice.

Alternative: no extras on milestones in this phase (`extras: false` in the registry), with
a row for later. **This is a privacy call, so it is Gary's, not a default.**

**F12 — hr.ack's on/off switch after F1** (new; finding A).
Today the list is both the recipients and the switch. HR-16 F3 ruled against a second
control that could disagree with it.

Lean: **keep "no separate toggle".** `hr.ack` becomes enabled when it has at least one
active pick: an extra user, or an un-archived contact. Its role default is "no one". The
card says "No one by default — add recipients below to turn these on."

This requires:

- the producer's pre-enqueue skip to read picks
- `enabled` to see picks. Either `loadOrg` loads per-kind active-pick counts into
  `NotificationOrg`, or `enabled` becomes async; that choice belongs in the build.

**F13 — caps.**
Lean: **10 picks per kind** (users plus contacts together), matching today's
`MAX_RECIPIENTS`. **100 active contacts per org.** The second number is mine and is
arbitrary; it only exists so the address book cannot be used to bulk-mail.

---

## 11. Build plan, adjusted (do not start until ruled)

1. **Schema and migration** via `npx prisma migrate diff … -o prisma/migrations/<ts>_notify12_recipients/migration.sql`.
   Hand-append the CHECK constraint and the F1 backfill, then show the full SQL. **STOP.**
   Gary applies it to dev (`env | grep -c DATABASE_URL` must print `0`, then
   `npx prisma migrate deploy`) and says go. Then `npx prisma generate`.
2. **Registry and the extras layer.** Do not add a second resolver.
   - In `define.ts`, add to `KindCommon`:
     - `roleDefault: { summary: string; usersLink: boolean }` (for the card)
     - `extras: boolean`

     `test` gets `extras: false`. Milestone's value follows F11.
   - In `dispatch.ts`, `eligibleRecipients()` merges `def.resolveRecipients()` (reason
     `role`) with active picks for (org, kind):
     - a user pick becomes `{ email, user }`, org-scoped
     - a contact pick has F9 applied

     Then `can()`, then `exclude`, then de-dup. The de-dup **merges reasons** instead of
     keeping the first. `ResolvedRecipient` gains `reasons`.
   - `hr.ack`: `resolveRecipients` returns `[]`; `enabled` and the producer's skip read
     picks (F12). **The column is no longer read anywhere.**
   - `writeMessage` stamps `recipientReasons`, and `recordEmailAttempt` stamps `reasons`.
   - `pace-alerts.ts` log wording (§ 2.3).
   - **An org with no picks must behave exactly as today**: the same recipients in the same
     order, the same subjects and bodies. `verify-f5-polish.ts`, `verify-notify5/6.ts` and
     `verify-ms4b.ts` must pass unchanged, except for the hr.ack seeding, which moves from
     the column to picks.
3. **Hub UI.**
   - A Recipients section per card: the role-default line from the registry, and the
     "Also send to" picker. Users come from Clerk memberships (F10) and are filtered per F8;
     contacts are un-archived only.
   - A "Contacts" card: add, edit and archive, ADMIN only.
   - New routes (§ 5).
   - Retire `PUT /api/hr/settings` (410) and `HrAckRecipientsField`.
   - Whether the user half of the picker is enabled depends on F10.
4. **Fixture**, for example `scripts/verify-notify12.ts`:
   - each kind goes through the resolver
   - a no-picks org gives byte-identical recipients
   - extras are de-duped against the role default, with merged reasons
   - a denied user who is picked is not sent
   - a contact with a denied user's email is not sent (F9)
   - an archived contact is excluded and its picks survive
   - a STORE-role pick on pace is refused (F8)
   - the backfilled `hr.ack` picks equal the old column exactly, per org, as sets
   - `hr.ack` with zero picks is skipped with no intent (F12)
   - the milestone extras scope follows F11
   - sandbox and dry-run still write reasons

   Per § A migration STOPS the session, the commit waits for a green run against the
   applied schema.
5. **Commits.** First the work commit, gated by scoped eslint, `npm run build` and the
   fixture. Then the docs commit:
   - the NOTIFY-12 row
   - a DEBT-121 row to drop `hrAckRecipients` later
   - a pointer from NOTIFY-8's P1 notes
   - DEBT-106 marked as blocking user picks
   - DECISIONS.md draft rulings for Gary to ratify

   Use scoped `git add`. **Never push.** PRE-PUSH-CHECK is a separate session.

**Out of scope, as the prompt says, and no ROW is needed for any of them:** scheduling and
digests, employee-facing email, reply-to (already on NOTIFY-8 P4), and DEBT-120.

---

## 12. Triage of findings

| Finding | Disposition |
|---|---|
| A: hr.ack switch lives in the column | **RULING NOW** (F12), built in step 2 |
| B: `can()` drops STORE/STAFF picks | **RULING NOW** (F8) |
| C: contact bypasses denial | **RULING NOW** (F9) |
| D: departed users (DEBT-106) | **RULING NOW** (F10); existing ROW DEBT-106 gains a blocker note in the docs commit |
| E: milestone privacy | **RULING NOW** (F11) |
| Pace log wording (§ 2.3) | **FIX IN BUILD**, step 2 |
| NOTIFY-8 unsubscribe target changes | **COMMENT** on NOTIFY-8 in the docs commit |
| Untracked `DOCS-NOTIFY-PROD_2026-10-23.md` | **COMMENT** to Gary (commit it or not) |

Counts: 5 RULING NOW, 1 FIX IN BUILD, 2 COMMENT, 0 new ROWs.
