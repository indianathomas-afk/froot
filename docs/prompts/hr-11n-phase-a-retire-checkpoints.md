# HR-11n Phase A — checkpoint retirement capability

**TIER 3 (structural).** Schema change, touches the completion denominator, the
signing ceremony, and certificate generation. Full ceremony applies: audit
first, present a plan, wait for explicit approval before any edit.

Save this file to `docs/prompts/`. It is not edited after the fact — addenda
only.

---

## 0. Preconditions — do these before reading any application code

1. Confirm the working tree is on `staging` and clean.
2. Print `git log -1 --oneline` and report the SHA.
3. Stop and report if the branch is not `staging` or the tree is dirty.

Do not push. Commits only. Gary runs every push.

---

## 1. Context

UseFroot, `~/Claude_Projects/Froot/froot` (lowercase `froot` is the git root).
Next.js 16 App Router, React 19, TypeScript, Tailwind 4, Prisma 7, Neon
Postgres, Clerk, shadcn/ui, Vercel.

HR is dark in production (`HR_MODULE_AVAILABLE` unset). All work and all
verification is staging: branch `br-square-feather-a63z92vz` / `neondb`, org
`org_3G02wO4QlVVSWppi8aqlnSZnsDa`, Clerk instance `verified-snapper-7`.

### The defect

`DocumentAnchor` is version-scoped. `HrDocumentCheckpoint` is document-scoped.
Before HR-11m, every new version minted fresh Signature checkpoints because the
reuse key lived on the anchor, which dies with its version. HR-11m stopped the
growth. It did not clear the backlog.

Test document `cmstv3r1s000004jxdcyhkbui` carries six Signature checkpoints for
two real signature lines. Four are orphans and every one has acknowledgments on
it. `DELETE /api/hr/documents/[id]/checkpoints/[checkpointId]` returns 409 when
`_count.acknowledgments > 0`, and the ceremony renders every document checkpoint
with no anchor filter, so orphans collect acknowledgments as a matter of course.
There is no removal path. A signer sees three stacked "Sign here" buttons on one
signature line. The real Employee Handbook has the same condition from its
nine-version history.

### What this session builds

The behaviour below is the specification for this session. It is not the
ROADMAP ruling — see section 8 for how the ruling text is handled.

1. A checkpoint can be retired: hidden going forward, preserved backward.
2. Acknowledgments on a retired checkpoint are never deleted or altered.
   They stop counting toward completion because the step is no longer
   required, not because the evidence went away.
3. Certificates already issued are not touched and never reissued.
   Retirement is forward-only.
4. Nothing is retired automatically. A human ADMIN retires by hand, one at
   a time, behind a confirm.
5. A signer mid-ceremony when a checkpoint retires is never blocked, and
   never has an entry silently recorded against a retired checkpoint.

Retirement is reversible; un-retire is in scope, not a follow-up.

---

## 2. Audit first — answer these before proposing any edit

Read and report. Do not edit anything in this step.

1. Does the signing ceremony still build its step list from `doc.checkpoints`
   with no anchor filter, or did HR-11m put a filter in that path? Name the file
   and line.
2. List **every** read path that counts or renders checkpoints. Known on `main`:
   the completion check in the acknowledgments POST route, and the `missing` /
   `orderedAcks` construction in `ensureSignedRecord` (`src/lib/hr-signed-pdf.ts`).
   HR-11j added a staff-portal readiness check — find it. Also check the
   compliance/progress surfaces, the checkpoint list API, and the admin document
   detail page. Assume this list is incomplete until you have grepped for it.
3. Did HR-11m leave a reusable helper that resolves "which checkpoint does this
   version's anchor set back" via `pageRef` + ordinal? If so, name it. Phase A
   reuses it and does not reimplement the reuse key.
4. Confirm `DocumentAnchor.generatedCheckpointId` is still a soft pointer with
   no FK.
5. Confirm the DELETE checkpoint route's 409 guard is where I have described it.

Present findings plus a concrete edit plan. **Wait for explicit approval.**

---

## 3. Schema — additive only

Add to `HrDocumentCheckpoint`:

```
retiredAt       DateTime?
retiredByUserId String?
retiredReason   String?
```

Nullable. No defaults. No drops, no renames, no type changes, no index removal.

Before running the migration:

- Echo the database host you are about to migrate against.
- Print the generated SQL and wait for approval.

