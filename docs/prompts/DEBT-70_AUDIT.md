# DEBT-70 — the client/server date split. Step 1 audit.

**Session:** 2026-08-16. TIER 3, audit phase. No source file touched; this
artifact is the session's only output.
**Row:** `DEBT-70` in `docs/ROADMAP.yaml`.
**Measured against** `staging` at local HEAD `4d92fe7`, and against local dev
(`br-broad-wave-a6vpjdw0` / `neondb`) where a query was needed.

---

## 0. The finding that changes the shape of the work

Two of them, and either one on its own would have changed the plan.

### (a) THE MECHANISM ALREADY EXISTS, AND SO DOES THE RULING

`Store.timezone` is on the schema today — `prisma/schema.prisma:140`,
`String @default("America/Los_Angeles")`. It is not decorative. It is already
load-bearing across checklists, forecasting, operations reports, labor and the
dashboard, through a small set of shared primitives:

| Helper | File | What it does |
| --- | --- | --- |
| `localDateStr(instant, tz)` | `src/lib/reports.ts:51` | store-local `yyyy-mm-dd` of an instant |
| `businessDayWindow(instant, tz)` | `src/lib/reports.ts:71` | the store-local business day as a UTC-midnight range |
| `dbDate(dateStr)` | `src/lib/reports.ts:57` | civil date → UTC midnight |
| `formatWindowTime(at, tz)` | `src/lib/checklist-status-display.ts:141` | `"10:00 AM"` in the store's zone |

All four use `Intl.DateTimeFormat` with an explicit `timeZone`. And the reason
is already written down, in the codebase, in almost the words this row uses:

> `src/lib/reports.ts:66` — "Never derive a checklist's 'today' from server
> time — Vercel runs UTC, which flips to the next day at 5-6 PM local for US
> stores and misattributes evening shifts (the I-14 handoff-note bug)."

> `src/lib/checklist-status-display.ts:136` — "a banner that renders them in the
> SERVER's zone would tell a Denver closer their window ended at an hour they
> were not working."

**So DEBT-70 is not an open design question. It is a settled convention that the
HR, staff and `/my` surfaces never adopted.** The Denver sentence is Gary's
multi-tenancy constraint, already ruled, already implemented, two years of
store-hours logic already depending on it.

**Measured gap: not one file under `src/app/(app)/hr`, `src/app/(app)/staff`,
`src/app/(my)`, or `src/lib/hr-*.ts` selects `store.timezone`. Zero of them.**
The primitives exist; the HR half of the app has never called them.

### (b) THERE ARE TWO KINDS OF `DateTime` AND THEY PULL IN OPPOSITE DIRECTIONS

This is the finding that makes "render everything in store-local time" wrong,
and it is why a blanket sweep would have shipped a new defect while fixing this
one.

**INSTANTS** — `HrSignedRecord.completedAt`, `createdAt`, `signedAt`,
`finalizedAt`. A moment in time. Stored UTC, means the same instant everywhere,
and must be *rendered* in some chosen zone.

**CIVIL DATES STORED AS UTC MIDNIGHT** — `Checklist.date`,
`SalesPeriodCache.date`, and everything else written through `dbDate()`. These
are *already* store-local days. `businessDayWindow` computes the store-local day
and stores it as `T00:00:00.000Z`. The UTC midnight is a container, not a time.

Measured, on the two real values in play:

```
CIVIL DATE  — Checklist.date for store-local Aug 15 = 2026-08-15T00:00:00.000Z
   rendered UTC                  -> Aug 15, 2026    <- CORRECT (matches the stored day)
   rendered America/Los_Angeles  -> Aug 14, 2026    <- WRONG, one day BACKWARD

INSTANT     — Gdogg's HrSignedRecord.completedAt = 2026-08-16T04:06:00.000Z
   rendered UTC                  -> Aug 16, 2026    <- WRONG, nobody lived this day
   rendered America/Los_Angeles  -> Aug 15, 2026    <- CORRECT
   rendered America/Denver       -> Aug 15, 2026    <- CORRECT for a New Mexico store
```

