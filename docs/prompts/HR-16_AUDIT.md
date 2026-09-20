# HR-16 — Phase 1 audit

**TIER 3.** Audit only. No file outside this one was touched; no `prisma`
command was run. Written before the report, per CLAUDE.md § Where documents live.

**Date:** 2026-09-20 · **Branch:** `staging` · **HEAD:** `13bccff`
(`chore: rebuild staging so NOTIFY-1 picks up Preview env vars` — the same
deployment the prompt cites for the proven Resend delivery). Working tree clean
apart from the untracked `docs/prompts/HR-16.md`. Nothing unpushed.

---

## 1. The minting moment

**There is exactly ONE place an `HrSignedRecord` row is created.**

- `src/lib/hr-signed-pdf.ts:769` — `prisma.hrSignedRecord.create(...)`, inside
  `ensureSignedRecord`, declared at `src/lib/hr-signed-pdf.ts:315`.

A repo-wide grep for `hrSignedRecord.(create|upsert|createMany)` outside
`src/generated/` returns that line and nothing else. Every other reference is a
`findUnique` / `findMany` / `count` read.

**Not in a transaction.** Neither `src/lib/hr-signed-pdf.ts` nor
`src/app/api/hr/documents/[id]/acknowledgments/route.ts` contains `$transaction`
at all. The create is a bare `prisma.hrSignedRecord.create` wrapped in a
`try/catch` whose catch handles the concurrent-completion race by re-reading the
unique `(version, staff, cycle)` key and returning the winner
(`src/lib/hr-signed-pdf.ts:782`). So "after the record is committed" is simply
"after `ensureSignedRecord` resolves" — there is no transaction boundary to wait
on, and the returned row is durable.

**`ensureSignedRecord` is idempotent by construction.** It early-returns an
existing current-cycle record at `src/lib/hr-signed-pdf.ts:336` BEFORE doing any
work. This matters to HR-16 more than anything else in this finding: **the early
return is the line that decides whether a notification is a mint or a re-read.**
A notification fired from the call sites below would send on every completion
POST; a notification fired from inside `ensureSignedRecord` after the create can
only fire on a real mint. (The prompt's wiring instruction says "at the minting
moment … AFTER the record is committed", which points inside the function; I
have not built it, only noted that the two placements differ observably.)

### Call sites of `ensureSignedRecord` — there are TWO

| # | Site | Who reaches it | What it is |
|---|---|---|---|
| 1 | `src/app/api/hr/documents/[id]/acknowledgments/route.ts:358` | the signer, mid-ceremony | the ordinary path — fires when `checkpointsComplete` |
| 2 | `src/app/api/hr/documents/[id]/signed-record/route.ts:105` | signer (self), ADMIN, or in-scope MANAGER | the RECOVERY path — used when the synchronous generator failed, and the "Generate record" button on `/staff/[id]` |

Both are plain `await`s, both outside any transaction.

**Site 1 is the only one the ceremony uses, and both ceremony entry points share
it.** `/hr/acknowledge/[documentId]` and `/my/documents/[documentId]` render the
SAME `SigningClient`, which POSTs to `/api/hr/documents/${doc.id}/acknowledgments`
(`src/app/(app)/hr/acknowledge/[documentId]/signing-client.tsx:212`). There is no
separate `/api/my/...` capture route. So the prompt's staging step 3 ("sign
through `/my`") exercises site 1.

**Site 2 is where the R1/R2 `recordMissing` → mint case lands** (a signer who
completed the full current-version set but holds no record). That is the case the
prompt's rulings say must also send. It is a SECOND call site, so wiring the
notification at the call sites means wiring it twice; wiring it inside
`ensureSignedRecord` covers both with one line. Site 2 is also the only path that
can be invoked by someone OTHER than the signer — an admin pressing "Generate
record" mints a record for a third party, and the email that results is
attributed to the signer, not the admin.

