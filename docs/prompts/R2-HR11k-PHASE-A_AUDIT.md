# R2 / HR-11k Phase A — Step 1 audit

**Session:** 2026-08-15. TIER 3, audit phase, no file touched except this one.
**Prompt:** the R2 / HR-11k Phase A session prompt (not saved to the repo at
audit time — suggested path `docs/prompts/R2-HR11k-phase-a.md`).
**Design spec read:** `docs/prompts/R2-HR11k-DESIGN.md` — note the path. The
prompt and the spec's own header both say `docs/R2-HR11k-DESIGN.md`; the file is
untracked in `docs/prompts/`. Sections 4–9 are this session's scope.

Everything below is quoted from `staging` at local HEAD `614dc8d`.

---

## 0. Two preconditions that failed before the audit began

**(a) Local `staging` and `origin/staging` have DIVERGED.** Not "ahead" —
diverged.

```
## staging...origin/staging [ahead 1, behind 1]

local   614dc8d docs(roadmap): HR-11o verified on staging, with Gary's ruling
remote  6e3b9eb docs(roadmap): HR-11o verified on staging — all three display defects confirmed
common  7198f77 docs: ceremony-route audit, the UTC/local precondition, HR-11o correction
```

Both sides carry one commit on top of `7198f77`, and both are the HR-11o
roadmap record — the same work committed twice with different messages. This is
not a fast-forward. Gary resolves it before anything is pushed, and it must be
resolved before Step 6, because the staging-SHA precondition cannot pass while
local HEAD is not an ancestor of what the deployment serves.

**(b) The design spec is written against `main`, and `main` does not have R1.**
The spec says so itself (§7: "Located from `main`; confirm against `staging`").
Confirmed against `staging`, three of its statements are stale. They are
corrected in §2 and §4 below. This is not a criticism of the spec — it is the
exact check §7 asked for, and it changes the plan.

---

## 1. The finding that changes the shape of the work

**The precedence table is not implemented three times. It is implemented ONCE,
in `src/lib/hr-completion.ts`, and asked three times.**

R1 landed this yesterday (2026-08-15, commit `32205a4`) for precisely the reason
this phase would otherwise re-create: six separately written derivations of "this
document is signed" that had to agree by discipline and were not required to
agree by construction — and all six were wrong in the same way at the same time.

Complete enumeration of `documentCompletion` call sites, by grep over `src`:

| Site | Line |
| --- | --- |
| `src/lib/hr-compliance.ts` | `:422` |
| `src/app/(app)/staff/[id]/page.tsx` | `:222` |
| `src/app/(my)/my/documents/data.ts` | `:91` |

And the complete enumeration of everything that PRODUCES the fact row 4 turns
on, `hasRecordOnEarlierVersion` — three producers, one consumer:

```
src/app/(app)/staff/[id]/page.tsx:217   const priorSigned = d.versions.find((v) => !v.isCurrent && v.signedRecords.length > 0)
src/app/(my)/my/documents/data.ts:85    const priorSigned = d.versions.find((v) => !v.isCurrent && v.signedRecords.length > 0)
src/lib/hr-compliance.ts:407            const priorSigned = d.versions.find(
src/lib/hr-compliance.ts:408              (v) => !v.isCurrent && recordAnyCycle.has(`${v.id}:${member.id}`)
src/lib/hr-completion.ts:125            else if (hasPriorCycleRecordOnCurrentVersion || hasRecordOnEarlierVersion) status = "needs-current"
```

The spec's §7 file table does not list `src/lib/hr-completion.ts`. Implementing
"the same precedence table in all three status sites" literally would put three
copies of the R2 rule back into the codebase and reverse R1 one day after it
shipped. **The correct shape is: the TABLE changes once, in the predicate; the
three sites change only in what FACTS they gather and hand in.** That is the
plan's central proposal and it needs Gary's ruling, because it departs from the
spec's file list.

`src/app/(my)/my/page.tsx:73` is a fourth CONSUMER (not a fourth derivation) —
it filters `ComplianceDocItem.status !== "complete"` for the employee dashboard's
open-items list. A row-4 member's document drops off that list automatically,
with no edit. Named here because the spec does not mention it.

---

## 2. The two questions the prompt asked, answered per site

### Q1 — is the version list ordered by `versionNumber` descending?

**Yes. At all three sites, explicitly, already.**

| Site | Ordering found | Line |
| --- | --- | --- |
| `hr-compliance.ts` | `versions: { orderBy: { versionNumber: "desc" }, select: {...} }` | `:259-262` |
| `staff/[id]/page.tsx` | `versions: { orderBy: { versionNumber: "desc" }, include: {...} }` | `:186-195` |
| `my/documents/data.ts` | `versions: { orderBy: { versionNumber: "desc" }, include: {...} }` | `:54-63` |