**A rule that fixes one breaks the other.** Any mechanism has to know which kind
of value it has been handed. This is the single most important constraint on the
plan, and it is invisible from the symptom.

---

## 1. All 31 files, all 64 call sites

`format()` from `date-fns`, across `src/app`, `src/components`, `src/lib`.
Split by whether the file carries `"use client"` on line 1.

**Totals: 31 files, 64 call sites — 20 files / 42 calls CLIENT, 11 files / 22
calls SERVER.** The "22" on the row today is the server half; the denominator it
should be read against is 64.

### 1a. SERVER — 11 files, 22 calls (renders Vercel UTC)

★ = the anchor case: a signature time, the class Gary's ruling is about.

| # | Site | Renders | Kind | Verdict |
| --- | --- | --- | --- | --- |
| 1 ★ | `hr/signed-records/page.tsx:84` | `HrSignedRecord.completedAt` | instant | **WRONG** |
| 2 ★ | `staff/[id]/staff-compliance.tsx:72` | `HrSignedRecord.completedAt` | instant | **WRONG** — this is the "Aug 16" Gary saw |
| 3 ★ | `(my)/my/documents/page.tsx:158` | `HrSignedRecord.completedAt` | instant | **WRONG** |
| 4 ★ | `(my)/my/documents/page.tsx:203` | `HrSignedRecord.completedAt` + time | instant | **WRONG** |
| 5 ★ | `(my)/my/documents/records/[recordId]/page.tsx:59` | `HrSignedRecord.completedAt` + time | instant | **WRONG** |
| 6 ★ | `hr/compliance/page.tsx:221` | `FormSubmission.employeeSignedAt` | instant | **WRONG** |
| 7 | `staff/[id]/staff-compliance.tsx:87` | training `dueDate` ("was due") | instant¹ | wrong, low stakes |
| 8 | `staff/[id]/staff-compliance.tsx:88` | training `dueDate` ("due") | instant¹ | wrong, low stakes |
| 9 | `(my)/my/page.tsx:208` | training `dueDate` | instant¹ | wrong, low stakes |
| 10 | `(my)/my/training/page.tsx:77` | training `dueDate` | instant¹ | wrong, low stakes |
| 11 | `components/hr/training-module-view.tsx:156` | `certifiedAt` | instant | wrong |
| 12 | `components/hr/training-module-view.tsx:251` | lesson `completedAt` | instant | wrong |
| 13 | `staff/[id]/page.tsx:596` | StaffMember `createdAt` ("Member since") | instant | wrong |
| 14 | `staff/[id]/page.tsx:618` | `terminatedAt` | instant | wrong |
| 15 | `staff/[id]/page.tsx:623` | `rehiredAt` | instant | wrong — HR-15 cycle evidence |
| 16 | `staff/[id]/page.tsx:711` | StaffMember `createdAt` | instant | wrong |
| 17 | `users/page.tsx:339` | User `createdAt` | instant | wrong |
| 18 | `users/page.tsx:386` | PendingInvite `createdAt` | instant | wrong |
| 19 | `(my)/my/documents/page.tsx:233` | StaffDocument `createdAt` | instant | wrong |
| 20 | `(my)/my/page.tsx:139` | TeamMessage `createdAt` + time | instant | wrong |
| 21 | `(my)/my/page.tsx:157` | CorporateUpdate `publishedAt` | instant | wrong |
| 22 | `checklists/page.tsx:191` | **`Checklist.date`** | **CIVIL DATE** | **CORRECT AS-IS — DO NOT TOUCH** |

¹ `dueDate` is stored from the browser as `new Date("<yyyy-mm-dd>T12:00:00")`
(`bulk-assign-dialog.tsx:159`, `staff-training.tsx:156`) — a deliberate NOON
hedge. See §4.

**Site 22 is the trap.** It is the one server site that is right, and a sweep
that converted "all 22 server calls to store-local" would move it a day
backward. It renders a value that is already a store-local day.

### 1b. CLIENT — 20 files, 42 calls (renders the viewer's local time)