Site 1's failure handling is already non-fatal: a throw from `ensureSignedRecord`
is caught, logged, and the response reports `complete: false` rather than 500
(`.../acknowledgments/route.ts:358-370`). Nothing in HR-16 may weaken that.

---

## 2. What a record knows

`HrSignedRecord` (`prisma/schema.prisma:2097-2114`) is deliberately thin — it is
a pointer to an artifact, not a copy of it. **Six of the eight facts the email
needs are NOT on the record.**

### Direct fields on `HrSignedRecord`

| Fact | Field |
|---|---|
| record id | `id` |
| completed at | `completedAt` — "when the last required checkpoint was signed" |
| signing cycle | `signingCycle` (`Int`, default 1; HR-15 Policy B) |
| (minted at) | `generatedAt` |
| (artifact) | `signedPdfPathname`, `signedPdfHash` |
| (keys) | `hrDocumentVersionId`, `staffMemberId` |

### Needs a join

| Fact | Where it lives | Join |
|---|---|---|
| version number | `HrDocumentVersion.versionNumber` (`schema.prisma:1949`) | `record.version` |
| document title | `HrDocument.title` | `record.version.hrDocument` |
| org name | `Organization.name` | `record.version.hrDocument.organization` |
| signer name | see below | — |
| store | see below | — |

There is **no version "label"** — `versionNumber` is an `Int`, and the UI renders
it as `v{n}` (`src/app/(app)/hr/signed-records/page.tsx:93`). `fileName` exists on
the version and is what the certificate prints as "Source file".

### Signer name — the HR-11c pair, and it lives on the ACKNOWLEDGMENT rows

Neither name is on `HrSignedRecord`, and only one of them exists anywhere on
`StaffMember`. Both come from `HrDocumentAcknowledgment`
(`prisma/schema.prisma:2055-2091`), which snapshots them at signing time:

- **Name on record** = `HrDocumentAcknowledgment.staffName`, taken from the LAST
  acknowledgment by `signedAt` (`src/lib/hr-signed-pdf.ts:424`, `:617`).
- **Name as executed** = the `typedName` of the first `Signature`-or-
  `Acknowledgment` checkpoint, falling back to `staffName`
  (`src/lib/hr-signed-pdf.ts:598-602`, printed at `:618`).

**This is the one finding with a real cost attached.** To reproduce the
certificate's own two names, the email must re-query
`HrDocumentAcknowledgment` on `(hrDocumentVersionId, staffMemberId, signingCycle)`
— the same three keys `ensureSignedRecord` uses — and re-derive both. There is no
join from `HrSignedRecord` to its acknowledgments (no relation field on either
model; the link is the three shared keys, not an FK). A cheaper alternative
exists and is WORSE: `StaffMember.fullName ?? displayName` is what the admin list
renders, but it is the LIVE name, so an email would disagree with the frozen
certificate it links to the moment someone is renamed — which is exactly the
drift `staffName` was snapshotted to prevent.

### Store

Two sources, and they are not the same thing:

- **Snapshot:** `HrDocumentAcknowledgment.storeName` (`String?`) — what the
  certificate prints (`src/lib/hr-signed-pdf.ts:619`, `?? "-"`). Nullable:
  corporate signers have no store.
- **Live:** `StaffMember.storeAssignments[].store.name`, ordered
  `isPrimary desc, name asc` — what `/hr/signed-records` and the mint's own
  timezone lookup use (`src/lib/hr-signed-pdf.ts:325-330`).

The snapshot is the right one for an email that describes a frozen record, and it
arrives free in the same acknowledgment query the two names need.

---

## 3. The admin-facing record URL

**There is no admin PAGE for a single signed record. None exists.** The full
inventory:

