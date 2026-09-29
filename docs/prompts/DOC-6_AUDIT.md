# DOC-6 — Audit (Phase 1, read-only)

2026-09-28. Branch `staging` at `d760714`, `staging..main` empty, tree clean
apart from `docs/prompts/DOC-6.md`. DOC-6 row read (`status: planned`, notes:
"OPEN, NEEDS A RULING FIRST: how a RETURN is recorded").

Nothing was written. One read-only query ran against the **dev** database
(local `.env`); no deployed database was queried.

---

## 1. The Key Agreement as data

### The prompt's premise and what the data shows are not the same

The prompt says: "Today the Key Agreement is an uploaded **Acknowledgment**
document (category 'Logs')". **On dev, it isn't.** The only Key Agreement on dev
is HR-5's seeded **FillableForm pair** (`scripts/seed-key-agreement.ts`):

| Document (dev, Keva Juice `cf888f2d…`) | kind | category | Versions | Rows |
|---|---|---|---|---|
| Key Agreement — Check-Out `cmrjqjnwm…` | FillableForm | HR Management | v1, v2 (current) | 1 FormSubmission on each version |
| Key Agreement — Check-In `cmrjqjokl…` | FillableForm | HR Management | v1 (current) | 0 FormSubmissions |

- Both are `linkedFormId`-paired to each other, `appliesTo: "all"`, active.
- **No "Logs" category exists on dev**, and dev has no Acknowledgment document
  with "key" in its title.
- Neither has checkpoints: forms carry `FormField`s, not checkpoints. Check-Out
  has a required **"Key Number"** field; Check-In has "Key Number" and
  "Key Condition" (Good / Damaged / Lost).

**Staging: unknown from docs.** The DOC-2 staging evidence (DEPLOY_LOG `1df08a9`)
lists "Test - Handbook Regression" and two Policy documents and no Key Agreement.
The SIGNED-1 staging test asked for "Logs chip → Key Agreement rows **or the
empty state**" and the evidence records only "Looks great", not which one.

**Production: known only from Gary's words**, never from a recorded query:
SIGNED-1 ("His use case is pulling every Key Agreement record (category 'Logs')")
and this prompt. `R2-HR11k-DESIGN.md` §3 parked Case B on exactly this open
question ("whether the Key Agreement is `kind = FillableForm` or
`kind = Acknowledgment`") and nothing since has recorded the answer.

**Why it matters:** F1's lean (A) rests on "the Key Agreement is already
uploaded, assigned and signed as an Acknowledgment". If the live one is an
Acknowledgment in "Logs", (A) stands. If Keva actually executes the Check-Out
form, (B) is largely already built. → **RULING NOW R0** below.

### Does any checkpoint capture a key number?

- **For a FillableForm:** yes, the "Key Number" `FormField`, stored in
  `FormSubmission.values`.
- **For an Acknowledgment:** only if its uploader added a `Field` checkpoint.
  A Field checkpoint's answer lands in `HrDocumentAcknowledgment.fieldValue`
  (per signer, per version, per cycle; snapshot `checkpointName`). Dev has one
  Field ack in total ("HR5 Regression Test Policy" / "Employee ID"), none on
  anything key-shaped. Whether production's Key Agreement has one is unknown.
- **So the register can show a key number only when the document has a Field
  checkpoint.** Recommendation (no new config): the register shows every
  non-retired Field checkpoint's captured value from the acks behind the
  holder's **most recent** signed record, labelled with the checkpoint name
  (e.g. "Key Number: 14"). A document with no Field checkpoint shows nothing
  there. No `keyNumberCheckpointId` column, no name-matching heuristic.

## 2. Append-only posture — confirmed

- The only writer of `HrSignedRecord` in `src/` is `prisma.hrSignedRecord.create`
  at `src/lib/hr-signed-pdf.ts:770` (`ensureSignedRecord`). There is **no
  `update`, `upsert` or `delete`** anywhere in `src/`. The only deletes are
  fixture teardowns under `scripts/`.
- `HrSignedRecord` has no `updatedAt`; the schema carries `signingCycle` with the
  comment "old records stand".
- The staff DELETE route (`src/app/api/staff/[id]/route.ts:201-216`) refuses
  any staff member with a signed record (409).

**Conclusion:** a return **cannot** be a column on the signed record. It must
be a separate row, as F3 proposes.

Two wiring consequences for the build (FIX NOW, part of Phase 2):

- The staff DELETE guard's `counts` list must include `hrReturnEvent`. Without
  that, a Restrict FK would surface as a 500 instead of the 409 message.
- HR documents have **no DELETE route** (PATCH archives), so there is no
  document-side guard to extend.

## 3. The Check-Out / Check-In pairing (fork F1)

**What it does today:**

- `HrDocument.linkedFormId`, kept symmetric by `POST /api/hr/forms/[id]/link`
  (`route.ts:12-71`), which writes both sides and clears any prior partner.
- `/hr/forms` shows a "Paired with …" chip.
- `/staff/[id]` groups a pair into one card
  (`staff-form-documents.tsx:55-68`) with a header line like "Check-Out signed
  9/12 · Check-In not started", each side's full submission history, and "New
  execution" (re-execution is routine; `FormSubmission` has no unique on
  version + staff for this reason).