These are correct *today*, and correct by accident — nothing states the
intention, and any of them could be moved to a server component by a future
refactor and silently flip to UTC.

| Site(s) | Renders | Notes |
| --- | --- | --- |
| `hr/acknowledge/[documentId]/signing-client.tsx` :356, :450, :782, :919 | live `new Date()` during the ceremony | the signer's own clock — correct by construction |
| same file :535, :581, :892 | per-checkpoint capture times held in state | the signer's own clock |
| `hr/documents/[id]/document-detail-client.tsx:176` | version `createdAt` | **the versions card** — this is the `8:02 AM` vs `15:02 UTC` Gary saw; it is on the CORRECT side |
| `hr/documents/documents-client.tsx:252` | document `uploadedAt` | |
| `hr/forms/[id]/form-builder-client.tsx:339` | form version `createdAt` | |
| `hr/forms/[id]/submit/submit-client.tsx:343` ★ | `employeeSignedAt` | signature time, correct side |
| `staff/[id]/staff-documents.tsx:72` ★ | `HrSignedRecord.completedAt` | **the "Aug 15" Gary saw** — correct side |
| `staff/[id]/staff-form-documents.tsx:48, :146, :147` ★ | employee/supervisor signed | correct side |
| `staff/[id]/manager-notes.tsx:316` | note `createdAt` | |
| `staff/[id]/staff-training.tsx:245, :275, :373` | `dueDate`, lesson `completedAt`, `submittedAt` | |
| `staff/[id]/staff-uploaded-documents.tsx:160` | `createdAt` | |
| `inventory/alerts/alerts-client.tsx:118` | `finalizedAt` | |
| `inventory/counts/[id]/summary-view.tsx:142, :206, :301` | `finalizedAt`, `createdAt` | |
| `inventory/counts/counts-client.tsx:52, :173, :222` | `finalizedAt`, count `date` | :52 builds a NAME from a date |
| `inventory/expected/expected-client.tsx:149, :151` | `finalizedAt` | |
| `inventory/orders/new/cart-client.tsx:335` | `finalizedAt` | |
| `inventory/purchase-orders/[id]/po-detail-client.tsx:314, :318` | `expectedAt`, `orderedAt` | |
| `inventory/purchase-orders/purchase-orders-client.tsx:275, :278` | `expectedAt`, `createdAt` | |
| `inventory/purchase-orders/purchase-orders-client.tsx:102, :103` | **week / month grouping** | **LOGIC — see §4** |
| `inventory/purchase-orders/purchase-orders-client.tsx:131, :139, :140, :141` | CSV export filename + cells | export, see §4 |
| `inventory/counts/[id]/finalize-dialog.tsx:38` | seeds a `datetime-local` input | **LOGIC — see §4** |
| `inventory/counts/[id]/finalize-dialog.tsx:93` | a placeholder month name | cosmetic |

**Reading of the split: the defect is not evenly spread.** Of the six ★
signature-time sites, three are client (correct) and three are server (wrong),
and two of those pairs sit on the same screen. That is exactly why the symptom
presents as "two tabs disagree" rather than "dates are wrong".

---

## 2. Where a timezone could come from on a server component

Enumerated as asked, with what the codebase can support **today, with no new
schema**.

