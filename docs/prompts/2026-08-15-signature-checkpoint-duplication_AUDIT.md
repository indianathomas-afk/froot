# Item 1 audit — Signature checkpoint duplication across versions

**Session prompt:** `docs/prompts/2026-08-15-signature-checkpoint-duplication.md`
**Tier:** 2. **Date:** 2026-08-15. **Status at write time:** Item 1 complete,
stopped for Gary's ruling. Nothing in `src/` was touched.

---

## Precondition — FAILED, and the assessment

| Check | Result |
|---|---|
| Local `HEAD` == `origin/staging` | **FAIL** — `78a045b` vs `717f37b`, 3 commits ahead |
| Deployed staging SHA == local `HEAD` | **FAIL** — alias serves `717f37b` |

Alias `froot-git-staging-indianathomas-2483s-projects.vercel.app` → deployment
`dpl_8dqx2ay7Hx3rWAFxqkXgSvTTmUJj` (`froot-gthvkp3w8`, created 2026-08-15
09:45:13 PDT), and `npx vercel ls --meta githubCommitSha=717f37bb…` returns that
same deployment. So staging is built from `origin/staging`.

The three unpushed commits are **docs-only**:

```
78a045b docs(deploy-log): 2026-08-15 staging deploy + HR-11j acceptance pass   docs/DEPLOY_LOG.md
523a35a docs(roadmap): HR-11j verified — acceptance passed; file R2 as HR-11k   docs/ROADMAP.yaml
17524c0 docs(roadmap): HR-11j — deployment confirmation and the acceptance pre-check   docs/ROADMAP.yaml
```

`git diff --stat 717f37b..78a045b -- src prisma` is **empty**. The deployed code
is byte-identical to local `HEAD` across `src/` and `prisma/`.

**Why Item 1 proceeded anyway.** The precondition exists to stop observations
being taken against different code. Item 1 takes no observation from staging:
it is a read of local source plus detection run against local PDF bytes, and
every database question it raises is handed to Gary as SQL for the Neon console
rather than run here. The failure is therefore inert for this item. It is **not**
inert for Item 2's live acceptance (step 2 of Verification), which cannot run
until the three commits are pushed.

---

## The defect — confirmed, and measured independently

`syncCheckpointsForConfirmedAnchors` (`src/lib/hr-anchors.ts:621`).

- **Initial** (`:640`) reuses on `c.type === "Initial" && c.pageRef === a.page`.
  Both operands are document-scoped, so the lookup survives across versions.
- **SignatureStamp** (`:655`) reuses only when `a.generatedCheckpointId` already
  points at a Signature checkpoint. That pointer is a column on `DocumentAnchor`,
  which is keyed by `hrDocumentVersionId` (`prisma/schema.prisma:1733-1752`).
  Checkpoints are keyed by `hrDocumentId` (`:1711-1723`).

A new version's anchors are fresh rows with `generatedCheckpointId` null, so the
lookup misses and a new checkpoint is minted every time. The prompt's diagnosis
is correct as written.

`carryForwardConfirmedAnchors` (`:569`) already copies `generatedCheckpointId`
forward — but **only when the new file's sha256 equals the prior version's**
(`src/app/api/hr/documents/[id]/versions/route.ts:99`). Different bytes, no
carry-forward, fresh anchors, duplicate checkpoints. The v1→v2→v3 test uploads
were different bytes by construction, which is why they hit it.

### Independent reproduction, no database

The shipped `detectAnchors()` was run against the PDFs on disk (bytes only; the
function touches no database). Verbatim results:

```
=== V1_Test_Employee_Handbook.pdf — 4 pages, 10 anchors, 2 SignatureStamp, 3 Initial ===
  page 3: 1 signature anchor(s)   "Employee’s Signature"  x=36.0 y=570.1 placement=Above
  page 4: 1 signature anchor(s)   "Employee Signature:"   x=36.0 y=493.6 placement=Right
  Initial: 3 anchors on 3 distinct pages; no same-page multiples
```

V2 and V3 are identical in anchor structure (same 2 SignatureStamp, same pages,
same coordinates, same 3 Initial).

**2 signature anchors per version × 3 versions = 6 Signature checkpoints for 2
lines.** That is the "+2 per version" in the prompt's table (7 → 9 → 11), and it
matches the six entries on Gdogg Thomas's v3 certificate exactly. The 3 Initial
anchors sit on 3 distinct pages and reuse cleanly — the asymmetry reproduces.

