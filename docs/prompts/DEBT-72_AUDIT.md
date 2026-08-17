# DEBT-72 — promotion gate: §3a ground-truth audit, and why the build stopped

**Session date:** 2026-08-17
**Tier:** 2 (code + config, no schema, no product code)
**Prompt:** `docs/prompts/DEBT-72_promotion_gate.md`
**Outcome:** **§3a's stop condition fired. `scripts/promote.mjs` was NOT built.**
Nothing in `scripts/`, `package.json` or `docs/WORKFLOW.md` was changed.

This file is the session's product. Per CLAUDE.md § Where documents live, it is a
claim wholesale and is never edited afterwards; corrections arrive as a separate
addendum file.

---

## 0. The one-paragraph version

The gate is **buildable in principle and not buildable as specified.** Three
independent defects were measured, not inferred. (1) The row-ID regex in §4 is
anchored to the start of the commit subject, and the repo changed commit-subject
convention on 2026-08-15 — so on the most recent promotion it recognised **1 row
ID across 47 commits**, and on an older 21-commit range it recognised **none at
all and returned PASS**. A gate that passes by not looking is worse than no gate.
(2) **28 of 75 `debt` rows carry no `status:` field**, which the §2.3 allowlist
fails closed on. (3) `docs/ROADMAP.yaml` has a **fourth** top-level collection,
`rulings`, which §4 does not resolve against, whose only status value is `ruled`
— outside the allowlist — and whose IDs (`R1`, `R2`, `R4`) appear in real commit
subjects. Separately, §1's premise about `WORKFLOW.md` §2 is **stale**: `--no-ff`
is already there and has been since 2026-08-07.

The §5 acceptance criterion that the gate must fail on BUG-7 **was met**. The §5
criterion that an older clean range must pass **could not be met** by any range
tested, except vacuously.

---

## 1. §3a — the commit → row mapping

### 1a. As specified: `^([A-Za-z][A-Za-z0-9]*-\d+[a-z]?)`, range `06dc830..7e77ea6`

```
   4 HR-11d
```

That is the complete output. **Four matches across 47 commits.** All four are the
same row.

Subjects carrying no match — **43 of 47, 91.5%** — verbatim:

```
Promote staging: BUG-7 verified, F-4 closed, R2/Case A/HR-11n/HR-11o, DOC-1, DEBT-70a/70b, HR-20..HR-28
docs(roadmap): DEBT-70a/70b verification — record f7723fe, the work commit
docs(roadmap): DEBT-70a and DEBT-70b verified on staging; DEBT-73 filed
docs: BUG-7 closure session — record 165bcb8, the work commit
docs: BUG-7 verified in production; F-4 blocker resolved; five retroactive DEPLOY_LOG entries
docs(roadmap): DEBT-70b built — the 22 server date displays
fix(hr): DEBT-70b — the 22 server date displays render the store-local day
docs(roadmap): DEBT-70a built — the PDF date stamp, split from DEBT-70
fix(hr): DEBT-70a — the inline Date: stamp renders the store-local day
docs(roadmap): Case A verification pass — one item unreproduced, one still owed
fix(hr): Case A toggle — optimistic state, and a redirect is not a save
docs(roadmap): HR-11k Phase B / Case A built, and the three-meanings problem
feat(hr): Case A — per-version re-verification toggle (R2/HR-11k Phase B)
docs(roadmap): HR-11k display follow-ups, and two rows filed from them
fix(hr): R2 display follow-ups — upload copy, the date, duplicated version text
merge(staging): reconcile duplicate HR-11o record, local supersedes
docs(roadmap): HR-11k Phase A built on staging, not verified
feat(hr): R2 — a prior version's signature satisfies the current one (HR-11k Phase A)
docs(roadmap): HR-11o verified on staging, with Gary's ruling
docs(roadmap): HR-11o verified on staging — all three display defects confirmed
docs: ceremony-route audit, the UTC/local precondition, HR-11o correction
docs(roadmap): record HR-11o — 7456565, ruling field left for Gary
fix(hr): HR-11o — three certificate/reader display defects
docs(roadmap): record HR-11n Phase A — 72df99a, with Gary's ratified ruling
feat(hr): HR-11n Phase A — retire checkpoints, forward-only and reversible
docs(roadmap): lead paragraphs on HR-11k and HR-11n for legibility
docs(roadmap): HR-11m verified — Signature checkpoint duplication fixed; HR-11n filed
docs(test-docs): V3 and V4 handbook reproduction fixtures
fix(hr): reuse Signature checkpoints across versions by pageRef + ordinal
docs(deploy-log): 2026-08-15 staging deploy + HR-11j acceptance pass
docs(roadmap): HR-11j verified — acceptance passed; file R2 as HR-11k
docs(roadmap): HR-11j — deployment confirmation and the acceptance pre-check
docs(roadmap): HR-11j — record "2afcf0f" (R4 gate, A3 guard, Q2 copy)
docs(roadmap): HR-11j — the four rulings, and record "32205a4" (R1)
fix(hr): R4 assignability gate, A3 ceremony guard, admin-facing refusal copy
docs(hr): commit the R1/R4 reproduction fixtures
fix(hr): R1 — completion derives from the signed record, not checkpoints
docs(hr): session prompt + Item 1 completion inventory audit
docs: HR-11d — audit SHA out of commits:, into notes as prose
docs: HR-11d row — Phase 0 outcome and Gary's ratified rulings; HR-11h filed
docs: HR-11d Phase 1 addendum — §2f, the omitted R3(ii)
docs: preserve the two HR-11d session prompts
docs: preserve the HR-11d Phase 0 audit (hollow signed records)
```