- **Nothing computes "holding".** The pairing is display grouping only. It has
  no count, no register, no per-key matching of a Check-In to a Check-Out, and
  no termination hook. The status phrase reads only the **latest** submission
  of each side.

**Use on any branch:**

- **Dev:** seeded pair, two Check-Out executions, zero Check-Ins.
- **Staging and production:** unknown (see §1).

**Could it be the return mechanism?** Mechanically, a Check-In is a richer
return record (key number, condition, supervisor countersign, signed PDF). But
under (B):

- Holding would have to be derived by pairing Check-In submissions to Check-Out
  submissions, by count or by "Key Number" text match. That is fragile: free
  text, and several keys per person.
- Forms are **outside the compliance %** (DECISIONS HR-8 b), so "who has signed
  the Key Agreement" would leave By Document and the "Logs" view that DOC-2 and
  SIGNED-1 were built around.
- Every return would need the dual-signer ceremony, not a one-click Mark
  returned.

**Lean A holds if R0 confirms the Acknowledgment premise.**

## 4. Holding semantics against existing rules

| Rule | Compliance says | Register (F4 lean) says | Conflict? |
|---|---|---|---|
| HR-15 cycles | A prior-cycle record = needs-current (rehire re-signs) | Prior-cycle record, no Returned → **holding** | Deliberate difference (F4) |
| R2 versions | A prior-version record in the current cycle satisfies the current version, unless Case A | v1 signer while v3 is current → **holding** | Agrees in effect; the register ignores Case A entirely |
| Archived documents | Excluded from compliance (`hr-compliance.ts:317`, `isActive: true`) | **Not ruled.** A key issued under a since-archived agreement is still out | → **RULING NOW R2** |
| Terminated staff | Excluded from every rollup (HR-8 d) | Kept, flagged (F7) | Deliberate difference (F7) |
| Pending-record (all acks, no minted PDF yet) | Counts as complete | F3 requires a **signed record** | COMMENT: minting is idempotent and immediate; accept the gap |

**A gap in F3's predicate as written.** "Latest event is not `Returned`"
ignores signatures made **after** a return. The concrete case: someone returns
their key at termination (Returned), is rehired, and signs the Key Agreement
again under cycle 2. They physically have a new key, but their latest event is
still Returned, so they read **not holding**, and nobody would think to click
Reissued. → **RULING NOW R1.**

## 5. The termination flow

- **UI:** `src/app/(app)/staff/[id]/self-service-actions.tsx:176-203`, the
  Terminate `AlertDialog` on `/staff/[id]`. Today it shows only
  "Terminate {name}? This marks them terminated and immediately removes their
  portal access … All of their records … are kept." It has no lists and no
  warnings.
- **API:** `POST /api/staff/[id]/terminate` (`route.ts:12-42`), which calls
  `terminateStaffMember` (`src/lib/staff-termination.ts:11`). ADMIN org-wide,
  MANAGER in-scope (out of scope → 404).
