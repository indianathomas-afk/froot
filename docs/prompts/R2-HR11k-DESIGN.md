# R2 / HR-11k — version binding and re-verification

**Status:** design spec, not a ruling. Nothing here is authoritative until Gary
writes it into `docs/ROADMAP.yaml` in his own words.
**Suggested repo path:** `docs/R2-HR11k-DESIGN.md`
**Supersedes:** HR-11f (2026-08-14), which required universal
re-acknowledgment on every new version.
**Related:** HR-11j, HR-11m, HR-11n, HR-11o (closed 2026-08-14/15); HR-15
Policy B (signing cycles, 2026-07-23); DOC-1 Phase C (audience denominators,
2026-08-12).

---

## 1. The ruling being implemented

Gary, 2026-08-15:

> A **new file** is a new document: everyone in the audience signs it.
>
> A **new version** is the same document: existing signers **keep their record
> and are not re-prompted**, and a read-only notice tells them an update is
> available.
>
> The version a person originally signed is the master document for that
> person.

R3, same day:

> Compliance shows **signed, with the version noted**. No warning, no flag.
> They signed what was in force when they signed it.

Churn is handled by a disclaimer typed into the document itself — "terms and
conditions may change, check back regularly for any updates" — which is how
the business has run for years.

## 2. What is broken today

Both symptoms are the same missing feature. Nothing has been built.

| Symptom | Where | Correct under HR-11f | Correct under R2 |
| --- | --- | --- | --- |
| Tommy Thomas reads "Needs current version" | `/staff/[id]` Documents tab | yes | no — should read signed |
| Uploading v5 re-prompted Gdogg, who had completed v4 | `/my/documents` | yes | no — should not prompt |

## 3. Scope split

**Phase A (this spec, sections 4–9) — R2 only. No schema change.**
A prior-version signed record satisfies the current version. Read-rule plus
display. Closes both symptoms above.

**Phase B (section 10) — Case A, the re-verification toggle.**
An additive Boolean on `HrDocumentVersion` and a control in the upload dialog
that re-imposes re-signing for one version, overriding the R2 default.

**Not in either phase — Case B, per-person re-verification.**
Blocked pending one fact: whether the Key Agreement is `kind =
FillableForm` or `kind = Acknowledgment`. `FormSubmission` already carries no
unique on `(version, staff)` and its own schema comment names key check-outs
as the reason, so for a FillableForm this may already work and need nothing.
Case B is only a gap for `Acknowledgment` documents.

---

## 4. Phase A — the precedence table

This table is the whole of Phase A's logic. It is the same table in all three
status computations; only the names of the statuses differ per surface.

Read top to bottom, first match wins. "Current cycle" means
`staffMember.signingCycle`.

| # | Condition | Status | Change |
| --- | --- | --- | --- |
| 1 | Signed record on the **current version**, **current cycle** | complete / signed | unchanged |
| 2 | All required checkpoints acked on the current version, current cycle | complete / pending-record | unchanged |
| 3 | Signed record on the **current version** from a **prior cycle** | needs-resign / needs-current | unchanged — rehire, HR-15 Policy B |
| 4 | Signed record on a **prior version**, **current cycle** | **complete / signed** | **NEW — this is R2** |
| 5 | Signed record on a **prior version** from a **prior cycle** only | needs-resign / needs-current | unchanged in effect — rehire |
| 6 | Any acknowledgment rows on the current version, current cycle | in-progress | unchanged |
| 7 | Nothing | not-started | unchanged |

### The trap

Today, rows 4 and 5 are collapsed into a single `priorSigned` lookup that
matches **any cycle**:

```ts
const priorSigned = d.versions.find(
  (v) => !v.isCurrent && recordAnyCycle.has(`${v.id}:${member.id}`)
)
```