| Option | Supported today? | Assessment |
| --- | --- | --- |
| **A. `Store.timezone` of the staff member's primary store** | **YES — no schema** | The convention the rest of the app already uses. Multi-tenant by construction: a Nevada store renders Pacific, a New Mexico store Mountain. Resolution is already deterministic and already shared — `isPrimary` desc, then `store.name` asc (`src/lib/hr.ts:23`, mirrored `hr-compliance.ts:257`), with `primaryStoreName()` as the exemplar. **Recommended.** |
| **B. `Organization`-level timezone** | needs a column | `Organization` has NO timezone (checked field by field). It does carry `hrDateStampFormat` (`schema:25`), so an org-level *display* setting has precedent. But a single org zone is exactly what the Denver comment forbids, and Keva is the case: Nevada + New Mexico. Only useful as a FALLBACK. |
| **C. A request header / `Intl` guess on the server** | no | There is no timezone header. Vercel offers `x-vercel-ip-timezone` on some plans, but it is the *reader's network location*, not the store's — a manager on holiday in London would see different dates for the same signature. It also cannot be reproduced in a test. Rejected. |
| **D. Render raw, format on the client** | YES — no schema | Push every timestamp to a `"use client"` boundary. Correct in the viewer's zone, but it means the same signature reads differently to a Nevada manager and a New Mexico manager, and it needs a hydration-safe pattern for every one of 22 sites. It also answers a *different question* than A: "when was it, where I am" rather than "when was it, where it happened". Rejected on the second ground, not the first. |
| **E. Store the zone on the record at write time** | needs a column | Belt-and-braces: stamp `HrSignedRecord.capturedTimeZone` at mint. Genuinely the most durable answer for legal artifacts — a store that later changes timezone would not retroactively move old signatures. Additive. **Not needed for this row; worth a follow-up row.** |
| **F. `UTC`, labelled** | YES | i.e. keep the current behaviour but write "UTC" next to it. Honest, and it is what the certificate does. Wrong for screens: it makes every reader do arithmetic. |

**Recommendation: A, with B as a fallback that does not exist yet — so in
practice A with a hard-coded final fallback.**

The gap in A is **corporate staff**: `StaffMember.isCorporate` (`schema:289`)
means no store assignment, so there is no primary store to read a zone from.
`primaryStoreName()` already handles this by returning a `CORPORATE_STORE_LABEL`
rather than null, so there is an established shape for the case — but there is no
zone behind it. Options for that tail, in order of preference:

1. Fall back to the org's **most common store timezone** (computable today, no
   schema, and correct for a single-region franchise).
2. Add `Organization.timezone String @default("America/Los_Angeles")` — additive,
   one column, matches the `hrDateStampFormat` precedent, and gives corporate
   staff and org-wide screens (`/hr/compliance` totals, `/users`) a defensible
   answer.

**Option 2 is the only place this row might want schema, and it is one additive
column with a default. Gary's call.** Everything else is achievable with zero
schema change.

---

## 3. Does `Store` or `Organization` already carry a timezone?

**`Store` — YES.** `prisma/schema.prisma:140`,
`timezone String @default("America/Los_Angeles")`. Editable in the UI
(`stores/store-actions.tsx:285`, backed by a `TIMEZONES` constant at :42),
populated from Square on import (`import-square-button.tsx:66` —
`loc.timezone ?? "America/Los_Angeles"`), and displayed on the stores page
(`stores/page.tsx:394`).

**`Organization` — NO.** No timezone field. It carries `hrDateStampFormat`
(`schema:25`) — precedent for an org-scoped display setting, not a zone.

**This is the answer that changes the whole shape of the row**, exactly as Gary
suspected it might. The row can be built on an existing, populated, admin-editable,
Square-synced column, and on four helpers that already exist and are already
trusted by the forecasting and labor code.

---

## 4. Dates used for LOGIC, not display

The dangerous class. Findings, worst first.

**None of them is currently broken by the client/server split**, which is worth
stating plainly — but two are fragile and one is a latent mis-bucket.

### 4.1 `hr-compliance.ts:564` — the overdue boundary — SAFE, but fuzzy

```ts
else if (a.dueDate && a.dueDate < now) status = "overdue"
```

An **instant vs instant** comparison. Both are UTC `Date` objects, so the
comparison itself is zone-independent and cannot mis-bucket. It is safe.

What is fuzzy is upstream: `dueDate` is written as
`new Date("<yyyy-mm-dd>T12:00:00").toISOString()`
(`bulk-assign-dialog.tsx:159`, `staff-training.tsx:156`) — parsed in **the
creating admin's browser zone**, and pinned to **NOON**. The noon hedge is what
makes it safe: a ±12h zone error cannot move a due date across a day boundary,
which is presumably why it was written that way. But an assignment created by a
Nevada admin and one created by a New Mexico admin for the same nominal day are
stored an hour apart. **Nothing to fix here; do not "clean it up" — the noon
offset is the guard.**

