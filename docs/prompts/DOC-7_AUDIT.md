# DOC-7 — Annual re-sign: audit

**TIER 3.** Read-only. Written 2026-10-28 by the DOC-7 session at `aeda979`
(`staging` = `main` = `origin/staging` = `origin/main`; tree clean except
`docs/prompts/DOC-7.md`). No file other than this one was written. No prisma
command and no database query was run in this phase.

Everything below is from reading code at `aeda979`. File:line references are to
that commit. The signing write path and the consumer sweep were gathered by a
read-only sub-agent; the load-bearing claims (ack route `skipDuplicates`,
`ensureSignedRecord` early return, `recordRef` hash, DOC-8 set stamp, digest
window, `/my/documents` data derivation) were re-read by hand before this file
was written.

---

## 0. The fact that decides everything: the schema forbids a second signature

A person cannot sign the same version twice in one tenure today. That is a
**database** rule, not a UI rule:

- `HrDocumentAcknowledgment` — `@@unique([checkpointId, hrDocumentVersionId, staffMemberId, signingCycle])`
  (`prisma/schema.prisma:2544`).
- `HrSignedRecord` — `@@unique([hrDocumentVersionId, staffMemberId, signingCycle])`
  (`prisma/schema.prisma:2566`), commented "one per (version, staff)" (`:2549`).

And every write path leans on those keys:

- `POST /api/hr/documents/[id]/acknowledgments` builds rows from whatever the
  client sent and inserts with `createMany({ skipDuplicates: true })`
  (`src/app/api/hr/documents/[id]/acknowledgments/route.ts:310-317`). A second
  submission by a signed person is **silently skipped**, the completion check at
  `:321-336` still sees every checkpoint, and the route returns 201
  `complete: true` with the OLD record.
- `ensureSignedRecord` (`src/lib/hr-signed-pdf.ts:316`) early-returns the
  existing record via `findUnique` on `hrDocumentVersionId_staffMemberId_signingCycle`
  (`:337-342`). Its race catch re-reads the same key (`:805-814`).
- The stamp's "Record XXXX" reference is `sha256(version:staff:cycle)`
  (`hr-signed-pdf.ts:508-512`), so two records in one cycle would print the same
  reference.

The only thing that ever opens a new key today is `StaffMember.signingCycle`,
bumped in one place — reactivation (`src/app/api/staff/[id]/reactivate/route.ts:94`)
— and it is **per person, across every document**.

So "the document is owed again" has two halves, and a design that solves only
the first is unbuildable:

1. **Saying it is owed** — a compliance-engine question.
2. **Letting it be signed** — a key question. Without a new key component,
   the person opens the ceremony, sees "executed" (`signing-client.tsx:115-118`,
   `:317-335`), and a forced POST is a no-op.

---

## 1. Representation — how an expired signature reopens the document

### Options and what each costs

**A. Reuse HR-15b's cycle (bump `StaffMember.signingCycle`).** Rejected. The
cycle is per person, not per document: bumping it on one anniversary reopens
**every** document they have signed, makes them all needs-resign, and moves
their rehire clock (`documentDueState` reads `signingCycle > 1 && rehiredAt`,
`hr-compliance.ts:754-756`). It also misrepresents a tenure that did not end.

**B. A per-(document, person) renewal number on acknowledgments and signed
records, with "expired" computed on read. LEAN.**

- Schema: `renewal Int NOT NULL DEFAULT 0` on `HrDocumentAcknowledgment` and
  `HrSignedRecord`; both unique keys widened to include it. **This is exactly
  HR-15b's migration shape**: `20260723180000_hr15b_signing_cycles` dropped
  both unique indexes and recreated them with `signingCycle`, a
  `NOT NULL DEFAULT 1` column (migration lines 2, 5, 18, 21). Every existing row
  lands on `renewal = 0`, so the widened key enforces exactly what the old one
  did on today's data.
- Nothing about expiry is stored. The engine computes, per (document, member),
  the **governing record** (the member's latest this-cycle record on the
  document, any version — R2) and its **anniversary**; past it, the document is
  owed at `renewal + 1`.
- Signed records stay append-only: a re-sign mints a NEW `HrSignedRecord` under
  the new renewal number and never touches the old one (ruling 7).
- Cost: two `NOT NULL DEFAULT 0` columns and two index swaps — **which
  contradicts the prompt's "additive, nullable only"** (§ 11 (c), fork F1). And
  every reader keyed (version, staff, cycle) must learn the renewal: the
  enumeration is in § 4 and § 10. Eleven sites.

**C. Computed "expired" state only, no new key.** The engine can say "owed",
but nobody can discharge it — the ack route skips every row, `ensureSignedRecord`
returns the old record, and the ceremony renders "executed". Unbuildable on its
own; it is half of B.