Splitting them is the entire correctness risk of this phase. If row 4 is
implemented against `recordAnyCycle`, a rehired employee's prior-tenure
signature will silently read as compliant and HR-15 Policy B is destroyed
without any test failing. Row 4 **must** resolve against the cycle-keyed map
(`recordByVersionStaffCycle` in `hr-compliance.ts`, or the equivalent
`.find(r => r.signingCycle === member.signingCycle)` on the other two
surfaces).

### Version selection for row 4

When a staff member has records on several prior versions, the one that
governs is the **highest `versionNumber` they signed in the current cycle** —
that is their master document. `/my/documents/data.ts` already fetches with
`orderBy: { versionNumber: "desc" }`, so `.find()` is correct there. The other
two sites must be checked and given an explicit ordering rather than inheriting
whatever the include returns.

### Row 4 beats row 6

A staff member may hold a completed record on v4 *and* partial acknowledgment
rows on v6 — Gdogg is exactly this, created by the defect R2 removes. Row 4
wins: they read signed at v4. The partial v6 rows are preserved untouched. They
are harmless, they are evidence, and if Phase B later demands re-verification on
that version the ceremony resumes from them.

### Compliance percentage

Row 4 folding into `complete` is deliberate and is the ruling. Someone signed
at v4 counts toward the numerator. No new enum member is added.

---

## 5. Phase A — data carried, not just status

`signedVersionNumber` is currently nulled unless the status is
needs-resign. R2 breaks that: the signed-at-an-older-version case needs the
number in the **non-warning** path.

Both facts must reach every surface, because they are two distinct facts and
only one is shown today:

- `currentVersionNumber` — the version in force for the document
- `signedVersionNumber` — the version this signer is bound to