**This corrects the design spec.** §4 "Version selection for row 4" says
`/my/documents/data.ts` "already fetches with `orderBy: { versionNumber: "desc" }`,
so `.find()` is correct there. The other two sites must be checked and given an
explicit ordering rather than inheriting whatever the include returns." All three
already have it. No ordering needs to be added anywhere; the prompt's "make the
ordering explicit at each site" is already satisfied, and `.find()` selecting the
highest matching version number is correct at all three.

**One real ordering gap, at a different level — `signedRecords` is UNORDERED.**

```ts
// staff/[id]/page.tsx:189   and   my/documents/data.ts:57
signedRecords: { where: { staffMemberId: member.id } },   // no orderBy
```

Consumed at `staff/[id]/page.tsx:209` as `current.signedRecords[0]` and at
`:256` as `priorSigned?.signedRecords[0]?.id`. For a member holding two records
on one version across two signing cycles (a rehire who signed, left, returned,
signed again), `[0]` is whatever Postgres returns. Today this is nearly harmless
— the value feeds a boolean and a download link — but row 4 needs to pick a
record, so this becomes load-bearing. **Pre-existing, in-scope to make
deterministic where row 4 reads it, not in scope to sweep.**

### Q2 — which lookups are cycle-keyed, and which match any cycle?

**`hr-compliance.ts`** builds two maps, `:308-315`:

```ts
const recordByVersionStaffCycle = new Map<string, { completedAt: Date }>()   // versionId:staffId:cycle
const recordAnyCycle = new Map<string, { completedAt: Date }>()              // versionId:staffId
```

| Lookup | Keying | Line |
| --- | --- | --- |
| `currentRecord` | **cycle-keyed** | `:403` |
| `priorSigned` (prior version) | **ANY CYCLE** ← the trap | `:407-409` |
| `priorCycleRecord` | any cycle, by construction (it means "a record exists but not this cycle's") | `:412-413` |
| `ackedIds` | cycle-keyed | `:404` |

`recordByVersionStaffCycle` is built over `allVersionIds` — every version, not
just current — so **row 4 can be resolved cycle-keyed from the map that already
exists. No new query.**

**`staff/[id]/page.tsx`** and **`my/documents/data.ts`** are the same shape as
each other:

| Lookup | Keying | staff/[id] | my/documents |
| --- | --- | --- | --- |
| `currentRecord` | **cycle-keyed** `.find(r => r.signingCycle === member.signingCycle)` | `:206-208` | `:74-76` |
| `priorCycleRecord` | any cycle (`signedRecords[0]`, guarded by no current-cycle record) | `:209` | `:77` |
| `ackedIds` | cycle-keyed `.filter(a => a.signingCycle === ...)` | `:210-214` | `:78-82` |
| `priorSigned` (prior version) | **ANY CYCLE** — `v.signedRecords.length > 0` ← the trap | `:217` | `:85` |

**The trap the prompt names is confirmed present at all three sites, in the
identical shape, and it is the only thing standing between row 4 and row 5.**
`v.signedRecords.length > 0` asks "did they ever sign this older version, in any
tenure". Split correctly, row 4 must ask "did they sign it IN THIS CYCLE".

---

## 3. The remaining files, quoted

### `staff-documents.tsx` — `statusLabel()` and `STATUS_STYLES` (`:35-61`)

```ts
const STATUS_STYLES: Record<StaffDocumentRow["status"], string> = {
  signed: "bg-green-100 text-green-700 border border-green-200",
  "needs-current": "bg-amber-100 text-amber-700 border border-amber-200",
  "in-progress": "bg-blue-100 text-blue-700 border border-blue-200",
  "not-started": "bg-gray-100 text-gray-600 border border-gray-200",
}

function statusLabel(row: StaffDocumentRow): string {
  if (row.recordMissing) return HR_RECORD_MISSING_ADMIN_COPY
  switch (row.status) {
    case "signed":
      return `Signed v${row.signedVersionNumber}${row.completedAt ? ` · ${format(new Date(row.completedAt), "MMM d, yyyy")}` : ""}`
    case "needs-current":
      return "Needs current version"
    ...
```

**The `signed` case ALREADY reads `row.signedVersionNumber`, not
`currentVersionNumber`.** So on this surface the display work is only the
`· current is vN` suffix when the two differ. The subtitle line at `:94-98`
already renders `Current version v{n}` always, and `· signed v{n}` only for
`needs-current`.

`signedVersionNumber` is populated at `page.tsx:247-251` and — unlike
`hr-compliance.ts` — is **already populated on the signed path** here
(`currentRecord ? current.versionNumber : ...`). The R1 comment at `:239-246`
explains the invariant that must be preserved: *a version number only ever comes
from a record*.