**Note the range is 47 commits, not the 48 the prompt states.** `git rev-list
--count 06dc830..7e77ea6` returns 47. Minor, recorded for accuracy.

### 1b. The cause is a convention change, not missing discipline

Most of those 43 subjects **do** name their row — just not in the first
character. The repo moved from bare-row-ID subjects (`BUG-7: guarded upsert…`) to
Conventional Commits (`fix(hr): DEBT-70b — …`). Measured over
`65abb74..7e77ea6`, by commit date:

| Date | BARE-ROWID | CONVENTIONAL | OTHER |
| --- | --- | --- | --- |
| 2026-08-10 | 3 | 0 | 3 |
| 2026-08-11 | 8 | 3 | 1 |
| 2026-08-12 | 8 | 9 | 0 |
| 2026-08-13 | 3 | 7 | 0 |
| 2026-08-14 | 4 | 5 | 0 |
| 2026-08-15 | 0 | 20 | 0 |
| 2026-08-16 | 0 | 17 | 1 |

The changeover completes on **2026-08-15**: every commit from that day onward is
conventional, and the `^` anchor is blind to all of them. The spec's regex was
written against a convention that had already been superseded when the prompt was
written.

Relaxing the anchor to `\b([A-Z][A-Za-z0-9]*-\d+[a-z]?)\b` recovers the mapping —
**38 of 47 subjects (81%)** resolve, 9 do not:

```
   9 HR-11d      7 HR-11o      7 HR-11k      5 HR-11n      5 HR-11j
   5 DEBT-70a    3 DEBT-70b    3 BUG-7       2 F-4         1 HR-28
   1 HR-20       1 HR-11m      1 HR-11i      1 HR-11h      1 DOC-1
   1 DEBT-73     1 DEBT-70
```

The 9 that still carry no row ID name a **sub-item** of a row instead — `R1`,
`R2`, `R4`, `A3`, `Case A` — identifiers that live inside a parent row's prose
and are not row IDs at all:

```
docs(roadmap): Case A verification pass — one item unreproduced, one still owed
fix(hr): Case A toggle — optimistic state, and a redirect is not a save
fix(hr): R2 display follow-ups — upload copy, the date, duplicated version text
docs(test-docs): V3 and V4 handbook reproduction fixtures
fix(hr): reuse Signature checkpoints across versions by pageRef + ordinal
fix(hr): R4 assignability gate, A3 ceremony guard, admin-facing refusal copy
docs(hr): commit the R1/R4 reproduction fixtures
fix(hr): R1 — completion derives from the signed record, not checkpoints
docs(hr): session prompt + Item 1 completion inventory audit
```

---

## 2. Two structural defects the prompt did not anticipate

### 2a. 28 of 75 `debt` rows have no `status:` field

Measured against the working tree copy of `docs/ROADMAP.yaml`:

```
phases:  106 entries — shipped 60, planned 30, in_progress 11, verified 5
bugs:      8 entries — shipped 3, planned 3, staging 1, verified 1
debt:     75 entries — shipped 35, <ABSENT> 28, planned 5, verified 5, withdrawn 2
rulings:   6 entries — ruled 6
```

The status-less 28:

```
DEBT-12, DEBT-16, DEBT-27, DEBT-28, DEBT-30, DEBT-33, DEBT-34, DEBT-37,
DEBT-39, DEBT-40, DEBT-42, DEBT-44, DEBT-47, DEBT-49, DEBT-50, DEBT-51,
DEBT-52, DEBT-55, DEBT-56, DEBT-57, DEBT-58, DEBT-60, DEBT-61, DEBT-62,
DEBT-64, DEBT-66, DEBT-67, DEBT-68
```

§2.3 rules that a missing status **fails**. That is a defensible rule in
isolation, but it was ruled without this number in view: it makes 37% of the debt
board an automatic promotion blocker. The YAML's own header documents the
convention this collides with — `DEBT-14`'s *"a missing status means OPEN"* — so
these rows are absent-by-convention, not by neglect.

**This is a live case today.** The current tip of `staging`, `893d91d`, is the
DEBT-28 em-dash work. DEBT-28 is one of the 28. Two things follow: the gate
cannot see it at all (the subject is `stores/staff: one em-dash label form across
the five hyphen sites` — the ID `DEBT-28` is in the commit **body**, and §4 reads
`--format=%s`, subjects only); and if the regex were repaired so it *could* see
it, the row would fail closed for want of a `status:` line.

### 2b. `rulings` is a fourth collection, and it is not in the resolution set

§4 says *"Resolve each ID against `phases`, `bugs`, and `debt`."*
`scripts/generate-roadmap.mjs:111` parses a fourth — `rulings` — and
`src/lib/roadmap.ts` types it. It holds `R1`…`R6`, all `status: ruled`.

Both halves of this bite. `R1`, `R2` and `R4` appear as the leading identifier in
real commit subjects in the promoted range, so a repaired regex resolves them —
and `ruled` is not in the allowlist, so each fails closed. Left unresolved
instead, they are "an ID that does not exist in the file", which §2.3 also fails
closed. **There is no reading of the ruling under which a commit naming `R2`
passes.**

§3c said to reuse `generate-roadmap.mjs`'s reading strategy rather than invent a
second parser that can drift. Following that instruction is what surfaced this:
the existing parser already reads four collections and the spec describes three.

---

## 3. §5 — the replays, verbatim

Harness: the gate implemented exactly as §2/§4 specify, reading
`docs/ROADMAP.yaml` **from each range's head** per §5, so each replay sees the
board as it stood at that moment rather than as it stands today.

### 3a. The BUG-7 incident — `ce036f9..06dc830` — ACCEPTANCE CRITERION MET

The push that carried `00881dc` to `main` is the ten-commit fast-forward
`ce036f9..06dc830` (`docs/DEPLOY_LOG.md:277`, the retroactive 2026-08-14 entry).

```
BUG-7 INCIDENT (§5)   range=ce036f9..06dc830   regex=ANCHORED(spec)
commits=10  ids-found=2  unattributed=7
VERDICT: BLOCKED — 1 failing row(s)

FAILING ROWS:
  ✗ BUG-7 — in_progress — [bugs] Concurrent syncs raced on the sales caches — P2002, and the

PASSING ROWS:
  ✓ BUG-6 — staging — [bugs] Dashboard store switch serves the previous request's sales —
```

**The gate fails on BUG-7, as §5 requires, using the spec's own anchored regex.**
The one thing DEBT-72 was built to catch, it catches. It holds under the relaxed
regex too, which additionally resolves `F-4 — shipped` and drops unattributed to
zero.

### 3b. The 2026-08-17 promotion — `06dc830..7e77ea6`

```
regex=ANCHORED(spec)   commits=47  ids-found=1  unattributed=43
VERDICT: BLOCKED — 1 failing row(s)
  ✗ HR-11d — in_progress — [phases] Hollow signed records — completion reads document checkpoint

regex=LOOSE +rulings   commits=47  ids-found=9  unattributed=9
VERDICT: BLOCKED — 3 failing row(s)
  ✗ HR-11d — in_progress
  ✗ HR-11k — in_progress — [phases] R2 — two upload paths: new file re-signs, new version does n
  ✗ HR-11n — in_progress — [phases] Orphaned Signature checkpoints cannot be removed — DELETE re
PASSING ROWS:
  ✓ BUG-7 — verified      ✓ DEBT-70a — verified   ✓ DEBT-70b — verified
  ✓ HR-11j — verified     ✓ HR-11m — verified     ✓ HR-11o — verified
```