(The test document carries **four** Initial checkpoints against three Initial
anchors. The extra is the phantom page-1 Initial, listed out of scope.)

---

## The question: what is the correct reuse key?

### Empirical input — the real handbook has no same-page signature pairs

`detectAnchors()` against `froot_docs/hr_research/2026 Employee Handbook.pdf`:

```
=== 2026 Employee Handbook.pdf — 28 pages, 41 anchors, 4 SignatureStamp, 27 Initial ===
  page 11: 1 signature anchor(s)   "Employee Signature:"   x=36.0 y=76.6   placement=Right
  page 22: 1 signature anchor(s)   "Employee’s Signature"  x=36.0 y=118.1  placement=Above
  page 24: 1 signature anchor(s)   "Employee’s Signature"  x=36.0 y=570.1  placement=Above
  page 28: 1 signature anchor(s)   "Employee Signature:"   x=36.0 y=493.6  placement=Right
  Initial: 27 anchors on 27 distinct pages; no same-page multiples
```

Four signature lines, four distinct pages, **one per page**. The open question in
the prompt is answered: there are no same-page pairs in the real handbook today.
The 27 Initial anchors are likewise one per page — which is why Initial's
`pageRef` key has never been stressed. It is not that `pageRef` was proven
sufficient; it is that nothing has tested it.