| Route | Kind | Gate |
|---|---|---|
| `/my/documents/records/[recordId]` | page | the signer's own record only |
| `/hr/signed-records` | page, LIST of 50 most recent, org-wide | ADMIN only (`page.tsx:20`, `dbUser?.role !== "ADMIN"` → `notFound()`) |
| `/api/hr/signed-records/[id]/download` | API, 307 → short-lived signed blob URL | ADMIN or in-scope MANAGER (`canReadHrSignedRecord`) |
| `/api/my/signed-records/[recordId]` | API | signer's own |
| `/staff/[id]` | page, per-staff document list | carries the per-record download link |

**The download affordance is `/api/hr/signed-records/<recordId>/download`**, used
in exactly two places:
`src/app/(app)/hr/signed-records/page.tsx:103` and
`src/app/(app)/staff/[id]/staff-documents.tsx:145`.

Its gate is the HR-7 rule-5 tier: ADMIN or a MANAGER assigned to one of the
signer's stores. The owning staff member no longer self-downloads from it.

### The three candidates, since the prompt asks for a proposal

1. **`/api/hr/signed-records/<recordId>/download`** — deep-links THE record, and
   only the record. Correctly gated. **But it is not a page**: it 307s to a
   signed blob URL, so clicking it from an email downloads a PDF rather than
   opening a screen. The prompt's staging step 4 says "link opens the record as
   admin", which this satisfies only if "the record" means the artifact.
2. **`/staff/<staffMemberId>`** — a real page, shows this signer's whole document
   list with the download control on the row, and reads naturally from an email
   about a person. Does not deep-link the single record; ADMIN/MANAGER reachable.
3. **`/hr/signed-records`** — the list the prompt names as the fallback. ADMIN
   only, org-wide, 50 most recent, and **no anchor per row**, so a recipient must
   find the record by eye. Weakest of the three.

**My lean (not a ruling): (1).** It is the only URL that names the record the
email is about, and the email's own "Record:" label sets the expectation that the
link yields the record. If Gary wants a screen rather than a download, (2) is the
nearest page and costs nothing extra. **This is a fourth fork and I am surfacing
it rather than resolving it — see F4 below.**

---

## 4. Where org HR settings live

**`Organization.hrDateStampFormat` HAS NO SETTINGS PAGE AND NO API ROUTE. Nothing
in the app writes it.** This is the finding the prompt's "the new field goes
beside it" does not survive contact with.

- Declared at `prisma/schema.prisma:62`, `String @default("dateOnly")`.
- Read in exactly one place: `src/lib/hr-signed-pdf.ts:486`.
- Its permitted values are exported as `HR_DATE_STAMP_FORMATS`
  (`src/lib/hr-documents.ts:313`) — and that constant has **no consumer**. A grep
  for `dateStampFormat` across `src/` returns the schema, the one read, and the
  unused constant. There is no form, no Zod schema, no PATCH. The column is set
  by hand in the database or not at all.

So there is no "beside it" to put the new field beside. What actually exists:

### The org HR surface that does exist

- **Page:** `/settings` → the "HR, Training & Compliance" card
  (`src/app/(app)/settings/page.tsx:216-253`), rendered only when
  `hrModuleAvailable(org?.clerkOrgId)`.
- **Its one control:** `HrModuleToggle` (`src/app/(app)/settings/hr-actions.tsx`),
  a client island posting to **`POST /api/hr/toggle`**.
- **Role gate, two layers:** the page redirects unless
  `can(actor, "settings.access")`, and `settings.access` is `ADMIN_ONLY`
  (`src/lib/permissions.ts:273`) and is NOT in `GRANTABLE_CAPABILITIES`. The route
  independently calls `requireAdmin()` and 403s
  (`src/app/api/hr/toggle/route.ts:22-26`), behind `hrModuleAvailable()` which
  404s first.

**Consequence for F1: `/settings` is structurally ADMIN-only.** Putting the field
on that card makes "ADMIN only" free and makes "the manage tier" impossible
without a different surface. Choosing the manage tier means a new page (the
`/settings/labor` shape) or a new section on `/hr`.