Run one command at a time. No `&&` chains.

---

## 4. Behaviour

### Retire semantics

A checkpoint with `retiredAt` set is excluded, from that moment forward, from:

- the signing ceremony step list (no button rendered)
- the required-checkpoint completion denominator, in **every** call site found
  in the audit
- the checkpoint table of any certificate generated after retirement

It is preserved and remains queryable everywhere else. Its
`HrDocumentAcknowledgment` rows are **never** deleted or modified by this
feature.

### Certificates already issued

Untouched and never reissued. `ensureSignedRecord` returns the existing record
and does not regenerate — that behaviour does not change. Retirement is
forward-only. Surface one line of copy in the admin UI saying certificates
issued before retirement may still list the retired step.

### Mid-ceremony signers

If a submission arrives containing entries for a checkpoint retired since the
page loaded, drop those entries before insert and compute completion against the
live set. Do not return a 400. A signer mid-signature must be able to finish.

### G1 is preserved

The anchor-sync and re-confirmation paths still never delete or modify a
checkpoint. Retirement is a separate, deliberate, ADMIN-only action. The existing
DELETE route and its 409 guard are **not** modified — zero-acknowledgment
checkpoints keep their existing hard-delete path.

---

## 5. Endpoints

- `POST /api/hr/documents/[id]/checkpoints/[checkpointId]/retire`
- `POST /api/hr/documents/[id]/checkpoints/[checkpointId]/unretire`

ADMIN only, matching the posture of the other document-configuration routes.
Retire sets `retiredAt`, `retiredByUserId`, and optional `retiredReason`.
Unretire clears all three. Both are idempotent. Un-retire exists because
reversibility is the reason this design was chosen over deletion.

---

## 6. Admin surface

**Placement is fixed and not open to interpretation.** The retire control lives
on the ADMIN document-configuration screen where a document's checkpoints are
listed — the same surface as anchor confirmation. It appears on **no**
employee-facing surface: not the reader, not the signing ceremony, not the staff
portal, not the certificate. A signer never sees it and never knows it exists.
MANAGER does not get it; managers sign and attest, they do not shape documents.

There is no settings toggle for this behaviour. Retirement is a one-time repair
action for documents that predate HR-11m, not a configurable policy.

On the document's checkpoint list:

- a read-only **Anchor** column: does a confirmed anchor on the *current*
  version back this checkpoint (via the HR-11m reuse key from audit item 3)
- the acknowledgment count per row
- a **Retire** action per live row, behind a confirm dialog that names the
  checkpoint and states the acknowledgment count and that those
  acknowledgments will be preserved
- retired rows collapsed into a separate "Retired" section showing who retired
  them and when, each with an **Un-retire** action

The Anchor column is display only. Computing it must not write, mutate, or
re-detect anything.

---

## 7. Hard prohibitions

- **No auto-retire.** Not on upload, not on version change, not on rescan, not
  on re-confirmation.
- **No backfill migration.** The four orphans on the test document and the
  handbook's backlog are retired by Gary, by hand, in the browser, in a separate
  verification session. This session ships the capability and retires nothing.
- No local database connection to a deployed environment. Deployed reads go
  through the Neon console.
- No `vercel env pull`.
- No `&&` chains.

---

## 8. Build and commit

1. `next build` must pass before any commit.
2. Work commit on `staging`. Report the short SHA.
3. Second commit recording that SHA in the HR-11n row in `docs/ROADMAP.yaml`,
   per the two-commit pattern. `ROADMAP.yaml` is append-only; the ruling text in
   that row is Gary's, pasted verbatim.
4. Do not push.

---

## 9. Hand-off — evidence Gary will capture

Do not run these. Output them for Gary to run in the Neon console.

1. A query returning `neon.branch_id` and `current_database()` **in the same
   output** as the six Signature checkpoints of `cmstv3r1s000004jxdcyhkbui`,
   with `orderIndex`, `name`, `retiredAt`, and acknowledgment count.
2. The same shape for the real Employee Handbook's Signature checkpoints.

Then state plainly what Gary should expect to see in the browser after
retiring the four orphans on the test document: page 28 renders one "Sign here"
button on that signature line instead of three, the required signature-step
count for the document drops from six to two, and no existing signed record
changes state.

Verification is a separate session. This session ends at the second commit.