### 4.2 `purchase-orders-client.tsx:102-103` — week/month grouping — VIEWER-DEPENDENT

```ts
if (groupBy === "week") return `Week of ${format(startOfWeek(anchor, { weekStartsOn: 1 }), "MMM d, yyyy")}`
```

Client-side, so it buckets in **the viewer's** zone. A PO created Sunday 6 PM
Mountain is Monday UTC; two managers in different zones can see it in different
weeks. Real, pre-existing, **inventory not HR**, and no screen shows the
disagreement. Not this row — but it is the second-order form of exactly this
bug, and it is the one that would survive a fix aimed only at the 22.

### 4.3 `finalize-dialog.tsx:38` — seeds a `datetime-local` input

```ts
useState(format(lastEditAt ?? new Date(), "yyyy-MM-dd'T'HH:mm"))
```

Formats an instant into a local wall-clock string, which is then submitted and
re-parsed. Correct today because it is client-side on both ends. It would break
if this component were ever server-rendered. Flag, do not touch.

### 4.4 The store-local logic that is ALREADY CORRECT — leave alone

`businessDayWindow` / `localDateStr` are used correctly at, among others:
`checklists/page.tsx:72-82`, `api/checklists/route.ts:37-40, :111, :165, :218`,
`reports/operations/page.tsx:156, :244, :257`, `forecasting/page.tsx:53`,
`api/labor/weekly-plan/route.ts:87`, `api/dashboard/*`. These read
`Store.timezone` per store and bucket per store. **This is the model the fix
should copy, and none of it should be modified.**

### 4.5 Instant comparisons that are safe

`my/page.tsx:64` (`pinnedUntil > now`), `lib/messages.ts:101`
(`expiresAt > new Date()`). Instant vs instant. Safe.

### 4.6 Export stamps

`training-export-button.tsx:22` (`new Date().toISOString().slice(0,10)`) and
`purchase-orders-client.tsx:131` build **filenames**. Cosmetic. The PO CSV's
`yyyy-MM-dd` cells (:139-141) are client-formatted data cells — mildly
viewer-dependent, same class as 4.2.

---

## 5. The ceremony, the certificate, and the signed-record PDF

**Gary's instinct is right, and there is one inconsistency inside it.**

### 5.1 The certificate — UTC, explicitly labelled. CORRECT. EXEMPT.

`src/lib/hr-signed-pdf.ts:65`:

```ts
function utc(d: Date): string {
  return d.toISOString().replace("T", " ").slice(0, 19) + " UTC"
}
```

The per-checkpoint capture table is headed **`"SIGNED AT (UTC)"`** (`:570`) and
each row is a `utc()` stamp (`:628`). This is textbook: an unambiguous,
labelled, absolute instant on a legal artifact. **It stays exactly as it is, and
it is exempt from the mechanism.** Nothing else in the app should copy it,
because nothing else carries the label that makes it honest.

### 5.2 The inline `Date:` field stamp — UTC, **UNLABELLED**. INCONSISTENT.

`src/lib/hr-signed-pdf.ts:72`:

```ts
function formatDateStamp(d: Date, format: string): string {
  return format === "dateTime" ? utc(d) : d.toISOString().slice(0, 10)
}
```

Driven by `Organization.hrDateStampFormat` (`:420`), default **`"dateOnly"`**.

The `dateTime` branch is fine — it is `utc()`, labelled. **The `dateOnly` branch
is the defect on paper.** `toISOString().slice(0,10)` is a bare UTC calendar
date with no zone marker, stamped into the document body next to the signer's
name — the "Date:" line a human fills in.

On the anchor case: Gdogg signs at **21:06 PDT on Aug 15**, and the document
would be stamped **`2026-08-16`**. Not labelled UTC, not the day he signed, and
sitting on the executed artifact where it is hardest to correct later.

**This is the sharpest instance of DEBT-70 in the codebase**, and it is not in
the 64 — it does not use `date-fns`, so the original sweep could not see it.

Note the asymmetry that makes it worse than the screens: a screen can be
re-rendered after a fix; **a minted PDF cannot.** Every certificate produced
between now and the fix carries whatever this decides.