Not predicted — run. **The gate would have blocked the 2026-08-17 promotion.**
It blocks on three rows that are *still* `in_progress` today, days after shipping
to production. Those three are stale board entries, not unfinished work: this is
the handoff's own lesson — *the board can be stale about production* — now
measured. The gate is reading the board correctly and the board is wrong.

### 3c. A clean older range that passes — NOT FOUND

Eleven historical promotion ranges swept. `PASS` appears only where the regex
found **zero** IDs:

```
label        mode   commits  ids  unattr  verdict
07-27        ANCH        1     0       1  *** PASS ***          <- vacuous
07-27        LOOSE       1     1       0  *** PASS ***
07-29a       ANCH       20     3      17  *** PASS ***
07-29a       LOOSE      20     9       1  BLOCKED(4): DEBT-17,DEBT-9,BUILD-2,PERM-5
07-29b       ANCH        1     0       1  *** PASS ***          <- vacuous
07-29b       LOOSE       1     1       0  *** PASS ***
07-29c       ANCH        4     1       1  *** PASS ***
07-29c       LOOSE       4     1       0  *** PASS ***
08-01a       ANCH       21     0      21  *** PASS ***          <- vacuous, 21/21 invisible
08-01a       LOOSE      21    12       0  BLOCKED(4): DEBT-2b,DEBT-2a,DEBT-1b,DEBT-1a
08-01b       ANCH        6     0       6  *** PASS ***          <- vacuous
08-01b       LOOSE       6     5       1  BLOCKED(3): DEBT-37,DEBT-18,DEBT-33
08-0x        ANCH      128    20      73  BLOCKED(7): TPL-1b,TPL-1a,L-2,DEBT-55,DEBT-50
08-0x        LOOSE     128    35      35  BLOCKED(14): BOOKKEEP-4,DIAG-2,TPL-1b,TPL-1a,DEBT-58
08-1x        ANCH        2     1       1  BLOCKED(1): BOOKKEEP-4
08-1x        LOOSE       2     1       0  BLOCKED(1): BOOKKEEP-4
08-12        ANCH       33     8      15  BLOCKED(8): DOC-1,HR-28,HR-26,HR-24,HR-25
08-12        LOOSE      33     8       4  BLOCKED(8): DOC-1,HR-28,HR-26,HR-24,HR-25
08-14 BUG-7  ANCH       10     2       7  BLOCKED(1): BUG-7
08-14 BUG-7  LOOSE      10     3       0  BLOCKED(1): BUG-7
08-17        ANCH       47     1      43  BLOCKED(1): HR-11d
08-17        LOOSE      47     9       9  BLOCKED(3): HR-11k,HR-11n,HR-11d
```

**`08-01a` is the entry that should decide this.** Twenty-one commits, every one
invisible to the specified regex, verdict `PASS`. That is the shape CLAUDE.md
§ "Verifying a guard covers every path" already names: *a search that finds
nothing wrong reads as coverage confirmed, so the session stops looking* — and a
check that can produce a **false pass** is a different class of tool from one
that can only produce a false fail. Shipped as specified, the gate would issue a
clean bill of health on a promotion it never examined.

### 3d. The unknown-status fixture

Not built. The three defects above already decide the outcome, and constructing a
fixture to prove fail-closed behaviour on a hypothetical status is moot while 28
real rows exercise the same path with a *missing* one.

---

## 4. §3b / §3c / §3d — the remaining ground truth

**§3b — `yaml` dependency confirmed.** `package.json:62`, `"yaml": "^2.9.0"`. No
new dependency would have been needed. `package.json` `scripts` currently holds
`predev`, `dev`, `prebuild`, `build`, `vercel-build`, `start`, `lint` — no
`promote`, and none was added.

**§3c — `scripts/generate-roadmap.mjs` read in full (162 lines).** Header
declares it *"STRICTLY READ-ONLY with respect to ROADMAP.yaml"*. It parses with
`yaml`'s `parse`, normalises `Date` objects to ISO strings, and coerces
`commits` entries to `String` to survive YAML reading short SHAs as numbers
(DEBT-21 — both the all-digit and the scientific-notation shapes). Any real
`promote.mjs` should reuse this normalisation; a second parser would drift.
**One operational note for whoever builds it:** `docs/ROADMAP.yaml` is 1.13 MB,
and `git show <ref>:docs/ROADMAP.yaml` through `execFileSync` **exceeds Node's
default 1 MB `maxBuffer` and dies with `ENOBUFS`.** This was hit during the
replay. Pass an explicit `maxBuffer`.