**D. A new version per re-sign (Case A shape).** Rejected. Case A is a
per-DOCUMENT event and re-prompts everyone at once; ruling 2 wants per-PERSON
anniversaries. It would also flood the version history with byte-identical
uploads.

**E. A separate lightweight "I re-confirm" table.** Rejected. It produces no
signed record (contradicts ruling 7) and is a second signing mechanism beside
the ceremony — the drift class `lib/hr-completion.ts` was written to end.

### One source of truth — the part that is NOT already true

The prompt asks for one source of truth for every compliance surface. **Today
there are three derivations of the completion facts**, each feeding the shared
pure predicate `documentCompletion()` (`src/lib/hr-completion.ts:222-247`):

| Site | Facts derived at |
|---|---|
| `computeStaffComplianceDetails` | `src/lib/hr-compliance.ts:511-568` |
| `/staff/[id]` Documents tab | `src/app/(app)/staff/[id]/page.tsx:250-309` |
| `/my/documents` | `src/app/(my)/my/documents/data.ts:83-142` |

The predicate is shared; the fact-building is not. Plus two ceremony pages
derive "done" and "has record" for themselves
(`src/app/(app)/hr/acknowledge/[documentId]/page.tsx:178-197`,
`src/app/(my)/my/documents/[documentId]/page.tsx:84-103`).

**Lean:** one new pure module, `src/lib/hr-resign.ts`, exporting the renewal
view for one (document, member) from rows already loaded:

```
renewalView({ records, acks, intervalMonths, setAt, timeZone, today, cycle })
  → { governing: { renewal, completedAt, versionId } | null,
      anniversary: "YYYY-MM-DD" | null,
      expired: boolean,          // today > anniversary
      inWindow: boolean,         // 0 <= daysToAnniversary <= 30
      owedRenewal: number }      // the renewal a signature made NOW is written under
```

Every site above calls it and filters its acks/records to the renewal it names
before building the facts it already builds. The predicate gains ONE fact,
`hasExpiredRecord` (§ 1, next), so status is still decided in one function.

### How expiry enters the predicate

`documentCompletion` already has the precedence slot: a prior-cycle record
yields `needs-current` (the rehire arm). An expired this-cycle record means the
same thing in plain words — "signed before, owes it again" — but reusing the
rehire booleans would lie to every reader that distinguishes a rehire (Case A's
`reacknowledgmentRequired` exists precisely to separate them,
`hr-completion.ts` result type). So:

- New fact `hasExpiredRecord: boolean`, same precedence as the prior-cycle arms
  → `needs-current`, with a new result flag `renewalDue: true` beside
  `reacknowledgmentRequired`.
- When expired, the "current record" facts are asked at `owedRenewal`, which
  has no record by definition, and `ackedCount` / `allRequiredAcked` are counted
  over `owedRenewal`'s acks only. So a re-sign that is fully acked but whose mint
  failed is `recordMissing` — the existing R1 path, unchanged — and a part-done
  re-sign reads "2 of 7 checkpoints".
- DOC-8 F4 then turns it `overdue` (§ 2), so in practice an expired item is
  never seen as plain needs-resign.

**Documents without the setting are untouched by construction:** with no
interval, `owedRenewal = governing.renewal` (0 for every existing row),
`expired` is always false, and the filtered acks/records are exactly today's
sets. § 9's snapshot proves it on dev.

---

## 2. Clock

**The anniversary IS the due date. "Sign within N days" plays no part once a
re-sign is due** (the lean the prompt states — agreed). Reason: DOC-8's
`documentDueState` (`hr-compliance.ts:740-768`) answers "when does a FIRST
obligation start" (hire, grant, set stamp, Case A upload). A re-sign is not a
new obligation start; it has a fixed date already.

Computation, whole member-local days, DOC-8's discipline:

```
signedDay   = localDateStr(governing.completedAt, member display zone)
floorDay    = addDays(localDateStr(reSignEveryMonthsSetAt, zone), 30)   // ruling 6
anniversary = max(addMonthsClamped(signedDay, N), floorDay)
expired     = today > anniversary          // valid THROUGH the anniversary day
dueDate     = anniversary  (only when expired, on the item's existing field)
```

- Valid through the end of the anniversary day; overdue from member-local
  midnight after it. Identical to DOC-8's "due through the end of its due day"
  (`hr-compliance.ts:721-726`), so "Was due {anniversary}" from
  `documentDueLabel` (`src/lib/hr-due-wording.ts:17-24`) is correct with no new
  wording.
- `governing.completedAt` is the record's completion instant
  (`schema.prisma:2556`), i.e. when the last required checkpoint was signed —
  not `generatedAt`.
- The floor needs **no stamp per person**: it is the document's set stamp + 30.
  Signatures made after the setting goes on always land later than the floor
  (N ≥ 6 months > 30 days), so the floor is inert for them forever and never
  needs clearing.