### `hr-compliance.ts` — `signedVersionNumber`, nulled off the warning path (`:449-454`)

```ts
signedVersionNumber:
  status !== "needs-resign"
    ? null
    : priorCycleRecord
      ? current.versionNumber
      : (priorSigned?.versionNumber ?? null),
```

This is the §5 defect exactly: the number is discarded unless the status is
`needs-resign`. Under R2 the `complete` path needs it.

### `my/documents/data.ts` — `MyDocumentRow` (`:23-34`)

Carries `currentVersionNumber` and **no** `signedVersionNumber`. Confirmed: the
type must gain the field.

### `/my/documents` renderer — LOCATED

**`src/app/(my)/my/documents/page.tsx`.** There is no separate client component;
the server page renders the rows itself. Sole importer of `requiredDocumentRows`
and `MyDocumentRow` (grep over `src` returns only this file and `data.ts`).

**It carries a defect R2 creates, which the spec does not name.** Completed
section, `:136`:

```tsx
Signed v{row.currentVersionNumber}
{row.completedAt && ` · ${format(new Date(row.completedAt), "MMM d, yyyy")}`} — need a
copy? Ask your manager.
```

Hardcoded to the CURRENT version. Today that is harmless — only a current-version
record reaches this section. Under R2 a row-4 member lands here and would be told
**"Signed v6"** when they signed v4. Must read `signedVersionNumber`.

Bucketing, `:85-86`: `pending = rows.filter(r => r.status !== "signed")`,
`done = rows.filter(r => r.status === "signed")`. A row-4 member moves from
`pending` to `done` with no edit — which is also **how the signing affordance is
removed**, since only `pending` rows are wrapped in a `<Link>` to the ceremony.

### `versions/route.ts` — the POST comment (`:22-26`)

```ts
// POST /api/hr/documents/[id]/versions — ADMIN. Re-upload: registers a new
// HrDocumentVersion as current and demotes the prior one. The old version row
// (and its file, hash, acknowledgments, and signed records) is never touched —
// staff who signed it now read as "needs current version". Checkpoints are
// document-scoped, so they carry forward to the new version automatically.
```

**A SECOND false assertion in the same file, which the prompt does not name**
(`:96-97`):

```ts
// Stamp coordinates only: everyone still
// re-acknowledges the new version (HR-11f untouched).
```

Also false under R2, and it names HR-11f explicitly. Flagged for a ruling —
correcting one and leaving the other is worse than correcting neither, because
the surviving one reads as still-current.

### `docs/DECISIONS.md` — the HR-8 block (`:1449`, item (a) at `:1451-1456`)

```
a. **Acknowledgment docs: current version only.** ... A
   record signed against an older version is its own **"needs re-sign"**
   status: non-compliant, but distinct from "not started".
```

The last sentence is what R2 overturns. Item (a) also asserts the pending-record
rule that **R1 already overturned yesterday** and which was never marked here —
see §4(b).

---

## 4. Three ambiguities. Stopped, not guessed.

### (a) Spec row 2 describes pre-R1 behaviour