**§3d — `docs/WORKFLOW.md` §2 as it reads BEFORE any edit** (lines 26–41; no edit
was made, so this is also how it reads now):

```bash
git checkout main
git pull origin main          # make sure local main is current
git merge staging --no-ff --no-edit   # --no-ff = always make a merge commit; --no-edit = no editor popup

# ── write the docs/DEPLOY_LOG.md entry NOW, and commit it, BEFORE the push ──
# (open the file, add the entry for this promotion, citing the merge SHA above)
git add docs/DEPLOY_LOG.md
git commit -m "DEPLOY_LOG: <date> production promotion (<what it carried>)"

git push origin main          # → Vercel auto-deploys www.usefroot.com
git checkout staging          # go back to staging for your next work
```

---

## 5. §9 — what contradicts §1 of the prompt

**§1 says WORKFLOW.md §2 promotes with `git merge staging --no-edit`. It does
not.** The file reads `git merge staging --no-ff --no-edit`, and carries a
"Why `--no-ff`" paragraph citing DEBT-38 by name, plus the `git add` /
`git commit` DEPLOY_LOG steps *inside* the copyable block with a note explaining
that they were moved in on 2026-08-07 *"on the first promotion run under this
section"* precisely because prose-only steps do not happen.

Consequences for the ruling:

- **Ruling §2.2 — "`--no-ff` is enforced by construction" — is already satisfied
  in prose.** It was, however, prose during the 2026-08-17 promotion, and that
  promotion *did* produce a `--no-ff` merge (`7e77ea6`, two parents). So the
  prose worked the one time it was followed. What it does not survive is a
  promotion run from memory instead of from the file — which is DEBT-38's actual
  mechanism.
- **DEBT-38's candidate (a), folding the log entry into the promotion, is also
  already in the block** and dated 2026-08-07.
- Therefore the genuinely new thing DEBT-72 buys is **the roadmap status gate**,
  which exists nowhere, plus moving the whole procedure from prose a human copies
  into a script a human runs. The `--no-ff` half is a consolidation of something
  already written down, not a new guarantee. This does not weaken the case for
  the script; it changes what the script is *for*.

Also recorded: the promoted range is **47** commits, not 48.

---

## 6. What is now Gary's to rule

Four decisions. Every one of them changes ruled behaviour in §2, so none was
taken here.

1. **The row-ID pattern.** The `^` anchor cannot stay — it is the vacuous-pass
   defect. Unanchored `\b([A-Z][A-Za-z0-9]*-\d+[a-z]?)\b` recovers 81%. Open
   underneath it: whether to read the commit **body** as well as the subject
   (`%s%n%b`), which is how `893d91d` and the `R1`/`R2`/`Case A` commits name
   their rows, and whether one commit may carry more than one row ID (the
   harness took only the first match; the merge subject alone names eight).
2. **Rows with no `status:`.** 28 of 75 debt rows. Fail closed as ruled and 37%
   of the board blocks promotions; treat absent as a pass and the ruling's
   fail-closed principle is punctured. A third option is a one-off board hygiene
   pass to give all 28 an explicit status — which is real work, and is the only
   option that leaves §2.3 intact as written.
3. **`rulings` as a fourth collection.** Resolve `R1`…`R6` and add `ruled` to the
   allowlist, or declare `R#` not a row ID and exclude the pattern. Doing
   neither fails closed on three commits in the last promotion alone.
4. **Whether `in_progress` at promotion time is the defect or the norm.** This is
   the deepest one. `shipped` means "merged to main, live in prod" and `verified`
   means "shipped AND smoke-tested" — by definition neither can be true *before*
   the promotion that ships them. So the allowlist's only workable pre-promotion
   value is `staging`, and the board shows sessions routinely do not set it: three
   rows from the 2026-08-17 promotion still read `in_progress` today. Either the
   gate is right and a discipline of flipping rows to `staging` before promotion
   has to start, or the allowlist needs a fifth value. **The gate as ruled is
   correct and would currently block every promotion**, which is a true statement
   about the board rather than a bug in the gate — but it is not a state the
   script can ship into without a decision.

## 7. The bootstrap, per §8

Unchanged and still true, and now with an extra turn. DEBT-72's row reads
`planned`. Once this session's commits are in `origin/main..origin/staging`, a
working gate reads DEBT-72's own row and blocks its own promotion. §8 says set
the row to `staging` as part of the session's roadmap update — **that was not
done, because the work it would attest to does not exist.** The row stays
`planned`, which is accurate. It is also, correctly, a block.