### The precedent for an org-level settings FORM

`/settings/labor` (`page.tsx` + `labor-settings-client.tsx`) reading and writing
**`GET`/`PUT /api/labor/settings`** (`src/app/api/labor/settings/route.ts`) — Zod
`putSchema` at the top of the route file, org row resolved from context, read and
write both ADMIN+MANAGER via `requireLaborContext({ write: true })`. That is the
nearest working model for a typed org-settings field with a form behind it.

---

## 5. AuditLog

**It exists, and its `action` is FREE-FORM.**

`prisma/schema.prisma:770-783`:

```
model AuditLog {
  id, organizationId, userId String?, action String,
  entityType String, entityId String?, metadata Json?, createdAt
  @@index([organizationId, entityType, createdAt])
}
```

`action` and `entityType` are plain `String` — no enum, no constraint. So an
HR-16 action name needs no migration and no schema change.

**One writer, one reader, and neither is HR.**

- Writer: `writeAuditLog()` at `src/lib/audit.ts:34`. **It already swallows its
  own failures** — the create is inside a `try/catch` that logs and returns void
  (`src/lib/audit.ts:45-47`), with the stated contract "writes NEVER block the
  user action". That is precisely the property F2 needs, already built.
- Callers: six goal/forecasting routes only.
- Reader: `/api/forecasting/audit`, filtered to
  `GOAL_ENTITY_TYPES = ["goal_plan","daily_goal","store_monthly_goal"]`
  (`src/lib/audit.ts:16`).

**So HR-16 rows would be invisible to every existing reader** — the only surface
that renders AuditLog filters on goal entity types, so an `hr_signed_record` row
cannot pollute the Edit-history panel. Writing them is safe; reading them back
requires a surface nobody has asked for yet.

`userId` is documented as "Clerk user id". An HR-16 send has **no acting user** on
the ceremony path (the signer is a `StaffMember`, and the send runs in `after()`
detached from the request), so `userId` would be `null` — which the column
permits.

**Adjacent precedent worth naming:** `PaceAlertLog` (`schema.prisma:788-800`)
already stores `recipients String[]` per alert sent. F-5 records deliveries in a
dedicated table, not in AuditLog — and it does so because it needs the row as an
idempotency lock, which HR-16 does not (the record's uniqueness already makes the
mint fire once).

---

## 6. Migration state

`ls prisma/migrations` — 57 migration folders plus `migration_lock.toml`. The
four newest, in sort order:

```
20260905203838_hr32_lesson_linked_document
20260906022810_hr33_lesson_external_link
20260917143000_cal1_calendar
20260918180000_cal2_scheduled_checklists      ← NEWEST
```

**Newest folder: `20260918180000_cal2_scheduled_checklists`.** Any HR-16
timestamp beginning `202609200` or later sorts after it; a `20260920` stamp is
two days clear.

**`docs/MIGRATIONS.md` exists** (826 lines). Entry format, from the CAL-2, DOC-3
and HR-11n exemplars (`docs/MIGRATIONS.md:532`, `:560`, `:702`):

- `## YYYY-MM-DD — \`<folder_name>\` (PHASE)` heading, **appended at the end of
  the file** (chronological, oldest→newest — the opposite of `DECISIONS.md`).
- An applied-to line naming the branch and endpoint, and stating explicitly that
  staging/production get it via `migrate deploy` in the Vercel build on Gary's
  push. **For this session the line must say it was applied NOWHERE** — no
  `prisma` command against any database will have been run.
- A `| Statement | Kind |` table, one row per SQL statement.
- Prose covering: drops/renames/type changes (none), backfill (none), and why
  every existing row lands correctly on the default.
