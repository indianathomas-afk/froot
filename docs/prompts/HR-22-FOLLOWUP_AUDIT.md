# HR-22 FOLLOW-UP AUDIT — `skipDuplicates` verification + branch confirmation

**Date:** 2026-08-11
**Session type:** AUDIT ONLY (Phase 1 of `docs/prompts/HR-22-followup.md`). No source
file was edited, created, or deleted. No schema, no migration, no `ROADMAP.yaml` edit,
no HR-23 work, no database query, no push.
**Commissioning prompt:** `docs/prompts/HR-22-followup.md`
**Outcome:** **Phase 2 is VOID.** Nothing needs fixing. Ruled by Gary 2026-08-11 on the
findings below.
**Repo state at audit:** branch `staging`, HEAD `0273c98`, working tree clean.

---

## 0. Headline — the commissioning prompt's two premises were BOTH FALSE

This audit was commissioned to remove an argument believed to be inert. It is not
inert. Both preconditions the session was built on are false at HEAD, and the session's
proposed Phase 2 would have introduced the bug it was written to prevent.

| # | Premise, as written in `HR-22-followup.md` | Verdict |
|---|---|---|
| 1 | "`TrainingAssignment` carries only `@@index([staffMemberId])` and `@@index([trainingModuleId])` — there is no `@@unique([trainingModuleId, staffMemberId])`, by ruling (HR-20: no DB-level duplicate constraint)." (:10-14) | **FALSE** — the constraint is live. §3. |
| 2 | "HR-22 work commit `bd63da7` and docs commit `0273c98` exist and are UNPUSHED." (:4) | **FALSE** — both were on `origin/staging` before the prompt was written. §1. |