- The non-blocking warning belongs **inside that dialog's description**, fed by
  a holdings list the server page already passes down (or fetched on open, like
  Reactivate's preflight at `:83-96`).

**Two other termination paths have no UI at all:**

- `src/app/api/staff/sync-square/route.ts:74` (bulk Square reconcile);
- `src/app/api/staff/[id]/resync-square/route.ts:65`.

People terminated this way never see a warning. F7 (terminated holders stay
flagged in the register) is what catches them. COMMENT, not a new row.

## 6. Scope and guards

- **`/hr/compliance`** (`page.tsx:31-42`): `hrModuleAvailable`, the `activeModules`
  "hr" check, `role ∈ {ADMIN, MANAGER}` else 404, then
  `getUserStoreScope()` → `storeIds: isAdmin ? null : storeIds`.
- **HR-7 rule 5, the per-person tier:** `canReadHrSignedRecord` in
  `src/lib/hr-files.ts:264-278`. It returns true for ADMIN, and for MANAGER when
  the staff member's `StoreStaffAssignment` stores overlap the manager's
  `StoreUserAssignment` stores; STAFF and STORE get false. Used by
  `api/hr/signed-records/[id]/download` and
  `api/hr/forms/submissions/[submissionId]/download`, both returning 403 on
  false.
- **Named gate for "Mark returned":** the route runs
  `requireHrDocumentAccess()` (`src/app/api/hr/documents/access.ts:11`, which
  handles availability, module and auth), then **`canReadHrSignedRecord`**
  against the staff member's store assignments. That gives exactly F5:
  ADMIN, in-scope MANAGER → allowed; out-of-scope MANAGER, STAFF, STORE → 403.
- PERM-5 capabilities: the `hr.*` keys in `src/lib/permissions.ts:443-460` are
  declared but **not called by any HR route** (`can(actor, "hr.…")` appears
  nowhere). I would not introduce the first one here.
- One scope note: the terminate route returns **404** for an out-of-scope
  manager ("don't leak existence"), while the download routes return **403**
  after the org check. The prompt's fixture expects **403**, which matches the
  download-route pattern: 404 for cross-org or unknown, 403 for in-org out of
  scope.

---

## Forks — for Gary

### R0 (new, blocks F1): Where does the live Key Agreement live?

Dev has only the FillableForm pair; production's shape is recorded only as your
description. Please confirm, on **production**: is the Key Agreement an
**uploaded document under /hr/documents** (Acknowledgment, category "Logs"), or
the **Check-Out form under /hr/forms**? If it's the uploaded document, F1 = A as
leaned. If it's the form, F1 needs re-deciding before any schema.

### F1 Mechanism
(A) a new append-only return-event table, or (B) the Check-Out/Check-In
pairing. **Lean A**, conditional on R0. Evidence in §3: the pairing computes no
holding, would need fragile Check-In ↔ Check-Out matching, and sits outside
compliance.

### F2 Which documents track returns
`HrDocument.tracksReturn Boolean @default(false)` + `returnItemLabel String?`,
ADMIN-set on the document's edit dialog. **Lean: yes.**

- *Addition:* the toggle is offered on **Acknowledgment** documents only.
  Returns hang off `HrSignedRecord`, which only Acknowledgments produce; forms
  and Links have none. The PATCH route returns 400 on other kinds.

### F3 Event model
`HrReturnEvent` (`id`, `organizationId`, `hrDocumentId`, `staffMemberId`,
`type` Returned | Reissued, `occurredOn` DATE, `note?`, `recordedByUserId`,
`createdAt`). Append-only, no update or delete route, Restrict FKs annotated.
**Lean: yes**, with R1's amendment to the holding rule.

- *Validation:* Returned only when currently holding. Reissued only when
  currently not holding and a signed record exists. Otherwise 409, so double
  clicks can't stack events.

### R1 (new): Does a signature after a return re-issue?

**Recommended sentence:** "A person holds the item if they have a signed record
on any version of a tracks-return document, and their most recent *issue*
(a signature's `completedAt`, or a Reissued event) is later than their most
recent Returned event."

- Events are ordered by **`createdAt`** (when recorded), not by `occurredOn`,
  which is a display date that may be backdated. This avoids date-vs-timestamp
  and time-zone comparisons.
- Without this, a rehire who returned a key and signed again reads "not
  holding".

### F4 Cycles and versions
**Please confirm this exact sentence:** "Holding is judged per person per
document, across all versions and cycles. A key physically issued is held until
returned, whatever re-signing happened since." **Lean: yes.** It deliberately
differs from compliance's per-cycle rule, and R1 is its mirror image: a new
signature after a return is a new issue.

### R2 (new): Archived tracks-return documents

**Recommended:** holders of an archived tracks-return document **stay in the
register**, with the document marked "(archived)". A key doesn't come back
because the paperwork was retired. Mark returned still works; Reissued does not
(you can't issue under a retired agreement).

### F5 Who records
ADMIN plus in-scope MANAGER, via `canReadHrSignedRecord`. STAFF and STORE get
403. **Lean: yes.**

### F6 Where it shows
**Lean: yes.**

- A Key Register section on `/hr/compliance` below By Document, manager-scoped
  like the rest of the page.
- Holdings plus event history on `/staff/[id]`.
- A non-blocking warning in the Terminate dialog.

### F7 Terminated holders
They stay in the register, flagged "Terminated — not returned". **Lean: yes.**

---

## Findings

**FIX NOW (in the Phase 2 build, not now):** 2

1. Add `hrReturnEvent` to the staff DELETE guard's `counts`
   (`api/staff/[id]/route.ts:201-211`).
2. The F2 toggle is limited to Acknowledgment documents (400 otherwise).

**RULING NOW:** 3 new, plus F1–F7

1. R0: the live Key Agreement's kind.
2. R1: a signature after a return re-issues.
3. R2: archived documents stay in the register.

**COMMENT:** 3

1. The Square-sync termination paths get no warning; F7 covers them.
2. Pending-record (all acks, not yet minted) doesn't count as holding. The mint
   is immediate and idempotent.
3. The key number is shown only if the document has a Field checkpoint (§1).
   Nothing new is configured.

**ROW:** 0.