- The exact `migrate diff` command, verbatim, in a fenced block.
- A note on whether the diff came back clean — i.e. whether dev was in sync with
  `schema.prisma`. **`--from-config-datasource` reads the live DEV database**, so
  pre-existing drift would surface as extra statements; CAL-2's entry explicitly
  asks the next session to prefer that form, and it is what CLAUDE.md § Database
  step 2 prescribes.

---

## Supporting findings the prompt did not ask for

**a. `EmailMessage.replyTo` was added by NOTIFY-1 explicitly for HR-16.**
`src/lib/notify.ts:19-22` carries the comment "NOTIFY-1, additive and unused
today. HR-16 needs it so a manager who hits Reply … reaches their own office
rather than the no-reply sending address." **The HR-16 prompt rules the opposite:
"`replyTo` is not set."** The prompt is the later instruction and wins; the stale
comment is flagged so it is not read as a requirement.

**b. `getEmailSender()` THROWS on misconfiguration and never degrades**
(`src/lib/notify.ts:138-157`). On staging `NOTIFY_EMAIL_PROVIDER=resend`, so a
missing `RESEND_API_KEY`/`NOTIFY_FROM_EMAIL` throws at sender construction. The
HR-16 try/catch must therefore wrap `getEmailSender()` itself, not just `send()`.

**c. The absolute-URL host: `NEXT_PUBLIC_APP_URL` exists and is in service.**
There is no app-URL helper function. The variable is read directly in eight
places (`src/app/api/square/callback/route.ts:15`, `.../users/route.ts:112`,
`.../staff/[id]/invite/route.ts:63`, `.../webhooks/square/route.ts:51`, …), and
`webhooks/square` treats it as required and 500s when unset. **No new env var is
needed.** Recommended form is `new URL(path, process.env.NEXT_PUBLIC_APP_URL)`,
matching `webhooks/square/route.ts:58`, with a guard for the unset case.

**d. `after()` is established in this codebase.** Five call sites:
`src/lib/labor-dashboard.ts:202` and `:302`,
`src/app/api/dashboard/sales/route.ts:233`,
`src/app/api/dashboard/summary/route.ts:105`,
`src/app/api/webhooks/square/route.ts:90`. `scheduleLaborRefresh`
(`src/lib/labor-dashboard.ts:197`) is the closest exemplar — its header comment
reads "NEVER THROWS INTO THE RESPONSE. Every failure is caught and logged; the
route has already returned by the time this runs", and it try/catches inside the
loop. That is the shape HR-16's send should copy.

**e. HR-8 HAS NO `blockers:` ARRAY.** `docs/ROADMAP.yaml:4046-4057`. Its email
blocker exists only as a clause in `notes` — "reminder emails blocked on the
notify.ts provider (see F-5 blocker)". So Phase 3's instruction to add a
`{resolved: true}` mark to HR-8's blocker has **nothing to mark**. The options
are to create a `blockers:` array on HR-8 holding a single resolved entry, or to
prepend the clearance to HR-8's `notes` per preserve-and-mark. Surfaced as **F5**
below rather than chosen.

**f. The blocker-marking convention, read as instructed.** `docs/ROADMAP.yaml`
header lines 20-44 and the HR-11c/CHK-3 exemplars (`:4139`, `:1947`): an entry is
a bare string (LIVE), `{narrowed: true, text: >}`, or `{resolved: true, text: >}`.
The convention is **preserve-and-mark, in two parts**: the original entry keeps
its prose **verbatim** and gains the `resolved: true` flag, and a NEW resolved
entry is **prepended above it** carrying the evidence that closed it. "NEVER edit
an entry's text to mark it resolved" and "NEVER write `resolved: false`" are both
explicit. F-5's live entry is a bare string at `docs/ROADMAP.yaml:3935`; HR-16's
is a bare string at `:4272`.