- Set stamp rules mirror DOC-8 F5 (`src/app/api/hr/documents/[id]/route.ts:113-129`):
  null → N stamps now; N → M keeps the stamp; N → null clears both. Fork F6.

**Interaction with DOC-8's own clock.** If an item is expired AND also owed for
another reason (a Case A version uploaded since they signed), the due date is
the **earlier** of the anniversary and the DOC-8 date (when the document has a
"sign within"). Fork F7, minor.

**`addMonthsClamped` does not exist.** `lib/milestones.ts` has only
`addDays`/`daysBetween` on "YYYY-MM-DD" (`:90-98`); there is no month helper in
`src/lib`. `date-fns` is a dependency (`package.json:44`) but works on `Date`
objects, which drags the zone back in. Lean: a pure string function beside
`addDays`, clamping to the last day of the target month (date-fns' rule).

| Signed (local) | N | Anniversary |
|---|---|---|
| 2026-01-31 | 6 | 2026-07-31 |
| 2026-08-31 | 6 | 2027-02-28 |
| 2027-08-31 | 6 | 2028-02-29 (leap) |
| 2028-02-29 | 12 | 2029-02-28 |
| 2028-02-29 | 24 | 2030-02-28 |
| 2026-01-31 | 12 | 2027-01-31 |

A member whose display zone changes (store transfer) can see the anniversary
move by one day. Same accepted cost as DOC-8; named, not solved.

---

## 3. Rulings 3 and 4 — the notice and the early re-sign

### Ruling 3 — "Re-sign due in d days" without moving any total

The notice belongs on a **complete** item. DOC-8 deliberately nulls `dueDate`
on complete items (`hr-compliance.ts:586-588`), and four consumers treat a
non-null `dueDate` as "open and owed":

- the digest window (`src/lib/hr-doc-digest.ts:61-63`),
- the banner's `nearestDueDate` (`hr-compliance.ts:902-923`),
- DOC-13's sort (`src/lib/hr-due-order.ts`),
- By Document's badge wording.

**Lean: two NEW item fields, `reSignDueDate` / `reSignDaysUntilDue`, set only on
a complete item inside the 30-day window, null everywhere else.** `dueDate`
keeps its DOC-8 meaning. Nothing that reads `dueDate` or `status` changes, so
`requiredTotal`, `completedCount`, every pct, and the MS-3 raise gate
(`src/lib/raise-eligibility.ts:317-330` reads only `status !== "complete"`) stay
put by construction.

Wording in `hr-due-wording.ts`, a sibling of `documentDueLabel`:
"Re-sign due in 12 days" / "Re-sign due tomorrow" / "Re-sign due today", in
an informational colour (not amber, not red).

Where it renders (see § 4 for each): `/my`, `/my/documents` Completed row,
`/staff/[id]` Compliance and Documents tabs, `/hr/compliance` per-staff and
By Document. NOT the dashboard banner, which is owed-only and hides at
`openCount 0` (`src/app/api/dashboard/my-compliance/route.ts:55-67`).

### Ruling 4 — early re-sign: needs a path; none exists today

Today a signed person has no way back in:

- `/my` lists only `status !== "complete"` (`hr-compliance.ts:862-864`,
  `src/app/(my)/my/page.tsx:86`).
- `/my/documents` links only pending rows (`src/app/(my)/my/documents/page.tsx:127-152`);
  Completed rows are non-link divs (`:177-239`).
- The ceremony opens in phase "done" when a record exists
  (`src/app/(app)/hr/acknowledge/[documentId]/signing-client.tsx:115-118`),
  with every checkpoint pre-filled and disabled (`:133-136`, `:528`, `:569`,
  `:879`).
- A forced POST is silently skipped (§ 0).

Path, all keyed off `renewalView().owedRenewal`:

1. **Entry.** In the window, the notice is a link — "Re-sign now" — to
   `/my/documents/[documentId]`, on `/my` and the `/my/documents` Completed row.
2. **Ceremony pages** (both, § 4) compute `hasSignedRecord` and each
   checkpoint's `done` at `owedRenewal`. In the window that is a renewal with no
   acks, so the ceremony opens fresh at "consent". Outside the window it is the
   governing renewal, so "executed" renders exactly as today.
3. **Ack route** writes `renewal = owedRenewal`, **computed server-side** from
   the same function and never accepted from the client; the completion check at
   `:321-324` adds the renewal; `ensureSignedRecord` takes it.
4. Outside the window and still valid, `owedRenewal = governing.renewal` →
   today's no-op, byte for byte.

Mid-way state: a re-sign started in the window and abandoned leaves partial acks
at `renewal + 1`. While the governing record is valid they are invisible (the
item is complete). Once it expires they become the "2 of 7" progress of the
owed re-sign. No orphan state.

---

## 4. Every consumer

Engine-fed surfaces get the new behaviour from `computeStaffComplianceDetails`
for free. Surfaces with their own derivation must adopt `renewalView`.

| Surface | Source | What changes |
|---|---|---|
| `/hr/compliance` per-staff | `getOrgComplianceRollup` → engine | Expired = overdue, counted like any overdue item. Notice text beside a complete badge in the window. |
| `/hr/compliance` By Document | `pivotComplianceByDocument` (`hr-compliance.ts:1237-1300`) — a pivot of the same items | Carry the two notice fields on `DocumentCompliancePerson`, the DOC-8 `dueDate` pattern. **DOC-2 invariant holds structurally**: the pivot counts the same `status` values from the same array, so per-document = per-staff whatever the engine decides. Fixture asserts it anyway. |
| `/dashboard` banner | `summarizeOwed` (`hr-compliance.ts:902-923`) | Expired items join `openCount`/`overdueCount`, and their anniversary can be "Nearest due". Notice: none (banner is owed-only). No code change. |
| `/staff` Compliance column | `summariesFromDetails` (`hr-compliance.ts:819-830`; `src/app/(app)/staff/page.tsx:91-94`) | pct falls when a re-sign expires, not before. No code change. |
| `/my` | `openItemsInDueOrder(openComplianceItems(…))` (`src/app/(my)/my/page.tsx:86`) | Expired items appear as overdue in DOC-13 order with "Was due {anniversary}". NEW: a quiet "Coming up" line under the open list for complete items in the window, linking to the ceremony (ruling 4). "You're all caught up" logic unchanged (fork F8). |
| `/my/documents` | own derivation, `data.ts:83-142` | **Adopt `renewalView`** (filter records/acks to the governing or owed renewal). An expired document moves to "To sign" with DOC-13's due wording. Completed rows in the window get the notice + "Re-sign now". The "Signed records" list (`page.tsx:68-77`) shows every record, so history accumulates (ruling 7). |
| `/my/documents/[documentId]` ceremony | own derivation, `page.tsx:84-103` | Compute `done` and `hasSignedRecord` at `owedRenewal`. |
| `/hr/acknowledge/[documentId]` ceremony (attested) | own derivation, `page.tsx:178-197` | Same. `AcknowledgeClient` submits only pending entries (`acknowledge-client.tsx:83`, `:110-124`), so a manager attesting a re-sign works once `done` is per renewal. |
| `/staff/[id]` Documents tab | own derivation, `src/app/(app)/staff/[id]/page.tsx:250-309` | **Adopt `renewalView`.** Today `currentRecord = find(cycle)` over records ordered `[signingCycle desc, completedAt desc]` (`:250-253`, `:270-272`) would pick the newest record by luck; make it explicit. Ack set unioned per cycle (`:274-278`) must filter by renewal. DOC-13's due copy comes from the engine (already wired). Download link points at the governing record. |
| `/staff/[id]` Compliance tab | engine | Notice + overdue as `/hr/compliance`. DOC-13 order unchanged. |
| Milestones raise gate (MS-3) | `documentsCriterion` reads `status` only (`raise-eligibility.ts:317-330`) | **No change.** In the window: complete, gate unaffected (ruling 3's purpose). Expired: not complete, blocks — DOC-8 F6's rule (any unsigned required document blocks) carried over. |
| NOTIFY-14 digest | `inDigestWindow` (`hr-doc-digest.ts:61-63`) over `getOrgComplianceRollup` | Expired re-signs appear as overdue automatically (they carry `dueDate`). Upcoming re-signs: **fork F4.** |

### The digest fork (F4)

Ruling 3 says an upcoming re-sign is not owed, and the digest's own title is
"documents to sign". Its window is "open item with a due date ≤ 3 days away".

- **Lean: exclude.** Upcoming re-signs carry no `dueDate`, so they stay out
  with zero digest code. They enter the day after the anniversary, as overdue.
  The person and their managers already see the 30-day notice on every surface
  above. Cost: a manager's first email about a lapsed re-sign is an overdue line.
- Alternative: a third digest section, "Re-sign due soon", reading
  `reSignDaysUntilDue <= 3`. Cost: a new section in the template and plain-text
  part, a change to `digestIsEmpty` (`hr-doc-digest.ts:149-151`), and a digest
  that now emails about documents that are, by ruling 3, complete.

---

## 5. Key holder register (DOC-6)

`isHolding` (`src/lib/hr-returns.ts:46-59`) takes the max over **every** signed
record's `completedAt` on the document, across all versions and cycles
(`:207-214`), and DOC-6 R1 says a signature after a Returned **re-issues on its
own** (`:43-44`). So, unchanged, an annual re-sign of a Key Agreement by
someone who returned their key would put them back in the register as holding.
That changes who holds a key, which the prompt forbids.

Also: the register's Field values (the key number) are loaded by
`OR: [{ hrDocumentVersionId, staffMemberId, signingCycle }]` (`:217-235`,
filtered `:268-276`), so two renewals on one version would list the key number
twice.

**Fork F5. Lean:** a record with `renewal > 0` is **not an issue**. `isHolding`
reads only renewal-0 records (a first signing in a version/cycle — which keeps
DOC-6 R1 intact for real re-issues: a rehire's new cycle and a Case A version
are both renewal 0). The register's issue date, version and Field values come
from the latest renewal-0 record, ack load filtered by that record's renewal.
A renewal re-confirms an agreement; it does not hand over a key.

Alternative: the register shows "Last re-confirmed {date}" from the latest
renewal as an extra line. Display only; not needed to keep holding correct.

---

## 6. Signed Records (SIGNED-1) and everything that assumed one record

From the sweep (§ 0 and the agent's item 3), what assumes one record or one ack
set per (person, version, cycle), and what must change:

| Reader | Assumption | Change |
|---|---|---|
| `hr-signed-records-list.ts` list + facets (`:56-59`, `:93-120`, `:162-190`) | none — one row per record, cursor tie-break on id | **No change.** Each re-sign is a new row and counts in the facets; that is ruling 7. Optional "Re-sign" chip on renewal > 0 rows (display only). |
| `ensureSignedRecord` (`hr-signed-pdf.ts:316-816`) | early return + ack load + race catch on (version, staff, cycle) (`:337-342`, `:377-382`, `:805-814`) | Takes `renewal`; all three keyed by it. |
| Certificate of Acknowledgment + stamps (`hr-signed-pdf.ts:380-382`, `:425-449`, `:547-566`, `:599-745`) | ack Map per checkpoint, last row wins, no `orderBy` | Filtered by renewal, the certificate is one signing's evidence. Without the filter two signings would MERGE per checkpoint nondeterministically. |
| Stamp `recordRef` (`hr-signed-pdf.ts:508-512`) | hash of version:staff:cycle | Append `:renewal` **only when renewal > 0**, so a renewal-0 mint hashes exactly as today. |
| HR-16 email (`src/lib/hr-ack-notification.ts:111-139`) | acks by the record's (version, staff, cycle) | Add the record's renewal. Dedupe is by record id (`:150-157`), so one email per re-sign — correct. |
| `hr-returns.ts` | § 5 | § 5. |
| `/staff/[id]`, `/my/documents` data, both ceremony pages | § 4 | § 4. |
| `computeStaffComplianceDetails` (`hr-compliance.ts:390-425`) | records into last-write-wins maps (no `orderBy`); acks unioned per cycle | `renewalView` per (doc, member), then filter. |
| Staff DELETE (`src/app/api/staff/[id]/route.ts:216-235`) | `count > 0` | No change. |
| Version freeze / checkpoint delete counts (`hr/documents/[id]/page.tsx:38,55`; `versions/[versionId]/route.ts:76-86`; `checkpoints/[checkpointId]/route.ts:24,78`) | `> 0` | No change. |
| Record-by-id readers (`/my/documents/records/[recordId]`, `api/my/signed-records/[recordId]`, `api/hr/signed-records/[id]/download`) | by id | No change. Blob names use `addRandomSuffix` (`hr-files.ts:97`), so no file collision. |

**Coverage, CLAUDE.md § Verifying a guard covers every path.** Enumerated by
component and model, not by guard name:

- Renderers of `SigningClient` / `AcknowledgeClient`: **2** — the two ceremony
  pages above, including the cross-route-group importer
  `/my/documents/[documentId]`.
- Writers of `HrDocumentAcknowledgment` / `HrSignedRecord` in `src/`: **2** —
  the ack route and `ensureSignedRecord`. `ensureSignedRecord` callers: **2** —
  the ack route and `POST /api/hr/documents/[id]/signed-record` (`route.ts:105`,
  the recovery button shown only when `recordMissing`,
  `staff-documents.tsx:205-206`).
- Completion-fact derivations: **3** (§ 1 table).
- Compound-key accessor uses: **2** (`hr-signed-pdf.ts:339`, `:810`).

The recovery route needs the renewal too: it must mint at `owedRenewal`,
otherwise "Generate record" for a failed re-sign returns the old record.

---

## 7. Admin UI

**Where:** `EditDocumentButton` in `src/app/(app)/hr/documents/documents-client.tsx`
(starts `:817`). "Sign within (days)" renders at `:946-967` (label `:948`,
input `:949-958`, help `:960-965`), gated `canHaveDueDate = doc.kind === "Acknowledgment"`
(`:843`), sent only when changed (`:880`). "Re-sign every" goes directly beneath
it, inside the same gate, above Tracks return (`:968`).

**Control:** a select, not a number — Never / 6 months / 12 months / 24 months
(ruling 1's three choices). Row type `:97`, page map
`src/app/(app)/hr/documents/page.tsx:115`.

**PATCH** (`src/app/api/hr/documents/[id]/route.ts`): zod
`reSignEveryMonths: z.union([z.literal(6), z.literal(12), z.literal(24)]).nullable().optional()`
beside `:44`; 400 on a non-Acknowledgment like `:107-112`; set stamp exactly as
`:113-129`.

**Create route:** not touched (fork F2 — no category default in this phase).

**Help text (draft, ruling 6):**

> Each person re-signs this many months after their own latest signature.
> In the last 30 days they see "Re-sign due" — their signature still counts
> until the date passes. Turning this on never makes anyone overdue right away:
> anyone whose signature is already older gets 30 days from today.

**Library badge (implementation choice, display only):** a small "Re-sign
yearly" / "every 6 months" / "every 2 years" label on the `/hr/documents` row,
so an admin can see which documents carry it without opening each one.

---

## 8. Timezones and month arithmetic

- **All dates are member-local calendar days**, from `displayTimeZone(member, org)`
  (`hr-compliance.ts:440-441`), the zone DOC-8 already resolves per member.
- `completedAt` and `reSignEveryMonthsSetAt` are `TIMESTAMP(3)` without zone,
  meaning UTC (CLAUDE.md § Database Evidence). Both go through `localDateStr(at, zone)`
  before any arithmetic. Never `.toISOString().slice(0,10)` on these: that is
  only valid on `@db.Date` (`milestones.ts:83-88`).
- Month arithmetic is on the local day string, clamped (§ 2 table). Jan 31 → Jul 31
  (6 months), Aug 31 → Feb 28/29, Feb 29 + 12 → Feb 28.
- "Valid through the anniversary day" — overdue at local midnight after, as DOC-8.
- The notice window counts days with `daysBetween(today, anniversary)`: 30 → "in
  30 days", 0 → "today".

---

## 9. Regression method (Phase 2)

DOC-8's method, repeated: before the engine change, snapshot every dev org's
`getOrgComplianceRollup(org, { storeIds: null })` to a scratch JSON on dev
(`br-broad-wave-a6vpjdw0`, branch id printed in the same output). After, re-run
and diff. Expected: identical except the two new null fields on every item and
person. Dev documents with the setting at snapshot time: 0 by construction (the
column won't exist).

---

## 10. Interactions (ruling 8)

- **Rehire (HR-15b).** New cycle → no this-cycle records → no governing record →
  no anniversary; the document is needs-resign by HR-15b and the DOC-8 clock (if
  any) dates it. Their new signature is renewal 0 of the new cycle and starts a
  fresh anniversary. The old cycle's renewals stay in Signed Records.
- **Case A (HR-11k).** A new version with `requiresReacknowledgment` makes the
  item needs-current by the existing arm. The fresh signature is on a new
  version, renewal 0 of that version (renewal numbers are compared within one
  version's key, so no collision), and becomes the governing record — the clock
  restarts from it. If the person was also already expired, the due date is the
  earlier of the two (F7).
- **R2 (signed an earlier version this cycle, complete).** The governing record
  is that earlier-version record (§ 1). At expiry they re-sign the **current**
  version, renewal = governing + 1. Under a per-version key that number is
  only cosmetic for the new version; it stays monotonic per document, which
  keeps "latest renewal" readable as "latest signature".
- **Archived document.** Out of compliance by `isActive` (`hr-compliance.ts:1150-1158`)
  — no anniversaries, no notices. Unchanged.
- **Interval turned off.** Stamp cleared; `expired` false; everyone holding a
  record is complete again, as DOC-8's N → null. Fork F6.

---

## 11. Conclusions

### (a) Forks needing a ruling, each with a lean

- **F1 — schema shape.** Lean: `renewal INTEGER NOT NULL DEFAULT 0` on
  `HrDocumentAcknowledgment` and `HrSignedRecord`, and both unique indexes
  dropped and recreated with `renewal` — HR-15b's exact precedent. This is NOT
  "nullable only" (see (c)). Alternative honouring "nullable only": `renewal INT NULL`
  (NULL = original) with hand-written `UNIQUE … NULLS NOT DISTINCT` indexes,
  which Prisma cannot express — they join MIGRATIONS.md § Protected indexes and
  every future `migrate diff` will try to drop them (Hazard 1). A plain nullable
  column under a Prisma `@@unique` would let duplicate originals in, because NULLs
  are distinct — losing the guard `skipDuplicates` relies on.
- **F2 — per document or per category default.** The DOC-7 ROADMAP row says
  "a per-category default re-sign interval"; draft ruling 1 says per document.
  Lean: per document now; a category default copied once at create (DOC-8 F8's
  pattern) filed as its own row.
- **F3 — representation.** Lean: option B (§ 1) — computed expiry, renewal key,
  one shared `renewalView`, one new predicate fact `hasExpiredRecord` →
  `needs-current` + `renewalDue`.
- **F4 — digest.** Lean: exclude upcoming re-signs; overdue ones arrive
  automatically (§ 4).
- **F5 — key register.** Lean: renewal > 0 records are not an issue; register
  data from the latest renewal-0 record (§ 5).
- **F6 — changing or clearing the setting.** Lean: DOC-8 F5 exactly — 12 → 24
  keeps the set stamp (lengthening only helps; shortening can make people
  overdue at once, which is what shortening means); clearing it clears the stamp
  and everyone holding a record is complete again.
- **F7 — expired AND Case A pending.** Lean: due date = the earlier of the
  anniversary and DOC-8's Case A date (when the document has "sign within").
- **F8 — the notice on /my.** Lean: a quiet "Coming up" section under the open
  list ("Re-sign due in d days" + "Re-sign now"), with "You're all caught up"
  still keyed to the open count. Alternative: no notice on /my, only on
  `/my/documents`.
- **F9 — early re-sign outside the window.** Lean: not offered — ruling 4 says
  "inside that 30-day window". A person outside it sees "executed" as today.
- **F10 — which day counts.** Lean: valid through the anniversary day, overdue
  the day after (DOC-8's rule). On the day itself: complete, "Re-sign due today".

### (b) Build plan

**Migration** `<timestamp>_doc7_annual_resign`, generated with
`prisma migrate diff` only. Expected statements (exact index names are Prisma's
to generate):

```sql
ALTER TABLE "HrDocument" ADD COLUMN "reSignEveryMonths" INTEGER,
                         ADD COLUMN "reSignEveryMonthsSetAt" TIMESTAMP(3);
ALTER TABLE "HrDocumentAcknowledgment" ADD COLUMN "renewal" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "HrSignedRecord"           ADD COLUMN "renewal" INTEGER NOT NULL DEFAULT 0;
DROP INDEX "HrDocumentAcknowledgment_checkpointId_hrDocumentVersionId_s_key";
CREATE UNIQUE INDEX … ON "HrDocumentAcknowledgment"
  ("checkpointId","hrDocumentVersionId","staffMemberId","signingCycle","renewal");
DROP INDEX "HrSignedRecord_hrDocumentVersionId_staffMemberId_signingCyc_key";
CREATE UNIQUE INDEX … ON "HrSignedRecord"
  ("hrDocumentVersionId","staffMemberId","signingCycle","renewal");
```

(The last four lines depend on F1.) No backfill. Every existing row lands on
renewal 0 and every existing document on "never expires".

**Files:**

- `prisma/schema.prisma` — the columns and the two `@@unique` changes, with comments.
- `src/lib/milestones.ts` — `addMonthsClamped` beside `addDays`.
- `src/lib/hr-resign.ts` — NEW: `renewalView`, `reSignAnniversary`, constants
  (`RE_SIGN_WINDOW_DAYS = 30`, `RE_SIGN_CHOICES = [6,12,24]`).
- `src/lib/hr-completion.ts` — fact `hasExpiredRecord`, flag `renewalDue`.
- `src/lib/hr-compliance.ts` — select `renewal` on records and acks plus the two
  document columns; `renewalView` per (doc, member); filter; due = anniversary
  when expired (with F7); `reSignDueDate` / `reSignDaysUntilDue` on items and on
  `DocumentCompliancePerson`.
- `src/lib/hr-due-wording.ts` — `reSignNoticeLabel`.
- `src/app/api/hr/documents/[id]/acknowledgments/route.ts` — renewal = `owedRenewal`, server-side.
- `src/lib/hr-signed-pdf.ts` — `ensureSignedRecord(…, renewal)`, keyed ack load,
  race catch, `recordRef`.
- `src/app/api/hr/documents/[id]/signed-record/route.ts` — mint at `owedRenewal`.
- `src/lib/hr-ack-notification.ts` — ack load by the record's renewal.
- `src/lib/hr-returns.ts` — F5.
- `src/app/(my)/my/documents/data.ts`, `src/app/(my)/my/documents/page.tsx`,
  `src/app/(my)/my/documents/[documentId]/page.tsx`, `src/app/(my)/my/page.tsx`.
- `src/app/(app)/hr/acknowledge/[documentId]/page.tsx`.
- `src/app/(app)/staff/[id]/page.tsx`, `staff-documents.tsx`, the Compliance tab component.
- `/hr/compliance` per-staff and By Document client components (notice text).
- `src/app/(app)/hr/documents/documents-client.tsx`, `page.tsx`,
  `src/app/api/hr/documents/[id]/route.ts`.
- `docs/guide/` HR documents page — one paragraph on re-sign.
- `scripts/verify-doc7-annual-resign.ts` — NEW.

**Fixture checks** (dev, throwaway org named `DOC-7 …`, removed and re-queried
afterwards):

1. No setting → items identical to today byte for byte (plus the null fields).
2. Valid signature 20 days from anniversary → complete, pct unchanged, notice
   "Re-sign due in 20 days"; raise gate met.
3. Early re-sign in the window → new record at renewal 1, old record intact,
   anniversary recomputed from the new one, notice gone.
4. Outside the window, still valid → a POST is a no-op (renewal 0, old record
   returned).
5. Anniversary passed → `overdue`, `dueDate` = anniversary, "Was due {Mon D}",
   in overdue totals, banner, DOC-13 order and the digest view; raise gate blocked.
6. Expired, partially re-acked → "k of n" progress; fully re-acked with a failed
   mint → `recordMissing`, no due date.
7. Grandfathering: signatures older than N months at the moment the setting goes
   on → anniversary = set stamp + 30 (notice, not overdue); 31 days later → overdue.
8. Rehire restarts (new cycle, renewal 0); Case A restarts; F7's earlier date.
9. DOC-2: By Document signed/audience counts = per-staff, with expired and
   in-window people present.
10. DOC-6: a re-sign after a Returned leaves the person NOT holding; the
    register's key number is not duplicated.
11. `addMonthsClamped`: Jan 31 / Aug 31 / Feb 29 rows of § 2's table.
12. Digest per the ratified F4.
13. Certificate of a renewal-1 record carries only renewal-1 acks; `recordRef`
    for renewal 0 equals today's formula.
14. PATCH: 400 on non-Acknowledgment; set stamp null → N / N → M / N → null.
    (Route logic by reading + the pure helper; HTTP needs a Clerk session, so it
    goes on Gary's staging plan as DOC-8 did.)

**Deliberate breaks** (each confirmed red, then restored): drop the renewal
filter on acks (3/6 must fail); ignore the floor (7 fails); use `dueDate` for the
notice (2 and the digest check fail); count renewal > 0 as an issue (10 fails);
unclamped month add (11 fails).

**Regression at their counts:** `verify-doc8-due-dates` 40, `verify-doc13-surfaces`
27, `verify-doc2-by-document` (34 emitted), `verify-notify14-doc-digest` 54, plus
`verify-doc6-key-register` 48 since § 5 touches its file. Rollup snapshot diff
(§ 9). `npm run build`; scoped eslint.

### (c) Contradictions with the prompt or a draft ruling

1. **"Additive, nullable only"** (Phase 2 step 2) cannot hold without losing the
   duplicate-signature guard, unless the hand-written-index route in F1 is taken.
   The lean is two `NOT NULL DEFAULT 0` columns and two unique-index swaps, which
   is what HR-15b did and is additive in the CLAUDE.md sense (no column dropped).
   But it is not nullable, and it drops and recreates two indexes. Needs Gary's word.
2. **The DOC-7 ROADMAP row** (`docs/ROADMAP.yaml`, DOC-7 notes) scopes it as a
   "per-category default re-sign interval" that reuses HR-11k's Case A path.
   Draft ruling 1 is per document, and § 1 option D explains why Case A's path
   (a per-document new version) cannot carry per-person anniversaries. Both
   halves of the row's wording are superseded if F2 and F3 are ratified as leaned.
3. **Draft ruling 3 vs the digest's "due soon"** — not a contradiction, but the
   reason F4 exists: ruling 3 makes an upcoming re-sign complete, and the digest
   is only about documents that are owed.
4. No draft ruling is contradicted by the code otherwise. Ruling 6's floor
   ("later of signature + N and setting-on + 30") needs no per-person state;
   ruling 7 is already how `HrSignedRecord` behaves once the key admits a second
   record.

### Out-of-scope findings (classified)

- **COMMENT** — `ensureSignedRecord`'s ack Map (`hr-signed-pdf.ts:380-382`) and
  the engine's record maps (`hr-compliance.ts:412-419`) are last-write-wins with
  no `orderBy`. Harmless today only because the unique keys make duplicates
  impossible. DOC-7's renewal filter keeps it harmless; worth a comment line in
  the build, no row.
- **COMMENT** — `/staff/[id]`'s `currentRecord = find(cycle)` (`page.tsx:270-272`)
  depends on the query's `orderBy` to pick the newest record. Made explicit by
  the `renewalView` adoption.
- **RULING NOW** — F2 (ROADMAP row's per-category wording). In the forks.
- **ROW** — 0.