**Premise 1 in full.** R-b's unique constraint on `(trainingModuleId, staffMemberId)`
is live in `prisma/schema.prisma:2004` and shipped in migration
`20260810194426_hr20_training_category_entity`. Its condition — zero duplicate pairs on
all three branches — was verified met by Gary in the Neon console 2026-08-10 and is
recorded both on HR-20's row and inside the migration SQL itself. **`skipDuplicates` is
therefore load-bearing on BOTH training paths.** Removing it, as Phase 2 proposed,
would reintroduce `P2002 → 500` on the losing side of a concurrent single-assign —
exactly the defect HR-22 was commissioned to close, restored by a session whose stated
goal was that nothing observable would change. The prompt's own guard against this
(":71-72 — if removing the argument changes any observable behaviour, STOP and report
instead, that means the audit was wrong") is the sentence that fired.

**Premise 2 in full.** `bd63da7` and `0273c98` were pushed to `origin/staging` at
**2026-08-11 08:55:53 -0700** (Gary). Verified at audit: `git log --oneline @{u}..`
returns empty, and `git log -2 --format='%h %cd %d'` shows
`0273c98 2026-08-11 08:47:11 -0700 (HEAD -> staging, origin/staging)`. The HR-22
session's own closing report — "Unpushed commits: two" — was **accurate when made**
(commits at 08:44:42 and 08:47:11, report immediately after, push eight minutes later).
The precondition did not become wrong; it was written after the fact that falsified it.
`HR-22-followup.md` carries an mtime of 08:59, three minutes after the push.

### Cause — and the standing consequence

**The prompt was authored against pre-HR-20 code.** Every statement in premise 1 is a
true description of `TrainingAssignment` as it stood at `f318d2e`, and it is exactly
what `docs/prompts/2026-08-10_TRAINING_AUDIT.md` §2.1 recorded on that day: *"There is
NO unique constraint on `(trainingModuleId, staffMemberId)` — two plain indexes,
nothing compound."* That was correct then. `0a745c3` superseded it the same evening.

The reason this is worth writing down rather than filing as a one-off: **the
HR-20/21/22 trilogy is complete on `staging` and awaits one promotion, so `main` is a
full phase behind.** Any reasoning done against `main` — reading its schema, its
routes, its `ROADMAP.yaml` — is currently a promotion behind and will produce
confident, internally consistent, wrong conclusions of precisely this shape. The
premise here was not careless; it was well-sourced from a document that had been
superseded. That is the failure mode CLAUDE.md § Database Evidence names one layer
down: *an under-specified identifier that still resolves.* Here the under-specified
thing is **which commit the claim is true at.**

This condition ends when the promotion lands. Until then, a claim about training schema
or training routes needs the branch it was read on attached to it, the same way a query
result needs its Neon branch.

---

## 1. Branch and push state

```
$ git branch --show-current
staging

$ git log --oneline -4
0273c98 HR-22 docs: board amendment + HR-23 filed + disclosure wording of record, citing bd63da7
bd63da7 HR-22: bulk training assignment + due date carry-through
4207be0 HR-21: colour the Category picker's options with their badge preset
a369107 HR-21 docs: board amendment + rider verified + tab-semantics ruling, citing a56c905

$ git log --oneline @{u}..
(empty)

$ git log -2 --format='%h %cd %d' --date=iso
0273c98 2026-08-11 08:47:11 -0700  (HEAD -> staging, origin/staging)
bd63da7 2026-08-11 08:44:42 -0700

$ git status --porcelain
(empty — clean)
```

**Plainly: `bd63da7` and `0273c98` sit on `staging`, and on `origin/staging`.** They are
not local-only, not on another branch, not detached. Unpushed count at audit: **zero**.

---

## 2. Every `skipDuplicates` call site — eleven

`grep -rn "skipDuplicates" src prisma`, `src/generated/` excluded. Eleven live
arguments, plus three comment-only mentions that are not call sites
(`hr/documents/[id]/acknowledgments/route.ts:247`, `lib/training-categories.ts:27`,
`lib/template-types.ts:24`).

**All eleven are passed to `createMany`. None is passed to `create`** — where it is not
a valid argument. The prompt's item 2 asked this be stated explicitly; it is stated:
there is no misuse anywhere in the repo.

| # | File | Line | Model | Backing unique constraint |
|---|---|---|---|---|
| 1 | `api/checklists/[id]/handoff-messages/route.ts` | 70 | `messageRead` | `MessageRead(messageId, userId)` |
| 2 | `api/messages/mark-read/route.ts` | 48 | `messageRead` | `MessageRead(messageId, userId)` |
| 3 | `api/my/training/[assignmentId]/lessons/[lessonId]/route.ts` | 40 | `trainingLessonProgress` | `(trainingAssignmentId, trainingLessonId)` |
| 4 | **`api/hr/training/assignments/route.ts`** | **72** | **`trainingAssignment`** | **`(trainingModuleId, staffMemberId)` — HR-22's retrofit** |
| 5 | **`api/hr/training/assignments/bulk/route.ts`** | **210** | **`trainingAssignment`** | **`(trainingModuleId, staffMemberId)` — HR-22's bulk write** |
| 6 | `api/hr/training/assignments/[id]/lessons/[lessonId]/route.ts` | 46 | `trainingLessonProgress` | `(trainingAssignmentId, trainingLessonId)` |
| 7 | `api/hr/documents/[id]/acknowledgments/route.ts` | 253 | `hrDocumentAcknowledgment` | `(checkpointId, hrDocumentVersionId, staffMemberId, signingCycle)` |
| 8 | `api/webhooks/clerk/route.ts` | 225 | `storeUserAssignment` | `(userId, storeId)` |
| 9 | `lib/training-categories.ts` | 38 | `trainingCategory` | `(organizationId, name)` |
| 10 | `lib/adjustments.ts` | 113 | `lossReason` | per-org seed guard |
| 11 | `lib/template-types.ts` | 35 | `templateType` | `(organizationId, name)` |

Sites 4 and 5 are the two this session was commissioned about. Both verbatim:

**#4 — `src/app/api/hr/training/assignments/route.ts:60-76`** (the single-assign path,
HR-22's mandated retrofit):

```ts
      trainerUserId: trainerUserId ?? null,
      dueDate: dueDate ? new Date(dueDate) : null,
    })),
    // HR-22. HR-20 shipped @@unique([trainingModuleId, staffMemberId]) and
    // deliberately left this path alone, so the race the read-then-skip above
    // cannot close was surfacing as Prisma P2002 → 500 on the loser. This flag
    // is what makes the constraint read as the ordinary skip-and-report R-b
    // rules. Acceptance behaviour is otherwise UNCHANGED here: the module
    // filter's silent drop and the missing isActive/applicability checks
    // (audit findings #2/#3/#4) are HR-23's, ruled 2026-08-11 — tightening
    // acceptance without also fixing this route's response shape would trade
    // loud over-acceptance for silent dropping.
    skipDuplicates: true,
  })

  return NextResponse.json({ created: toCreate.length, skipped: alreadyAssigned.size }, { status: 201 })
}
```

**#5 — `src/app/api/hr/training/assignments/bulk/route.ts:199-211`** (the bulk write):

```ts
  const created = await prisma.trainingAssignment.createMany({
    data: toCreate.map((staffMemberId) => ({
      trainingModuleId: trainingModule.id,
      staffMemberId,
      assignedByUserId: access.dbUser.id,
      trainerUserId: trainerUserId ?? null,
      dueDate: dueDate ? new Date(dueDate) : null,
    })),
    // HR-20 shipped @@unique([trainingModuleId, staffMemberId]); without this
    // flag the race the constraint closes would surface as P2002 → 500 instead
    // of the ordinary skip-and-report R-b rules.
    skipDuplicates: true,
  })
```

Note that **both comments already name the constraint they ride**, and site #7's
comment names its own four-column constraint. The code was not silent about its
mechanism; the premise was formed without reading it at HEAD.

---

## 3. The R-b unique constraint — confirmation

**Plain answer to the prompt's item 3: YES.** A unique constraint covering
`(trainingModuleId, staffMemberId)` exists in both `prisma/schema.prisma` and
`prisma/migrations/`.

### 3.1 Schema, `prisma/schema.prisma:1999-2007` verbatim

```prisma
  // HR-20 (R-b, condition met 2026-08-10: zero duplicate pairs on all three
  // branches). One row per module × staff pair; a future re-assignment, if
  // ever built, adds a cycle column (HR-15b shape) rather than a bare second
  // row. The plain trainingModuleId index below is redundant with this but
  // stays — dropping it would be non-additive.
  @@unique([trainingModuleId, staffMemberId])
  @@index([staffMemberId])
  @@index([trainingModuleId])
}
```

The two plain indexes the prompt cites at :11 **are both still there** — which is
likely how the premise survived a partial read. They are not the whole picture: the
`@@unique` sits directly above them, with a comment explaining why the redundant index
was deliberately kept rather than dropped.

### 3.2 Migration SQL, `20260810194426_hr20_training_category_entity/migration.sql` verbatim

```sql
-- CreateIndex
-- R-b's unique constraint — condition MET: §8.2 returned ZERO duplicate
-- (trainingModuleId, staffMemberId) pairs on all three branches
-- (dev br-broad-wave, staging br-square-feather, production
-- br-sparkling-block), verified by Gary in the Neon console 2026-08-10.
-- Future re-assignment, if ever built, adds a cycle column (HR-15b shape).
CREATE UNIQUE INDEX "TrainingAssignment_trainingModuleId_staffMemberId_key" ON "TrainingAssignment"("trainingModuleId", "staffMemberId");
```

The migration carries its own condition-met evidence, with the three Neon branch ids
named inline per CLAUDE.md § Database Evidence. **No database query was run by this
audit** — the branch evidence is quoted from the migration and from HR-20's row, where
Gary recorded it on 2026-08-10.

### 3.3 What the ruling actually said

The prompt attributes to HR-20 a ruling of "no DB-level duplicate constraint." HR-20's
row says the opposite, and says it as a *condition that was met*:

> (3) CONSTRAINT CONDITION MET AND SHIPPED. §8.2 returned ZERO duplicate
> (trainingModuleId, staffMemberId) pairs on ALL THREE branches […] so the R-b unique
> constraint shipped in this row's migration. Consequence noted on HR-22's row: the
> untouched single-assign race now surfaces as P2002 rather than a silent duplicate.

R-b as transcribed on HR-20's row: *"duplicates skip-and-report. Unique constraint
conditionally approved — §8.2 zero on all three branches, else back to Gary with the
rows. Future re-assignment, if ever built, uses a cycle column (the HR-15b shape) —
this ruling is what makes the constraint safe."*

The conditional was resolved in the affirmative. A reader who saw only the conditional
form, or only the pre-HR-20 audit, would reach the prompt's premise honestly.

---

## 4. The real dedupe path

Both training paths use the same two-layer shape: **an app-level read-then-classify
pass, backed by the DB constraint.** Neither layer is decorative.

### 4.1 The `alreadyAssigned` bucket, `bulk/route.ts:167-197`

```ts
  const isApplicable = applicabilityCheck(trainingModule)
  const existing = await prisma.trainingAssignment.findMany({
    where: { trainingModuleId: trainingModule.id, staffMemberId: { in: [...roster.keys()] } },
    select: { staffMemberId: true },
  })
  const alreadyHas = new Set(existing.map((a) => a.staffMemberId))
  […]
    } else if (alreadyHas.has(id)) {
      outcomes.set(id, "already-assigned")
    } else {
      outcomes.set(id, "assigned")
      toCreate.push(id)
    }
```

### 4.2 How a duplicate is actually prevented today

**The read-then-classify pass classifies; the unique constraint prevents.** The pass
above is a `findMany` followed by a write, so it is racy by construction — two
concurrent requests can both read "not assigned" and both proceed to `createMany`.
What stops the second insert is `TrainingAssignment_trainingModuleId_staffMemberId_key`
at the database, and what stops that rejection from becoming a `P2002 → 500` is
`skipDuplicates: true`. Remove the flag and the constraint still prevents the duplicate
— by throwing.

The bulk route then reconciles the race rather than hiding it, `bulk/route.ts:213-230`:

```ts
  // A concurrent request won some pairs between the read above and this write.
  // Attribution is clock-free: our rows were all inserted by one statement, so
  // they are the newest, and a race loser's row necessarily predates them (it
  // existed, or ours would have won). Ordering comes from the DB's own clock —
  // never compared against this server's. One indexed read, and ONLY when the
  // counts disagree.
  let concurrentlyAssigned = 0
  if (created.count < toCreate.length) {
    concurrentlyAssigned = toCreate.length - created.count
    […]
    for (const row of rows.slice(created.count)) {
      outcomes.set(row.staffMemberId, "already-assigned")
    }
  }
```

**Correction to the prompt's §"Why this session exists" (:18-20).** It describes the
read-then-classify pass as "the real mechanism," racy by design, with the invariant's
third check existing "exactly because" of that. Half right, and the wrong half matters:
the third check (`assigned` vs. what the database reports inserted) exists to catch a
mis-attribution in the *reconciliation*, and the reconciliation only ever runs because
`created.count` came back short — which can only happen **because the constraint
rejected rows and `skipDuplicates` swallowed the rejection.** With the flag removed,
`created.count < toCreate.length` becomes unreachable: the call throws instead. The
race handling, the `concurrentlyAssigned` diagnostic, and the third invariant check all
become dead code the moment the "inert" argument is deleted.

---

## 5. HR-23 row — verbatim from `docs/ROADMAP.yaml`

```yaml
  - id: HR-23
    track: hr
    size: S
    status: planned
    title: "Single-assign path adopts the bulk route's module rules + a response that sums to its input"
    notes: >
      FILED 2026-08-11 by the HR-22 build session, at Gary's ruling at that
      session's HARD STOP #1. Carries audit findings #2, #3 and #4 from
      docs/prompts/2026-08-10_TRAINING_AUDIT.md (§4.2, §4.3, §9) — filed as ONE
      row because they cannot safely ship apart, which is the whole reason this
      is a row and not a two-line rider on HR-22.
      SCOPE: POST /api/hr/training/assignments — the /staff/[id] Training tab's
      assign path — and staff-training.tsx, which must render the reasons the
      new response gives.
      #2: the route accepts INACTIVE modules the UI never offers; its module
      filter is isArchived-only (route.ts:35-38) while the page's assignable
      list requires isActive (staff page.tsx:394).
      #3: the route ignores module applicability (appliesTo / store
      assignments); the offer list intersects them with the member's stores
      (staff page.tsx:396-399).
      #4, and the reason the other two waited for this row: the response is
      { created, skipped }, so ids dropped by the route's own filter vanish from
      its arithmetic — created + skipped != requested, and nothing says why.
      TIGHTENING #2/#3 WITHOUT #4 TRADES LOUD OVER-ACCEPTANCE FOR SILENT
      DROPPING (Gary, 2026-08-11): today an odd id is wrongly accepted and
      visible; tightened without a response that can explain a drop, it would be
      wrongly refused and INVISIBLE. That is the CHK-3 failure mode exactly.
      THE RULE IS ALREADY SETTLED — do not re-open it. HR-22's bulk route
      (src/app/api/hr/training/assignments/bulk) enforces isActive + isArchived
      + applicability and REFUSES (409) rather than dropping; its five-bucket
      response and its loud sum invariant are the pattern to copy. This row is
      the retrofit, not a fresh decision.
      NOT A LIVE RISK MEANWHILE: neither gap is exploitable beyond ADMIN/MANAGER
      doing odd things inside their own org, and the UI offers neither (audit
      §4.2) — which is why HR-22 shipped without waiting for it.
```

Read, not touched. The row stays `planned`; this session opened nothing in it.

---

## 6. DEPLOY_LOG — the entry written during HR-22, and the governing convention

### 6.1 The HR-22 entry, `docs/DEPLOY_LOG.md` verbatim

> - **Added 2026-08-11 (HR-22 build session).** The next real PRODUCTION
>   promotion's entry must also name this session's two staging commits:
>   `bd63da7` (HR-22 work — bulk assign route + recipients endpoint under
>   `api/hr/training/assignments/bulk`, the Bulk Assign dialog in HR-21's shared
>   ModuleActions slot, and `skipDuplicates: true` retrofitted onto the
>   single-assign POST; **no migration** — `dueDate` and HR-20's (module × staff)
>   unique constraint both already existed. Not docs-only; listed so this list
>   stays the one complete place the promotion entry reads) and the HR-22 docs
>   commit, which cannot carry its own SHA and resolves as the commit that added
>   this line (`git log --oneline -- docs/DEPLOY_LOG.md`). With this, the
>   training trilogy HR-20/21/22 (`0a745c3`, `a56c905`, `bd63da7`) is complete on
>   staging and awaits one promotion.

Note that this entry, written 2026-08-11, **already states the constraint existed** —
"`dueDate` and HR-20's (module × staff) unique constraint both already existed." The
DEPLOY_LOG contradicted premise 1 before the follow-up prompt was written.

### 6.2 The governing convention, quoted not inferred

The section heading, verbatim:

> ## STANDING NOTE — docs-only commits the next real promotion's entry must name

Its purpose clause, from the first bullet:

> The next real PRODUCTION promotion's DEPLOY_LOG entry must NAME these docs-only
> commits so `main`'s push history reconciles

And the extension rule, verbatim:

> - **Preserve-and-mark:** extend this list by dated line; when a promotion
>   discharges an item, mark it discharged with the promotion SHA — never
>   delete.

**What it governs, per the prompt's item 6.** The convention is *extend by dated line*
— a new line per session, never an amendment to an existing one and never a deletion.
Every prior entry follows that form (training filing, HR-20, HR-21, HR-22), each naming
its own session's staging commits and resolving its own docs commit as "the commit that
added this line."

**What it does not settle.** The list's stated trigger is *docs-only commits the next
promotion must name*, keyed to push-history reconciliation rather than to operational
change. Whether an audit-artifact commit carrying no operational change falls inside
that trigger is not stated anywhere in the note. That question is raised with Gary
rather than resolved here — see §8.

---

## 7. Triage of findings — carried through unchanged

Per CLAUDE.md's rule that an observation living only in a transcript does not exist, and
the standing FIX NOW / RULING NOW / COMMENT NOT A ROW / ROW triage. **A new row is the
last resort, and nothing here reaches it.**

| # | Finding | Triage |
|---|---|---|
| 1 | `skipDuplicates` is load-bearing on both training paths; the constraint is live | **COMMENT NOT A ROW** — the code is correct as shipped and already carries the explanation in-comment at both sites. Nothing to fix. This document is the record. |
| 2 | The commissioning prompt's premise 1 was formed against pre-HR-20 code | **COMMENT NOT A ROW** — recorded in §0 with its cause. No code, no row; the condition ends at the next promotion. |
| 3 | The commissioning prompt's premise 2 (UNPUSHED) was stale by three minutes | **COMMENT NOT A ROW** — the HR-22 report was accurate when made; the push followed it. No action. |
| 4 | Phase 2 as specified would have reintroduced `P2002 → 500` and dead-coded the race handling, the `concurrentlyAssigned` diagnostic, and the third invariant check | **RULING NOW — RULED: Phase 2 VOID** (Gary, 2026-08-11). No source file touched. |
| 5 | All eleven `skipDuplicates` sites are on `createMany`; none misused on `create` | **COMMENT NOT A ROW** — clean sweep, nothing to fix, recorded so the next reader need not re-grep. |
| 6 | `main` is a full phase behind `staging` until the HR-20/21/22 promotion lands | **COMMENT NOT A ROW** — a standing hazard for this window only, discharged by the promotion the DEPLOY_LOG list already tracks. |

**Zero FIX NOW. Zero new ROWs.** One RULING NOW, already ruled.

---

## 8. Disposition

Phase 2 is void by ruling. `skipDuplicates` stays at all eleven sites. No source file,
schema file, migration, or `ROADMAP.yaml` row was read-modified by this session — §§1-6
are reads only.

The audit's own definition-of-done item — *"`skipDuplicates` resolved: removed with a
comment naming the real mechanism, or the audit showed it is load-bearing and nothing
changed"* — resolves to the **second branch**: load-bearing, nothing changed.

**DEPLOY_LOG: no line for this commit — RULED, not omitted (Gary, 2026-08-11).** The
question was raised at a stop before committing, because the two readings diverge: the
standing note as written (§6.2) is keyed to push-history reconciliation rather than to
operational change, and all four prior sessions added a line each. Gary ruled that the
note does not extend to an audit artifact — nothing operational changed, and the
preserve-and-mark list tracks items awaiting promotion. Recorded here so a later reader
finds a decision rather than a gap, and so the promotion author knows to expect one
unnamed docs commit in the range alongside `bd63da7` and `0273c98`.

This session's commit therefore stands alone: one docs commit, the audit file only, no
DEPLOY_LOG edit, no `ROADMAP.yaml` edit, no push.