**g. NOTIFY-1's row already names this session as the one that does the marking.**
`docs/ROADMAP.yaml:17493-17497`: "Clears the shared blocker on F-5, HR-16 and
HR-8 ONCE STAGING DELIVERY IS PROVEN — those blocker entries are flagged resolved
in the PRE-PUSH-CHECK/docs pass that records the evidence, not here." NOTIFY-1's
own `commits:` are `1c21368` and `8a10f8d`; its status is `staging`.

**h. F-5 derives recipients from users, not from a column.**
`src/lib/pace-alerts.ts:98` builds them from ADMIN/MANAGER user emails and skips
with `reason: "no admin/manager recipients"` when the list is empty. That is a
directly relevant precedent for F3 — F-5 already treats an empty recipient list
as a named, logged skip rather than a silent one — and a contrast for the HR-16
ruling that recipients are an explicit org-level column.

---

## Forks for Gary — presented, NOT resolved

**F1 — Who edits recipients.** ADMIN only (my lean: yes) vs the manage tier.
Finding 4 adds a structural argument: `/settings` is `ADMIN_ONLY` at the page
(`settings.access`) and at every route behind it, so ADMIN-only is the free
option and the manage tier costs a new surface.

**F2 — Send outcome recorded where.** AuditLog row per attempt vs function-log
line only. Finding 5 says AuditLog is available, free-form, already
failure-swallowing, and invisible to every existing reader — so the row is cheap
and safe. The counter is that nothing would ever read it.

**F3 — Empty recipients.** Silently skip (prompt's lean) vs log a warning line.
Finding (h): F-5 already logs a named reason in the same situation.

**F4 — NEW, forced by finding 3. What the "Record:" link points at.** There is no
admin page for one record, so the prompt's "the ADMIN/MANAGER route for the same
record" does not exist as a page. Choose: (1) the download API
`/api/hr/signed-records/<id>/download` (deep-links the record, downloads a PDF,
my lean), (2) `/staff/<staffMemberId>` (a real page, the person not the record),
or (3) `/hr/signed-records` (the list, no per-record anchor).

**F5 — NEW, forced by finding (e). How HR-8's blocker gets marked**, given it has
no `blockers:` array — create one holding a single resolved entry, or prepend the
clearance to its `notes`.

---

## What Phase 2 would touch, if the go comes

Named for approval, not written:

- `prisma/schema.prisma` — `Organization.hrAckRecipients String[] @default([])`,
  beside `hrDateStampFormat` (`:62`).
- `prisma/migrations/20260920<HHMMSS>_hr16_ack_recipients/migration.sql` —
  generated by `npx prisma migrate diff --from-config-datasource --to-schema
  prisma/schema.prisma --script -o …`. **Generated only. Never applied.**
- `docs/MIGRATIONS.md` — appended entry.
- `src/app/(app)/settings/page.tsx` + `src/app/(app)/settings/hr-actions.tsx` —
  the recipients field on the HR card (placement subject to F1).
- A settings write route — new, `/api/hr/settings` on the `/api/hr/toggle` +
  `/api/labor/settings` pattern (subject to F1).
- `src/lib/hr/ack-notification.ts` — **note: there is no `src/lib/hr/` directory.**
  HR libs are flat files: `src/lib/hr.ts`, `hr-signed-pdf.ts`, `hr-compliance.ts`,
  `hr-completion.ts`, `hr-documents.ts`, `hr-files.ts`, `hr-anchors.ts`,
  `hr-documents-access.ts`. The prompt's "or the nearest existing lib folder"
  resolves to `src/lib/hr-ack-notification.ts`.
- The wiring point — inside `ensureSignedRecord` after `src/lib/hr-signed-pdf.ts:769`
  (covers both call sites and only real mints), or at the two call sites.
- `docs/ROADMAP.yaml`, `docs/DECISIONS.md`, `docs/prompts/HR-16.md`.

## Commands run in this phase

`prisma` commands run: **NONE.** No database was contacted. Reads only:
`git status`/`branch`/`log`, `grep`, `sed`, `find`, `ls`, `cat`, `wc`.