(For cross-reference: `prisma/schema.prisma:1709` records the HR-0a spike finding
"35 checkpoints: 3 Field, 27 Initial, 1 Signature, 4 Acknowledgment" against the
real handbook. The Initial count still matches. The Signature count does not —
it is 4 now, because HR-11d added the tokens on pp. 22/24 and the bare
`Signature:` form. Treat the spike's Signature figure as superseded.)

### What the checkpoint row can key on

`HrDocumentCheckpoint` has `name`, `type`, `orderIndex`, `pageRef`,
`attestationText`, `required`. No column carries the anchor's identity, and no
schema change is in scope.

Admin editability matters here and cuts against two of the candidates.
`PATCH /api/hr/documents/[id]/checkpoints/[checkpointId]` accepts `name`,
`pageRef`, `attestationText`, `required`, `orderIndex`. The admin UI form
(`document-detail-client.tsx:650`) sends `name`, `type`, `pageRef`,
`attestationText`, `required` — it does **not** expose `orderIndex`, which is
display-only at `:614`.

- `name` is UI-editable → unusable as a key.
- `pageRef` is UI-editable → usable but not immutable.
- `orderIndex` is API-reachable but not UI-reachable → the most stable of the three.

`DELETE` on a checkpoint exists and is ack-guarded: it returns 409 when
`_count.acknowledgments > 0` (`route.ts:78-83`).

### Candidate A — `pageRef` alone

`c.type === "Signature" && c.pageRef === a.page`, mirroring Initial.

Fixes the measured case. Fixes the real handbook. Costs one line.

Its failure is silent and specific: two signature lines on one page collapse to a
single checkpoint — one signer act, one timestamp for two distinct attestations.
That is precisely the behavior HR-11j removed, and the code comment at `:648-654`
names it as the thing being fixed ("never reuse another anchor's… the prior
behavior, which collapsed all signatures onto one timestamp"). Candidate A gives
part of that back in exchange for one line.

### Candidate B — `pageRef` + ordinal

Reuse the *k*-th Signature checkpoint with `pageRef === a.page`, ordered by
`orderIndex`, where *k* is the anchor's index among SignatureStamp anchors on
that page in y-descending order.

The ordinal is already available: the function iterates anchors
`orderBy: [{ page: "asc" }, { y: "desc" }]` (`:627`) and assigns `orderIndex`
monotonically as it mints (`:630`, `nextOrder++`). So for any checkpoint this
function created, the *k*-th by `orderIndex` on a page **is** the one minted for
the *k*-th anchor by y-descending on that page. The invariant the ordinal needs
already holds in the data.

On every document in play today — one signature line per page — B and A are
behaviorally identical. B differs only in the case A gets wrong.

Two honest weaknesses:

1. The match is **positional, not identity-based**. If a future version adds a
   signature line above an existing one on the same page, every ordinal on that
   page shifts by one and anchors adopt each other's checkpoints. The damage is
   bounded — it is a wrong reuse, not a duplicate, and it stays inside one page.
2. A checkpoint `DELETE` on that page re-ranks the survivors, re-targeting which
   checkpoint gets adopted. Growth still stops; the target moves.

### Candidate C — inherit from the previous version's anchors

Generalize `carryForwardConfirmedAnchors` from the identical-hash case to every
version: for each SignatureStamp anchor with a null pointer, find the most recent
prior version that has confirmed SignatureStamp anchors, match on
`(page, anchorText, ordinal within page+anchorText by y-desc)`, and adopt that
anchor's `generatedCheckpointId`.

This is the only candidate that carries the anchor's **identity** — `anchorText`
distinguishes "Employee Signature:" from "Employee's Signature", which is the
real difference between two signature lines. It is immune to checkpoint renames,
`pageRef` edits and reorders, since it never reads a checkpoint column. No schema
change: `HrDocumentVersion.versionNumber` is unique per document
(`schema.prisma:1706`), so "previous version" is well defined.

Costs: materially more code, and a new failure mode — the chain breaks if an
intervening version was never confirmed, so it must walk back to the most recent
version that actually has confirmed anchors rather than to `versionNumber - 1`.
It also cannot help a document's first confirmation (correct — mint fresh).

### Recommendation — Candidate B

On today's data B and A are the same fix; B only diverges where A is wrong.
The marginal cost over A is roughly four lines and one `orderIndex` sort, and it
does not hand back the per-signature timestamp property HR-11j established.
C is more faithful and I would pick it if `anchorText` matching were needed for
another reason, but it buys robustness against admin edits and page restructuring
that no document in play currently needs, at several times the code and with a
new chain-hole case to get right.

Whatever is ruled, the fix must also give the lookup a **deterministic order**.
`prisma.hrDocumentCheckpoint.findMany({ where: { hrDocumentId } })` at `:629`
has no `orderBy`, so `checkpoints.find(...)` is currently resolving against
whatever order Postgres returns. Initial has the same exposure today; with one
Initial checkpoint per page it has never been visible.

### Sub-decision Gary should rule on at the same time

Under B, a page carrying three accumulated checkpoints adopts the **lowest
`orderIndex`** — v1's, the oldest. The alternative is to adopt the newest, which
would keep the checkpoint the current version already points at. I lean oldest:
it is deterministic, fixed forever regardless of version history, and it is what
Initial does (Initial has reused the same page-1 checkpoint since v1). The
consequence is that after the fix lands, *which specific rows* are orphaned on
the test document changes — v1's two are adopted, v3's two become orphans — while
the orphan count does not.

---

## Orphan counts — arithmetic, and the SQL to confirm it

**These are predictions from the code and the detection output above, not
measurements.** Database reads for deployed environments go through the Neon
console; the SQL is below for Gary to run.

Definition used: an **orphan** is a `Signature` checkpoint on the document that
no confirmed anchor of the **current** version points at.

| Document | Signature checkpoints | Linked to current version | Predicted orphans |
|---|---|---|---|
| Test - Handbook Regression (`cmstv3r1s000004jxdcyhkbui`) | 6 (2 × 3 versions) | 2 (v3's) | **4** |
| Real 2026 Employee Handbook | 4 per confirmed version | 4 | depends on version count |

The real handbook's figure cannot be derived without knowing how many versions
have been uploaded and confirmed — hence the query.

### Do the orphans carry acknowledgments? Almost certainly yes.

The ceremony page selects `checkpoints: { orderBy: { orderIndex: "asc" } }` on
the document with **no filter against anchors**
(`src/app/(app)/hr/acknowledge/[documentId]/page.tsx:40`), and passes the whole
set to the client at `:201-209`. Anchors travel separately at `:226` and are used
only for inline placement. So an orphaned Signature checkpoint is presented as a
required ceremony step with nothing behind it — which is exactly what Gary saw on
v2, and exactly why Gdogg's v3 certificate lists six.

**The consequence matters for Item 2's closing note.** If the orphans carry
acknowledgments, the existing admin `DELETE` refuses them with a 409
(`checkpoints/[checkpointId]/route.ts:78-83`) and the "separate admin action" the
prompt defers to is not available as built. Clearing the backlog would need
something that does not exist yet, under its own G1 ruling. This should be
confirmed by query before Item 2's report repeats the prompt's framing.

### SQL for the Neon console — staging `br-square-feather-a63z92vz` / `neondb`

```sql
-- 1. Signature checkpoints, orphan status, and acknowledgment counts,
--    for the test document and every Acknowledgment doc titled like a handbook.
SELECT current_setting('neon.branch_id', true) AS branch_id,
       current_database()                     AS db,
       d.id            AS document_id,
       d.title,
       cp.id           AS checkpoint_id,
       cp."orderIndex",
       cp.name,
       cp."pageRef",
       (a.id IS NULL)  AS is_orphan,
       (SELECT count(*) FROM "HrDocumentAcknowledgment" ack
         WHERE ack."checkpointId" = cp.id) AS ack_count
FROM "HrDocumentCheckpoint" cp
JOIN "HrDocument" d ON d.id = cp."hrDocumentId"
LEFT JOIN "HrDocumentVersion" v
       ON v."hrDocumentId" = d.id AND v."isCurrent" = true
LEFT JOIN "DocumentAnchor" a
       ON a."hrDocumentVersionId" = v.id
      AND a.confirmed = true
      AND a."generatedCheckpointId" = cp.id
WHERE cp.type = 'Signature'
  AND (d.id = 'cmstv3r1s000004jxdcyhkbui' OR d.title ILIKE '%handbook%')
ORDER BY d.title, cp."orderIndex";
```

```sql
-- 2. Roll-up: orphans per document, and how many of them are already signed.
SELECT current_setting('neon.branch_id', true) AS branch_id,
       current_database()                     AS db,
       d.id AS document_id,
       d.title,
       count(*) FILTER (WHERE a.id IS NULL) AS orphan_count,
       count(*) FILTER (WHERE a.id IS NULL AND ack.n > 0) AS orphans_with_acks,
       count(*) AS signature_checkpoints_total
FROM "HrDocumentCheckpoint" cp
JOIN "HrDocument" d ON d.id = cp."hrDocumentId"
LEFT JOIN "HrDocumentVersion" v
       ON v."hrDocumentId" = d.id AND v."isCurrent" = true
LEFT JOIN "DocumentAnchor" a
       ON a."hrDocumentVersionId" = v.id
      AND a.confirmed = true
      AND a."generatedCheckpointId" = cp.id
LEFT JOIN LATERAL (
  SELECT count(*) AS n FROM "HrDocumentAcknowledgment" ack
   WHERE ack."checkpointId" = cp.id
) ack ON true
WHERE cp.type = 'Signature'
  AND (d.id = 'cmstv3r1s000004jxdcyhkbui' OR d.title ILIKE '%handbook%')
GROUP BY d.id, d.title
ORDER BY d.title;
```

```sql
-- 3. Version + confirmed-anchor census, to interpret the counts above
--    (how many versions exist, and how many signature anchors each confirmed).
SELECT current_setting('neon.branch_id', true) AS branch_id,
       current_database()                     AS db,
       d.title,
       v."versionNumber",
       v."isCurrent",
       left(v."fileHash", 12) AS hash12,
       count(*) FILTER (WHERE a.confirmed AND a."markType" = 'SignatureStamp') AS confirmed_sig_anchors,
       count(*) FILTER (WHERE a.confirmed AND a."markType" = 'Initial')        AS confirmed_initial_anchors
FROM "HrDocumentVersion" v
JOIN "HrDocument" d ON d.id = v."hrDocumentId"
LEFT JOIN "DocumentAnchor" a ON a."hrDocumentVersionId" = v.id
WHERE d.id = 'cmstv3r1s000004jxdcyhkbui' OR d.title ILIKE '%handbook%'
GROUP BY d.title, v."versionNumber", v."isCurrent", v."fileHash"
ORDER BY d.title, v."versionNumber";
```

Note the `ILIKE '%handbook%'` predicate resolves by NAME, which § Database
Evidence warns against. It is used here only to *discover* the real handbook's
document id; once that id is known, re-run keyed on the id.

---

## Other things noticed, not acted on

- **The prompt's ROADMAP row is an unfilled placeholder** ("_fill in before
  running — do not leave a placeholder._"). Item 2's two-commit pattern needs a
  real row id before its second commit can be written.
- **`syncCheckpointsForConfirmedAnchors`'s checkpoint query has no `orderBy`**
  (`:629`) — noted above; it should be made deterministic as part of the fix.
- **No schema change is needed** for any of the three candidates.