Carrying both also keeps the deferred R3 report ("who has acknowledged the
current text") buildable later with no schema and no backfill.

## 6. Phase A — display strings

| Condition | Label | Style |
| --- | --- | --- |
| Signed, current version | `Signed v6 · Aug 15, 2026` | green, unchanged |
| Signed, prior version (row 4) | `Signed v4 · current is v6` | **green** — no amber, no flag (R3) |
| Rehire (rows 3, 5) | `Needs current version` | amber, unchanged |
| In progress | `In progress · 3/10` | blue, unchanged |
| Not started | `Not started` | grey, unchanged |

Amber is reserved for the cases that genuinely owe a signature: rehire now,
Case A and Case B later.

### The read-only notice

On `/my/documents`, on the row of a staff member matching row 4:

> Signed v4 — an updated version is available to read.

With a view link. **No action button, no badge colour change, no ceremony
entry point.** Under R2 there is no ceremony to enter, and offering one would
invite a signature nobody asked for.

## 7. Phase A — files to change

Located from `main`; confirm against `staging` before editing, since project
knowledge indexes `main` only.

| File | Change |
| --- | --- |
| `src/lib/hr-compliance.ts` | Precedence table; split `priorSigned` by cycle; populate `signedVersionNumber` on the complete path; amend the header comment block, which currently states the HR-11f rule as a definition |
| `src/app/(app)/staff/[id]/page.tsx` | Same precedence table for `StaffDocumentRow`; check version ordering in the include |
| `src/app/(app)/staff/[id]/staff-documents.tsx` | `statusLabel()` — the `signed` case renders `· current is vN` when the numbers differ; `STATUS_STYLES` unchanged |
| `src/app/(my)/my/documents/data.ts` | Same precedence table for `MyDocumentRow`; add `signedVersionNumber` to the type |
| `/my/documents` row renderer (locate — consumer of `MyDocumentRow`) | Read-only notice per section 6 |
| `src/app/api/hr/documents/[id]/versions/route.ts` | Comment correction only. The POST comment asserts "staff who signed it now read as 'needs current version'" — false under R2. No behaviour change in this file |
| `docs/DECISIONS.md` | Append an R2 amendment under the HR-8 block. Preserve-and-mark: the 2026-07-22 (a) text stays, the amendment prepends with its date |

No migration. No Prisma change. No new API route.

## 8. Phase A — what is explicitly untouched

- `HrSignedRecord` and `HrDocumentAcknowledgment` rows — nothing written,
  nothing altered, nothing deleted. Phase A is read-side only.
- `signingCycle` semantics and the rehire lever.
- Retired checkpoints (HR-11n) and the completion denominator.
- Audience and grant logic (`lib/hr-documents-access.ts`, DOC-1 Phase C
  rulings 1–5).
- `HR_MODULE_AVAILABLE` stays unset. HR remains dark in production.

## 9. Phase A — verification

All evidence carries the branch literal, org ID and Clerk instance in the same
output. Staging: `br-square-feather-a63z92vz` / `neondb`, org
`org_3G02wO4QlVVSWppi8aqlnSZnsDa`, Clerk `verified-snapper-7`. Deployed-branch
reads go through the Neon console, never a local connection.

1. `next build` passes.
2. Tommy Thomas's row on `/staff/[id]` reads `Signed v… · current is v…`,
   green, where it read "Needs current version" before. Screenshot with org ID
   visible.
3. Gdogg's row on `/my/documents` reads signed at the version he completed,
   with the read-only notice, and offers no signing affordance.
4. **Rehire regression, the one that matters.** A staff member with a
   prior-version record whose `signingCycle` has been bumped still reads
   "Needs current version". If this passes silently without being checked,
   assume it is broken.
5. Compliance percentage on `/hr/compliance` moves in the expected direction
   and the movement is accounted for before it is accepted.
6. Neon query showing `HrSignedRecord` and `HrDocumentAcknowledgment` counts
   unchanged before and after, with `neon.branch_id` and `current_database()`
   in the same result.

---

## 10. Phase B — Case A, re-verification for a whole version

Filed here for design continuity. Its session prompt gets written after Phase A
lands.

**Shape.** One additive Boolean on `HrDocumentVersion` — working name
`requiresReacknowledgment`, `@default(false)`. When true, a prior-version
record does **not** satisfy this version: row 4 of the precedence table is
skipped and the member falls through to needs-resign. That is the entire
behaviour. Case A needs no cycle bump and mints no rows, because a new version
already carries a new `hrDocumentVersionId` and the unique keys already differ.

**Where the control lives.** The version upload dialog only, rendered
read-only on `/hr/documents/[id]`. One carve-out: editable while that version
has **zero** acknowledgments, for the admin who forgets to tick it and notices
five minutes later. Frozen after the first signature — un-demanding a signature
already given cannot be undone, and newly demanding one from people who were
told they were finished is worse.

**What Phase B does not do.** No new-file-vs-new-version fork in the upload
dialog. Uploading through `/hr/documents/[id]` *is* a new version by
definition; "new file, everyone signs" is already a different button, and a
fork there is a way to accidentally orphan a signature history.

## 11. Case B — parked

Per-person re-verification. Not designed, not filed as work. Blocked on the
Key Agreement's document kind (section 3).

If it turns out to be needed for `Acknowledgment` documents, the sketch is an
append-only `HrSigningReset` table keyed `(hrDocumentId, staffMemberId,
requestedByUserId, reason, createdAt)`, ADMIN only, with a resolver:

```
effectiveCycle(staff, document) = staff.signingCycle + resetCount(document, staff)
```

Addition, not `max()`. With `max()`, a document reset to cycle 2 followed by a
rehire to cycle 2 would silently satisfy itself. Both existing unique
constraints already carry `signingCycle` and need no change; two records side
by side is already guaranteed by construction, since `HrSignedRecord` is
append-only with no update or delete path.

---

## 12. Items needing Gary's ruling before Phase A is written to the board

1. The precedence table in section 4, rows 4 and 5 as split.
2. Row 4 beats row 6 — the Gdogg partial-rows precedence.
3. Row 4 counts toward the compliance percentage.
4. The exact wording of the read-only notice in section 6.
5. Phase A carries no schema change; Case A's column waits for Phase B.

A recommendation is not a ruling. These land in `docs/ROADMAP.yaml` in Gary's
words, or they do not land.
