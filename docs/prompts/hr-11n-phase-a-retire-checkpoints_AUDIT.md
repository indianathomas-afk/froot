# HR-11n Phase A — audit

**Session:** 2026-08-15. Prompt: `docs/prompts/hr-11n-phase-a-retire-checkpoints.md`.
**Audited against:** local `staging` @ `0e49bdb` ("docs(roadmap): lead paragraphs on
HR-11k and HR-11n for legibility"). Working tree clean apart from the untracked
prompt file itself.

Read-only. Nothing was edited to produce this document, and no database was
queried — every finding below is from source at the SHA named above.

This file is a session artifact (CLAUDE.md § Where documents live). It is a claim
wholesale and is never edited after the fact.

---

## 0. Method, and why it is written down

The sweep was performed by enumerating **every read of the checkpoint relation**
— `prisma.hrDocumentCheckpoint` plus every `checkpoints:` include/select in
`src/` — and then checking each consumer of each load individually.

It was NOT performed by grepping for the name of any guard or filter. That
direction cannot work here for the reason CLAUDE.md § Verifying a guard covers
every path records: a site that is *missing* a filter has nothing to match on, so
the search returns a clean result and the session stops looking. HR-11j lost a
session to exactly this shape on `isSigningBlocked`, and DEBT-22 lost one before
it on unordered `storeAssignments` loads.

The enumeration below is therefore keyed to the **loads**, which are greppable,
rather than to the filters, which are not.

---

## 1. Does the signing ceremony still build its step list unfiltered?

**Yes — and there are TWO ceremony pages, not one.** HR-11m put no filter in
either path.

| File | Load | Render |
|---|---|---|
| `src/app/(app)/hr/acknowledge/[documentId]/page.tsx:40` | `checkpoints: { orderBy: { orderIndex: "asc" } }` | `:201` — `doc.checkpoints.map(...)` → `clientCheckpoints` |
| `src/app/(my)/my/documents/[documentId]/page.tsx:29` | identical | `:151` — identical shape, inline |

Neither carries an anchor filter, a `required` filter, or any other predicate.
Every document-scoped checkpoint becomes a ceremony step.

**What HR-11m actually changed.** Its entire edit was inside
`syncCheckpointsForConfirmedAnchors` (`src/lib/hr-anchors.ts:623–741`): it moved
the Signature reuse key off the version-scoped `DocumentAnchor.generatedCheckpointId`
and onto a document-scoped `pageRef` + ordinal key, so a new version stops
*minting* a fresh checkpoint for a signature line that already has one. That is a
fix to the WRITE path. It says nothing about what renders, which is why the
backlog it stopped growing is still fully visible.

**Three entry points, two files.** The third ceremony entry point is
`/hr/acknowledge/[documentId]` in attested mode, which is the same file as the
first. Both ceremony CLIENTS — `signing-client.tsx` and `acknowledge-client.tsx`
— derive their entire step list from the `checkpoints` prop and perform no
database read of their own (`signing-client.tsx:135, 147, 152–154`;
`acknowledge-client.tsx:83`). Filtering at the two pages above therefore covers
all three entry points, and no client-side change is needed for the step list.

---

## 2. Every read path that counts or renders checkpoints

**Nine read sites.** The prompt's known list named four of them and was wrong
about two others; corrections are in § 2.4.

### 2.1 Completion denominator — five sites

| # | Load | Consumer | Load already filtered? |
|---|---|---|---|
| **A** | `src/app/api/hr/documents/[id]/acknowledgments/route.ts:74` — `checkpoints: true` | `:295` `doc.checkpoints.filter(c => c.required).every(c => ackedIds.has(c.id))` | **No** — fully unfiltered |
| **B** | `src/lib/hr-signed-pdf.ts:281` — `checkpoints: { orderBy: { orderIndex: "asc" } }` | `:292` `missing` → `SignedRecordError` at `:294` | **No** — fully unfiltered |
| **C** | `src/lib/hr-compliance.ts:236` — `where: { required: true }` | `:401–424` → `documentCompletion` | Partly — `required` only |
| **D** | `src/app/(app)/staff/[id]/page.tsx:184` — `where: { required: true }` | `:214–227` → `documentCompletion` | Partly — `required` only |
| **E** | `src/app/(my)/my/documents/data.ts:52` — `where: { required: true }` | `:82–96` → `documentCompletion` | Partly — `required` only |

C, D and E already carry a `where` clause on the load, so each admits a one-line
addition. A and B are unfiltered loads whose consumers must each be filtered
individually — and B has four separate consumers (§ 2.2).

All three of C/D/E feed the single pure predicate `documentCompletion`
(`src/lib/hr-completion.ts:107`), which does not query and takes `requiredCount`
and `allRequiredAcked` as inputs. **The predicate itself needs no change.** It is
correct as written; what changes is the facts its callers establish. This is the
same division of labour R1 introduced deliberately (`hr-completion.ts:23–29`:
"WHAT THE CALLER STILL OWES").

### 2.2 The certificate — four consumers of ONE unfiltered load

All four read `doc.checkpoints` from site **B** (`hr-signed-pdf.ts:281`):

| Line | What it drives |
|---|---|
| `:292` | `missing` — the mint refusal (also counted as a denominator, above) |
| `:322` | `orderedAcks` — the checkpoint table at `:539` **and** the per-page initials grid at `:574` |
| `:328` | `Math.max` over required acks' `signedAt` |
| `:486` | the signature/acknowledgment `orderedAcks.find(...)` lookup |

`orderedAcks` filters on `!!x.ack` only. A retired checkpoint that carries an
acknowledgment — which is the entire population this feature exists for — still
appears in the certificate table today.

**A fifth consumer is anchor-driven, not checkpoint-driven:** `:429` and `:449`
resolve a stamp through `anchor.generatedCheckpointId` → `ackByCheckpoint`, never
through `doc.checkpoints`. It is a distinct code path and does not inherit a
filter applied to `orderedAcks`. See § 3.3.

### 2.3 Render and admin — three sites

| # | Site | Note |
|---|---|---|
| **F** | `src/app/(app)/hr/acknowledge/[documentId]/page.tsx:40` → `:201` | ceremony step list |
| **G** | `src/app/(my)/my/documents/[documentId]/page.tsx:29` → `:151` | ceremony step list, staff portal |
| **H** | `src/app/(app)/hr/documents/[id]/page.tsx:30–45` → `:71–80` | admin checkpoint list |

**H already loads the acknowledgment count** via
`_count: { select: { acknowledgments: true } }` at `:44`, surfaced as
`acknowledgmentCount` at `:79` and consumed by the delete lock at
`document-detail-client.tsx:798`. The count required by the retire confirm
dialog is therefore already on the client and needs no new query.

That count is **deliberately unfiltered** — every acknowledgment, every staff
member, every version, every signing cycle — and the reasoning is recorded at
`page.tsx:32–43` (DOC-1 C): audience-filtering it would let a checkpoint become
deletable once its only signer left the audience, reaching backwards into a
signature already given. "Has anyone ever signed this" is a different question
from "who owes it". **Retirement must not disturb this count or its reasoning**;
it is the input to the confirm dialog's "these acknowledgments will be preserved"
statement, and the unfiltered form is the correct one for that sentence too.

### 2.4 Corrections to the prompt's known list

1. **There is no checkpoint list API.**
   `src/app/api/hr/documents/[id]/checkpoints/route.ts` exports `POST` only.
   `[checkpointId]/route.ts` exports `PATCH` and `DELETE`. No `GET` exists on
   either. The admin list is server-rendered at site **H**. There is nothing to
   filter at an API layer, and a session looking for one would find nothing and
   might conclude the surface was already covered.

2. **The HR-11j staff-portal readiness check is not a checkpoint denominator.**
   It is `getVersionAnchorReadiness(version.id)` at
   `src/app/(my)/my/documents/[documentId]/page.tsx:64`, added by HR-11j Item 4
   as layer (b) on the route that never had it. It counts **`DocumentAnchor`
   rows**, not checkpoints (`hr-anchors.ts:501–509`), and applies
   `isSigningBlocked(matched, confirmed)`. **It requires no change for
   retirement.** The staff portal's actual checkpoint denominator is site **E**,
   in `data.ts`, which is a different file on a different screen.

   Recording this explicitly because the prompt asked for it by the words
   "readiness check" and the thing that answers to that name is the wrong object.
   Filtering it would be a real defect: retiring a checkpoint has nothing to say
   about whether a version's detected fields are confirmed.

3. **Compliance and progress surfaces are downstream of C/D/E, not separate
   sites.** `staff-compliance.tsx:64,66`, `staff-documents.tsx:57`,
   `my/page.tsx:206` and `my/documents/page.tsx:30` all render
   `ackedCount`/`requiredCount` handed to them as props. They hold no query and
   need no edit.

### 2.5 Write paths that touch checkpoints (not denominators)

Listed for completeness so a later reader does not have to re-derive that they
were considered and excluded:

- `src/lib/hr-anchors.ts:636` — the reuse candidate pool inside
  `syncCheckpointsForConfirmedAnchors`; `:661` and `:731` create.
- `src/app/api/hr/documents/[id]/checkpoints/route.ts:45` — `_max.orderIndex`
  for the next index; `:52` creates.
- `src/app/api/hr/documents/[id]/checkpoints/[checkpointId]/route.ts:19`
  `findCheckpoint`, `:56` update, `:85` delete.
- `src/app/api/hr/documents/route.ts:114` — the upload-time default set
  (one Initial per page + a final Acknowledgment).

---

## 3. Three behaviour gaps the prompt's § 4 does not cover

### 3.1 The mid-ceremony 400 will not fire — the exposure is the opposite one

§ 4 instructs: if a submission arrives containing entries for a checkpoint
retired since the page loaded, drop those entries rather than return a 400.

**The 400 cannot trigger.** Site **A** loads `checkpoints: true` unfiltered
(`acknowledgments/route.ts:74`), so a retired checkpoint is still present in
`checkpointById` (`:156`) and the "Unknown checkpoint" branch at `:159–161` is
never reached. Left alone, the entry falls through validation and is **inserted
as an acknowledgment row on a retired checkpoint** at `:243–274`.

So the instruction is right and the reason given for it is not: the risk is not a
spurious refusal, it is a silent write. **The drop must be written explicitly**;
it does not come for free from any filter applied to the completion gate at
`:295`.

Second-order consequence: `entries` is validated non-empty by Zod at parse time
(`:65`, "at least one checkpoint are required"), but the drop happens *after*
that gate. A submission consisting entirely of entries for retired checkpoints
empties the array. That path must return the live-set completion result — it is
a signer who has nothing left to do — and must not fall into the empty-entries
error, which would refuse exactly the mid-ceremony signer § 4 exists to protect.

### 3.2 `orderedAcks.reduce` at `hr-signed-pdf.ts:325` has no initial value

```
const lastAck = orderedAcks.reduce((a, b) => (a.ack.signedAt > b.ack.signedAt ? a : b)).ack
```

`Array.prototype.reduce` with no seed **throws `TypeError` on an empty array**.
Today `orderedAcks` is non-empty whenever this line is reached, because `missing`
at `:292` has already refused any incomplete set and a complete set implies at
least one ack. Once a retirement filter is applied to `:322`, that implication no
longer holds: a document whose every acknowledged checkpoint has been retired
passes `missing` (nothing required is outstanding) and arrives here with an empty
array.

Reachable, not hypothetical, and it fails inside certificate generation rather
than at a validation boundary. Needs an explicit guard.

`:328` has the same shape one line later but is already seeded by spreading into
`Math.max`, which returns `-Infinity` rather than throwing — a different wrong
answer, and worth checking rather than assuming.

### 3.3 Certificate stamping is anchor-driven and does not inherit the table's filter

§ 4 excludes a retired checkpoint from "the checkpoint table of any certificate
generated after retirement". It says nothing about the **inline stamps** drawn
onto the document body.

Those are resolved through the anchor, not the checkpoint list:
`hr-signed-pdf.ts:429` (`sigAck`) and `:449` both read
`a.generatedCheckpointId ? ackByCheckpoint.get(a.generatedCheckpointId) : undefined`,
where `a` iterates confirmed anchors. A filter on `orderedAcks` does not reach
them.

On today's data this does not bite — the four orphans on the test document are
orphans precisely because no anchor points at them — but the rule was undefined,
and a document where an admin retires an anchor-backed checkpoint would produce a
stamp on the page for a step the certificate does not list.

**Ruled by Gary 2026-08-15, in this session, after this audit was presented:**
retired checkpoints are excluded from inline stamping as well as from the
certificate table. A stamp is a claim on the page body and must not appear for a
step the certificate does not list. `:429` and `:449` are filtered sites.

---

## 4. Confirmations requested by the prompt

### 4.1 `DocumentAnchor.generatedCheckpointId` is a soft pointer — CONFIRMED

`prisma/schema.prisma:1745` declares `generatedCheckpointId String?` with no
`@relation` attribute. The physical column
(`prisma/migrations/20260723220118_hr11b_document_anchors/migration.sql:23`) is a
bare `"generatedCheckpointId" TEXT`; no `FOREIGN KEY` constraint on it exists
anywhere in the migration history. The design intent is recorded at
`schema.prisma:1731–1732`: "generatedCheckpointId is a soft pointer (no FK) so
checkpoint removal never cascades into anchor integrity."

### 4.2 The DELETE 409 guard is where the prompt describes it — CONFIRMED

`src/app/api/hr/documents/[id]/checkpoints/[checkpointId]/route.ts:78–83`
branches on `checkpoint._count.acknowledgments > 0`, sourced from the include at
`:24` inside the shared `findCheckpoint` helper (`:18–26`), and returns 409 with
the copy "This checkpoint has been signed and is part of the permanent record —
mark it not required instead". The hard delete at `:85` is reached only when the
count is zero.

Note the existing copy names `required: false` as the remedy. Once retirement
ships, that sentence points at the weaker of two available actions — worth a
copy revision, but the prompt states the DELETE route is not modified in Phase A
and this audit does not propose changing it.

---

## 5. The one place the prompt's own plan did not survive the audit

**Prompt § 2.3 asked whether HR-11m left a reusable helper resolving "which
checkpoint does this version's anchor set back" via `pageRef` + ordinal, on the
premise that Phase A reuses it rather than reimplementing the reuse key.**

**There is no such helper.** The key is inline inside
`syncCheckpointsForConfirmedAnchors` (`src/lib/hr-anchors.ts:623–741`),
specifically at `:702–728`:

- a per-page `sigSeenOnPage` counter (`:702–703`) over anchors ordered
  `(page asc, y desc)` from the query at `:627–630`;
- a first attempt through `a.generatedCheckpointId` (`:708–715`);
- else the k-th entry of
  `checkpoints.filter(c => c.type === "Signature" && c.pageRef === a.page)[k]`
  (`:723–728`), indexed against the **unfiltered** page list;
- guarded by a `claimedSignatureIds` set (`:649`, `:736`) so two anchors cannot
  collapse onto one checkpoint.

It is not extracted, and it is **interleaved with mutation**: `:661` and `:731`
create checkpoints and `:653` updates anchors inside the same loop. Prompt § 6
requires the Anchor column to be display-only — "must not write, mutate, or
re-detect anything" — so this code cannot be called as it stands. Honouring both
§ 2.3 and § 6 would require extracting a pure resolver *out of* the G1-critical
sync path, which is a refactor of the file HR-11m just changed.

**Ruled by Gary 2026-08-15, after this finding was presented:** the Anchor
column and § 2.3 are **withdrawn from Phase A**. `src/lib/hr-anchors.ts` is not
edited this session. Extraction of the reuse key becomes **HR-11n Phase B**, its
own session, where the refactor is the whole job and can be reviewed on its own
terms. Phase A instead ships a read-only Neon console query, run by Gary, that
answers the same question against the database — preserved in § 6.

---

## 6. Hand-off query — anchor backing, run by Gary in the Neon console

Not run by this session. Read-only. Replace the document id.

`retiredAt` exists only after this phase's migration has been applied to the
branch being queried; against a branch that predates it, drop that one column.

```sql
SELECT
  current_setting('neon.branch_id', true) AS branch_id,
  current_database()                      AS database,
  c."orderIndex",
  c."type",
  c."name",
  c."pageRef",
  c."required",
  c."retiredAt",
  (SELECT count(*)
     FROM "HrDocumentAcknowledgment" a
    WHERE a."checkpointId" = c.id)        AS ack_count,
  EXISTS (
    SELECT 1
      FROM "DocumentAnchor" da
      JOIN "HrDocumentVersion" v ON v.id = da."hrDocumentVersionId"
     WHERE da."generatedCheckpointId" = c.id
       AND da.confirmed
       AND v."hrDocumentId" = c."hrDocumentId"
       AND v."isCurrent"
  )                                       AS anchor_backed_on_current_version
FROM "HrDocumentCheckpoint" c
WHERE c."hrDocumentId" = 'cmstv3r1s000004jxdcyhkbui'
  AND c."type" IN ('Signature', 'Initial')
ORDER BY c."type", c."orderIndex";
```

`branch_id` and `current_database()` are selected in the same result as the rows
(CLAUDE.md § Database Evidence — "let the query carry the branch, and still name
it"). A checkpoint with `ack_count > 0` and
`anchor_backed_on_current_version = false` is an orphan of the shape this phase
exists to retire.

---

## 7. Scope as approved, after the audit

Approved by Gary 2026-08-15 following this audit:

- schema + additive migration — `retiredAt`, `retiredByUserId`, `retiredReason`,
  all nullable, no defaults;
- the nine filter edits across eight files (§ 2), with stamping included per
  § 3.3;
- the explicit entry-drop at site **A**, returning the live-set completion result
  rather than an error when the array empties (§ 3.1);
- the empty-array guard on the `orderedAcks` reduce (§ 3.2);
- retire / unretire ADMIN routes; DELETE and its 409 untouched;
- retire action, confirm dialog and collapsed Retired section on the admin
  checkpoint list, using the acknowledgment count already loaded at site **H**;
- the certificate caveat copy.

Withdrawn to Phase B: the Anchor column and the reuse-key extraction (§ 5).
Unchanged: no auto-retire, no backfill migration, nothing retired by this
session.

---

## 8. Measured baseline, and what it changed

Added 2026-08-15, after §§ 1–7 were written. The § 6 query was run by Gary in
the Neon console; `retiredAt` was dropped from it because this phase's migration
had not yet been applied to any branch.

**`preview/staging` — branch `br-square-feather-a63z92vz`, database `neondb`,
org `org_3G02wO4QlVVSWppi8aqlnSZnsDa`, document `cmstv3r1s000004jxdcyhkbui`.**
Branch id and database were selected in the same result as the rows.

| orderIndex | type | page | acks | anchor-backed |
|---|---|---|---|---|
| 0 | Initial | 1 | 4 | **false** |
| 1 | Initial | 2 | 4 | true |
| 2 | Initial | 3 | 4 | true |
| 3 | Initial | 4 | 4 | true |
| 5 | Signature | 3 | 4 | true |
| 6 | Signature | 4 | 4 | true |
| 7 | Signature | 3 | 3 | **false** |
| 8 | Signature | 4 | 3 | **false** |
| 9 | Signature | 3 | 2 | **false** |
| 10 | Signature | 4 | 2 | **false** |

The prompt's account is confirmed by measurement: six Signature checkpoints for
two real signature lines, four orphaned, **every orphan carrying
acknowledgments** — so all four are refused by the DELETE 409 and have no
removal path today. Eighteen signature acknowledgments exist for two signature
lines. The descending counts (4,4 → 3,3 → 2,2) order the orphans by age: each
later pair was minted at a subsequent confirmation and has accumulated fewer
signatures since.

`orderIndex` 4 is absent from the result because it is the Final acknowledgment
checkpoint, excluded by the query's `type IN ('Signature','Initial')` clause.
Its position also confirms `pageCount = 4` — the upload generator writes
Initials at 0..N-1 and the Acknowledgment at N.

### 8.1 FINDING — an unbacked Initial is normal, and retiring one would be a defect

**"Page 1 initials" (orderIndex 0, four acknowledgments) is not anchor-backed,
and is entirely legitimate.**

Initial checkpoints are not generated from anchors. They are minted one per page
at upload by `src/app/api/hr/documents/route.ts:114–121`; the anchor sync only
*links* a detected Initial anchor to a checkpoint that already exists
(`hr-anchors.ts:658–666`). An unbacked Initial therefore means "no `Initial:`
token was detected on that page of the current version, so nothing is stamped
there" — the ceremony still correctly asks for initials on that page, and on
this document four people have given them. Pages 2–4 are backed and page 1 is
not, so the current version carries Initial anchors on three of its four pages.

**RULED BY GARY 2026-08-15:** the retire criterion is
**`type = 'Signature' AND anchor_backed = false`**. The anchor flag alone is
never the criterion, for any row type.

**Carried to Phase B:** the Anchor column must be **type-aware, not a bare
boolean**. Rendered as a plain true/false against every row it would have
displayed `false` beside a live initials line with four signatures on it, next
to a Retire action — which is an invitation to destroy a legitimate ceremony
step. The column was withdrawn from Phase A for an unrelated reason (§ 5); this
is a second, independent reason its design is not yet finished.

Note how this was found. The column was specified in the prompt as a display of
"does a confirmed anchor on the current version back this checkpoint" — a
question that is meaningful for Signature checkpoints, where anchors mint the
row, and misleading for Initial checkpoints, where they do not. The defect was
invisible in the specification and visible in one row of real data. It would not
have surfaced from reading the code either, because both types genuinely do
resolve through `generatedCheckpointId` — what differs is what an absence
*means*.

### 8.2 Correction to prompt § 9 — "page 28" is the wrong document

Prompt § 9 asks Gary to expect that, after retiring the four orphans, "page 28
renders one 'Sign here' button on that signature line instead of three".

**Page 28 belongs to the real Employee Handbook, whose four signature lines are
on pp. 11 / 22 / 24 / 28 (recorded in the HR-11m ROADMAP row). This test
document's signature lines are on pages 3 and 4**, each currently rendering
three stacked buttons — orderIndex 5/7/9 on page 3, 6/8/10 on page 4. After
retirement, one button each.

The rest of § 9 holds exactly as written: the required signature-step count
falls from six to two, and no existing signed record changes state.

Corrected here and **not** in the prompt. A saved prompt is a claim wholesale and
is never edited (CLAUDE.md § Where documents live); the browser check is simply
run against pages 3 and 4.

### 8.3 The prompt file's § 1 placeholder — a corrected draft, not an edited prompt

For the record, because a later reader comparing the prompt against this audit
will otherwise find a discrepancy they cannot account for.

At the time §§ 1–7 above were written, `docs/prompts/hr-11n-phase-a-retire-checkpoints.md`
still carried its § 1 placeholder — `<<< GARY PASTES THE RATIFIED HR-11n RULING
TEXT HERE BEFORE THIS SESSION RUNS >>>` — and § 1 instructs the session to stop
and say so. The session stopped and reported it three times before proceeding;
the file was verified unchanged on disk by hash on each occasion.

Gary supplied the replacement text in chat and instructed that it be written into
the file, which was done verbatim: the block became "What this session builds",
five numbered behaviours plus the reversibility line. **This was a corrected save
to an UNTRACKED, UNCOMMITTED draft, not an edit to an executed prompt.** The file
had never been committed, so it had not entered the record library that the
never-edit rule protects, and the block replaced was a slot explicitly marked to
be filled *before* the session ran. Nothing composed, paraphrased or tidied by
Claude Code.

Spec item 5 of that replacement — "a signer mid-ceremony ... never has an entry
silently recorded against a retired checkpoint" — independently confirms the
§ 3.1 finding above, which was written before the text existed.

### 8.4 OPEN AT THE TIME OF WRITING — is HR-11m actually closed?

The checkpoint total on this document was **7** at the HR-11k acceptance
pre-check (2026-08-15, recorded in that row) and is **11** today. Four Signature
checkpoints were minted in between, and HR-11m's entire job was to stop that
minting. **If any of the four postdates HR-11m reaching staging, HR-11m is not
closed and Phase A is a cleanup tool built against a leak that is still
running.**

`HrDocumentCheckpoint` has no `createdAt`, so the rows must be dated by proxy.

HR-11m provenance, measured rather than transcribed: commit
`974bf494ca06c010759bfdebb7290e18f86e326f`, committed **2026-08-15 12:43:16
PDT**; deployment `dpl_3UP4Hu4tHAHQXvgF7a8fYjWp3uH2`, created **2026-08-15
12:46:58 PDT**, holding the `froot-git-staging` alias. **12:46:58 PDT is the
comparison line.**

The HR-11m row already claims the answer — its live acceptance measured this
document's composition before and after the V4 anchor confirm on the fixed
deployment as *identical, total 11, Signature 6*, which would place all six
Signature checkpoints before the fix was exercised. That claim is recorded by
the session that shipped the fix and is not treated here as settling the
question.

**The proxy is one-directional, and this is the part most likely to be
misread.** `MIN(signedAt)` bounds a checkpoint's creation from ABOVE only — it
proves the row existed by that moment, never when it was created. So
`MIN(signedAt)` earlier than 12:46:58 PDT **exonerates** that row conclusively;
`MIN(signedAt)` later than 12:46:58 PDT **proves nothing**, being equally
consistent with a post-fix leak and with an old checkpoint signed late. The
query can clear HR-11m. It cannot convict it.

The sharper instrument is `HrDocumentAcknowledgment.documentVersionNumber`, the
version snapshot frozen at signing time: it dates a checkpoint to a VERSION
rather than to a clock reading, and versions are what mint checkpoints. An
orphan acked only on the newest version, first signed after 12:46:58 PDT, is the
shape that would mean HR-11m is leaking. Both queries were handed to Gary to run
in the Neon console; neither was run by this session.

### 8.5 RESOLVED — HR-11m is closed

Both queries run by Gary in the Neon console, `preview/staging`
(`br-square-feather-a63z92vz` / `neondb`), branch id and database selected in the
same result as the rows.

**THE COMPARISON REQUIRES A TIMEZONE CONVERSION, AND THE RAW NUMBERS READ THE
OPPOSITE WAY WITHOUT IT.** `HrDocumentAcknowledgment.signedAt` is
`TIMESTAMP(3)` with no time zone (`20260712120000_hr0_...` line 86) and there is
no `@db.Timestamptz` anywhere in the schema, so Prisma stores UTC. Vercel
reports deployment times in PDT. The deploy line **12:46:58 PDT is 19:46:58
UTC**.

| orderIndex | first_signed (UTC) | vs 19:46:58 UTC | verdict |
|---|---|---|---|
| 5 | 2026-08-15 04:21:40 | −15h 25m | pre-fix |
| 6 | 2026-08-15 04:21:45 | −15h 25m | pre-fix |
| 7 | 2026-08-15 19:02:55 | −44m | pre-fix |
| 8 | 2026-08-15 19:03:02 | −44m | pre-fix |
| 9 | 2026-08-15 19:11:34 | −35m | pre-fix |
| 10 | 2026-08-15 19:11:46 | −35m | pre-fix |

Every orphan was signed before the fix deployed, therefore existed before it.
This is the conclusive direction of the one-directional proxy described in
§ 8.4. **HR-11m is exonerated.**

Compared naively, `19:02` against a deploy at `12:46` reads as an orphan
appearing six hours AFTER the fix — which would have convicted HR-11m, declared
a live leak, and stopped this phase on a false finding. The column type was
checked only because the answer looked wrong. **Record the clock alongside any
timestamp used as evidence**; this is § Database Evidence's missing-label
failure in a different coordinate, and it fails in the direction that manufactures
an urgent, coherent, entirely wrong conclusion.

**Query B is the sharper confirmation and does not depend on any clock.**
Acknowledgment `documentVersionNumber` per checkpoint:

```
orderIndex 5, 6   → {1,2,3,4}   the original pair, present since v1
orderIndex 7, 8   → {2,3,4}     minted at v2
orderIndex 9, 10  → {3,4}       minted at v3
```

**No checkpoint is acknowledged on {4} alone.** v4 is the post-fix version —
uploaded with different bytes and its anchors confirmed on deployment
`dpl_3UP4Hu4tHAHQXvgF7a8fYjWp3uH2`. A leaking HR-11m would have minted a seventh
and eighth Signature checkpoint at that confirm, acked on v4 and nothing else.
That pair does not exist; instead all six carry a v4 acknowledgment, so the
ceremony presented six and minted none. The defect model is confirmed exactly:
**+2 at v2, +2 at v3, 0 at v4.**

This also independently corroborates the HR-11m row's live-acceptance claim
(composition identical before and after the V4 confirm, total 11 / Signature 6)
by a different method than the one that session used.

**WHERE THE FOUR ORPHANS CAME FROM.** The v2 pair was first signed at 12:02 PDT,
after the HR-11k acceptance pre-check measured 7 checkpoints at approximately
09:45 PDT the same morning. The event between those two points was the
confirmation of v2's anchors — which was HR-11k's own R4 acceptance test
("confirming v2's anchors makes it assignable"). **The HR-11k acceptance session
minted two of these orphans while verifying something else**, under pre-fix code,
hours before HR-11m was written that afternoon; the v3 pair followed nine minutes
later in the HR-11m reproduction. That accounts for the 7 → 11 growth in full,
with no post-fix minting anywhere in it.

**CONCLUSION: Phase A is a cleanup tool against a STOPPED leak, which is what it
was designed to be.** The filter edits proceeded from here.