The precedence table's row 2 reads "All required checkpoints acked, current
version, current cycle → **complete / pending-record**", Change column
"unchanged". Under R1, shipped yesterday, that arm produces `in-progress` with
`recordMissing: true` and is explicitly **not** a completion state
(`hr-completion.ts:120-124`, and the R1 ruling text: *"a full required-checkpoint
set is NO LONGER COMPLETION"*).

The two halves of that row contradict each other. "Change: unchanged" is almost
certainly the operative half — the label is a stale copy of the pre-R1 status
name, carried in from `main`. **Reading it the other way would silently revert R1
under cover of an R2 fix**, and would re-inflate exactly the compliance
percentages R1 deliberately dropped. Not guessing which. Proposed reading, for
ratification: **arm 2 is untouched, keeps `in-progress` + `recordMissing`.**

### (b) The read-only notice's "view link" points at the ceremony

The spec requires the notice to carry "a view link" and **"no signing
affordance"**. The only per-document route in the staff portal is
`/my/documents/[documentId]` — and that route **is the ceremony**: it renders
`SigningClient` (`page.tsx:147`), and `hasSignedRecord` is computed for the
CURRENT version and current cycle (`:97-103`). A row-4 member has no record on
the current version, so `hasSignedRecord` is false and the ceremony opens. That
link is a signing affordance.

Two candidate targets, neither free:

1. **`/api/hr/documents/[id]/download?stream=1`** — audience-aware, resolves the
   current version, already used by this very page for the Reference library
   (`page.tsx:215`). Read-only by construction. Cost: `data.ts:8` records the
   staff-download rule as *"staff never download PDFs, rule 5"* — that rule is
   about **signed PDFs**, and the Library link proves source documents are
   already served this way, but the extension to an Acknowledgment document is
   Gary's call, not mine.
2. **A read-only mode on `/my/documents/[documentId]`** — more work, more
   surface, and it touches the ceremony route, which §8 lists as untouched.

Recommend (1). Not implementing either without a ruling.

### (c) Verification step 3 may not be runnable against the current fixture state

The prompt expects Gdogg's row to read "signed at the version he completed".
Against the last MEASURED staging state — the HR-11j acceptance pre-check,
`preview/staging` branch `br-square-feather-a63z92vz` / `neondb`, org
`org_3G02wO4QlVVSWppi8aqlnSZnsDa`, document `cmstv3r1s000004jxdcyhkbui` — Gdogg
held **7 acknowledgments and ZERO signed records**, on v2, and the roadmap states
"v1's 7 acks and its 1 record are Tommy's."

A member with no record on any version does not match row 4. He matches
`recordMissing` → `in-progress`, unchanged by this phase. Separately, the
roadmap's HR-11n text references a **"Gdogg Thomas's v3 certificate"**, and the
prompt describes a **v4/v5** episode — so the fixture has moved since that
pre-check, possibly on a different document.

**Row 4 also collides with arm 2 for him specifically.** If Gdogg holds a
current-cycle record on v4 *and* a FULL required-checkpoint set on the current
version, arm 2 (`recordMissing`) fires before row 4 in the spec's own ordering
and he reads in-progress, not signed. The prompt's "Row 4 beats row 6" resolves
the PARTIAL-acks case only; it does not speak to the full-acks case, and the
spec's table puts row 2 above row 4.

**This must be measured before it is predicted.** Required, via the Neon console
(CLAUDE.md forbids a local connection to a deployed branch): for the document
under test, per version — `versionNumber`, `isCurrent`, and per staff member the
`HrSignedRecord` rows with `signingCycle`, the `HrDocumentAcknowledgment` count
with `signingCycle`, and the required-checkpoint count — with
`current_setting('neon.branch_id', true)` and `current_database()` in the same
result.

---

## 5. Scope boundaries — checked, none breached

| Out-of-scope item | Status |
| --- | --- |
| Prisma schema / migration | **Not needed.** Every fact row 4 requires is already loaded at all three sites. `recordByVersionStaffCycle` already spans every version. No new query, let alone a column. |
| Writes to `HrSignedRecord` / `HrDocumentAcknowledgment` | Not needed. All three sites are read paths; `hr-compliance.ts:34` records that nothing in it writes. |
| `signingCycle` semantics | Untouched. Row 4 READS the cycle that already exists. |
| Retired checkpoints (HR-11n) | Untouched — `where: { required: true, retiredAt: null }` unchanged at all three sites. |
| Audience / grant logic | Untouched. `grantedToStaff` / `staffAudienceWhere` unchanged. |
| Upload dialog | Untouched. `versions/route.ts` takes a comment change only. |
| `HR_MODULE_AVAILABLE` | Unset. Not read by this work. |
| HR-11n Phase B | Not touched. |

---

## 6. Proposed plan (pending approval — nothing edited)

1. **`src/lib/hr-completion.ts`** — split the fact `hasRecordOnEarlierVersion`
   into `hasCurrentCycleRecordOnEarlierVersion` (row 4) and
   `hasPriorCycleRecordOnEarlierVersion` (row 5); insert row 4 as a `signed` arm
   ahead of the `needs-current` arm and behind arms 1 and 2; add
   `signedOnEarlierVersion` to the result so surfaces can render the notice
   without re-deriving it. Amend the header block under a dated marker.
2. **Three call sites** — resolve the prior-version record **cycle-keyed**, and
   deterministically at the highest `versionNumber`: `hr-compliance.ts` off
   `recordByVersionStaffCycle`; the other two off
   `v.signedRecords.some(r => r.signingCycle === member.signingCycle)` with an
   explicit `orderBy` on `signedRecords`. Hand in both new facts.
3. **`signedVersionNumber`** — populate on the complete path in
   `hr-compliance.ts`; add to `MyDocumentRow`; fix
   `my/documents/page.tsx:136`'s hardcoded `currentVersionNumber`.
4. **Display** — `statusLabel()` signed case gains `· current is vN` when the
   numbers differ; `STATUS_STYLES` untouched, green preserved. `/my/documents`
   gains the read-only notice per the §4(b) ruling.
5. **Comments and `DECISIONS.md`** — both false assertions in `versions/route.ts`
   per the §3 ruling; the `hr-compliance.ts` header block; an R2 amendment
   prepended under HR-8 with the 2026-07-22 (a) text preserved beneath.
6. **Verify** per Step 6, after §0(a) is resolved and §4(c) is measured.

**No schema change. No migration. No write path touched.**