### 5.3 The ceremony screen — client, live clock. CORRECT.

`signing-client.tsx` renders `new Date()` and its own captured `time` values in
the signer's browser (7 sites, §1b). The signer sees their own clock while
signing, and the certificate independently records UTC. The two are meant to
differ, and both are right.

### 5.4 The answer to the question as asked

> "my instinct is it stays UTC and is exempt. Tell me if that's inconsistent
> with anything else."

The certificate is exempt and consistent — **with one exception that is not the
certificate.** The unlabelled `dateOnly` inline stamp is neither a court-facing
UTC record (no label) nor a human-facing local date (wrong day). It is the one
place where "UTC, exempt" and "the human's day" collide with no third answer, and
it needs its own ruling.

---

## 6. Proposed plan — for approval, nothing built

### 6.1 One mechanism

A single module, `src/lib/display-time.ts`, exporting **two** functions,
because §0(b) proved one is not enough:

```ts
formatInstant(at: Date, timeZone: string, style): string   // signature times, createdAt
formatCivilDate(at: Date, style): string                   // Checklist.date — UTC container
```

Both wrap `Intl.DateTimeFormat` with an explicit `timeZone` (`"UTC"` for the
civil case). Both live beside the existing four helpers in spirit and cite them.
No per-file judgement: the choice is not "which zone" but "which KIND of value",
which is a property of the column and is documented once.

### 6.2 Where the zone comes from

`resolveDisplayTimeZone(staffOrStore)` — one resolver, in the same module:

1. the staff member's primary store's `timezone` (`isPrimary` desc, name asc —
   the existing shared rule)
2. → for corporate staff and org-wide screens, the org fallback (§2)
3. → `"America/Los_Angeles"`, the same default the column already carries

**The org fallback is the one open question needing Gary's ruling** — computed
most-common-store-zone (no schema) versus one additive
`Organization.timezone` column. Recommendation: **the column.** It is one
additive field with a default, it matches `hrDateStampFormat`, it is explicit
rather than derived, and "most common store zone" silently changes when a store
is added.

### 6.3 Scope of edits

- **21 of the 22 server sites** move to `formatInstant` with a resolved zone.
- **Site 22 (`checklists/page.tsx:191`) moves to `formatCivilDate`** — a no-op in
  behaviour, and the point is that it becomes *stated* rather than accidentally
  right.
- **The 42 client sites**: convert the ones that render a *record's* timestamp to
  the same mechanism, so the value does not depend on who is looking. Leave the
  7 live-clock ceremony sites alone — those are genuinely the signer's own clock.
  This is the half that makes it "one mechanism" instead of "the server half
  patched".
- **The certificate is untouched.** The unlabelled `dateOnly` stamp is raised
  separately (§5.2) and is Gary's ruling, not this plan's.

### 6.4 What I would NOT do

- Not `x-vercel-ip-timezone`. Not reproducible, and it answers the wrong question.
- Not a blanket "everything store-local" — §0(b).
- Not touch 4.1's noon hedge, 4.4's existing store-local logic, or the certificate.
- Not fix 4.2 (PO week grouping) in this row — real, inventory, its own row.

### 6.5 Verification, per the brief

The anchor case across four surfaces, using Gdogg (UTC and local dates
*differ* — `2026-08-16 04:06 UTC` = `2026-08-15 21:06 PDT`), plus the civil-date
regression on `/checklists` which is the one that would catch an over-broad fix,
plus `HrSignedRecord` / `HrDocumentAcknowledgment` counts before and after.

### 6.6 Rulings needed before any file is touched

1. **Org fallback**: additive `Organization.timezone` column, or computed
   most-common-store-zone? (Recommend: the column.)
2. **Scope**: server-only (22 sites), or server + record-rendering client sites
   (~55)? The brief's "one mechanism, used everywhere" implies the latter;
   confirm, because it roughly doubles the diff.
3. **The unlabelled `dateOnly` PDF stamp** (§5.2) — store-local day, labelled
   UTC, or left alone? It is on minted artifacts, so the answer applies going
   forward only.
