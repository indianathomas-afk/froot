# DEBT-72a — board currency: the §3a measurement, and the backfill it authorises

**Session date:** 2026-08-17
**Tier:** 0 (records only)
**Prompt:** `docs/prompts/DEBT-72a_board_currency.md`
**Predecessors:** `docs/prompts/DEBT-72_promotion_gate.md`,
`docs/prompts/DEBT-72_AUDIT.md` (`b809e03`)

This file is the record of what was **measured**, written per §3b **before**
`docs/ROADMAP.yaml` was touched. Per CLAUDE.md § Where documents live it is a
claim wholesale and is never edited afterwards; §7 below was written in the same
authoring pass, after the edits it reports on, and nothing above it was revised.

**No status was changed without a line in §3.**

---

## 0. The one-paragraph version

Seventy-seven rows across four collections read `planned`, `in_progress` or carry
no `status:` at all. Twelve of them contradict git. **Eleven have code on
`origin/main` and read `in_progress`; one has code on `origin/staging` only and
carries no status.** All twelve are changed. The other sixty-five are accurate
and are left alone.

The audit named three stale rows — HR-11d, HR-11k, HR-11n. **There are eleven,
and the eight the audit did not name are the worse half:** HR-20, HR-21, HR-22,
HR-24, HR-25, HR-26, HR-28 and DOC-1 did **not** ship in `7e77ea6`. They reached
production on **2026-08-11 and 2026-08-12**, in three earlier promotions, and
have read `in_progress` for **five to six days**. HR-11d/k/n shipped in
`7e77ea6` roughly twenty-one hours ago.

---

## 1. Method — what was actually run

`git fetch origin` was run first. Every ancestry test is against **`origin/main`
and `origin/staging`**, never local refs, per §3a.

Refs as measured, 2026-08-17:

```
origin/main      7e77ea6ad213832760685315861b5e1ea13d3fa8
origin/staging   893d91dc5f133999fecc50f70f137d33a6f47407
local staging    039e7a23918fa4141708d168e850037f6c12adc0   (2 commits unpushed)
```

`origin/main` is **not** an ancestor of `origin/staging` and vice versa: staging
holds two commits main does not (`5bfda2b`, `893d91d`), main holds the merge
commit `7e77ea6` itself.

Two probes, both over all four collections (`phases`, `bugs`, `debt`,
`rulings`):

1. **Rows carrying `commits:`** — each SHA tested with
   `git merge-base --is-ancestor <sha> origin/main`, then the same against
   `origin/staging`.
2. **Rows without `commits:`** — the row ID resolved **unanchored** against
   commit subjects across both refs (`\b<ID>\b`, so `DEBT-70` does not match
   `DEBT-70a` and `HR-11` does not match `HR-11d`). Per §3a this is a
   measurement convenience and pre-empts no ruling on the gate's regex.

**A third probe was added, and it earned its place.** Commit **bodies** were
searched as well as subjects. This is not in §3a, and it is the only reason
`DEBT-28` appears in this table: `893d91d`, the current tip of `origin/staging`,
names its row in the commit body's last line and nowhere in the subject. The
audit predicted exactly this and the subject-only probe reproduced its blindness.
The body probe returned mostly noise — a row ID in a body is usually a
cross-reference, not authorship — and every body-only hit was read before it was
used.

**A subject or body hit is a pointer, not evidence.** A commit that *files* a row
is not the row's code shipping. Every commitless row below was resolved by
reading the matched subjects, not by counting them.

**Where a work SHA is on `origin/main`, the promotion that first carried it was
identified** by binary-searching main's first-parent chain with
`--is-ancestor`. This is stronger evidence than the bare ancestry bit and it is
what exposed the eight-row finding in §0.

---

## 2. Census — the measurement set

```
phases:  106 entries — shipped 60, planned 30, in_progress 11, verified 5
bugs:      8 entries — shipped  3, planned  3, staging  1, verified 1
debt:     75 entries — shipped 35, <ABSENT> 28, planned  5, verified 5, withdrawn 2
rulings:   6 entries — ruled 6
```

Identical to the audit's census, re-measured rather than cited.

**Candidate rows (status `planned`, `in_progress`, or absent): 77.**
41 phases, 3 bugs, 33 debt, **0 rulings** — every `rulings` row reads `ruled`,
which is outside §3a's measurement set, so the fourth collection was swept and
correctly yielded nothing.

---

## 3. Rows CHANGED — twelve, each with its evidence line

### 3a. Ancestor of `origin/main` → `shipped` (eleven)

Per §3c: `shipped`, not `verified`. No verification is recorded for any of these
and verification is Gary's call.

| # | ID | Coll. | Was | Evidence | Now |
|---|---|---|---|---|---|
| 1 | HR-11d | phases | `in_progress` | `commits:` `576fc4e`, `6ff7ea6` — both `--is-ancestor origin/main` TRUE (and `origin/staging` TRUE). First on main at merge `7e77ea6`, 2026-08-17 02:47:13 UTC. | `shipped` |
| 2 | HR-11k | phases | `in_progress` | `commits:` `457a57f`, `6b2054f`, `bf7cd28`, `4363e3b` — all four `--is-ancestor origin/main` TRUE. First on main at `7e77ea6`. | `shipped` |
| 3 | HR-11n | phases | `in_progress` | `commits:` `72df99a` — `--is-ancestor origin/main` TRUE. First on main at `7e77ea6`. | `shipped` |
| 4 | HR-20 | phases | `in_progress` | No `commits:`. Work commit `0a745c3` ("HR-20: TrainingCategory entity + additive migration (dev-applied)") — `--is-ancestor origin/main` TRUE, and `--is-ancestor 882d6c3` TRUE, the **2026-08-11 morning** promotion. | `shipped` |
| 5 | HR-21 | phases | `in_progress` | No `commits:`. `a56c905` ("HR-21: Category management UI…") and `4207be0` ("HR-21: colour the Category picker's options…") — both on `origin/main`; `a56c905` in promotion `882d6c3` (08-11 morning), `4207be0` in `ec42265` (08-11 afternoon). | `shipped` |
| 6 | HR-22 | phases | `in_progress` | No `commits:`. `bd63da7` ("HR-22: bulk training assignment + due date carry-through") — on `origin/main`, in promotion `882d6c3` (08-11 morning). | `shipped` |
| 7 | HR-24 | phases | `in_progress` | No `commits:`. `0b1cf51` ("HR-24: STORE reads the training library…") — on `origin/main`, in promotion `b853787` (**2026-08-12 midday**). | `shipped` |
| 8 | HR-25 | phases | `in_progress` | No `commits:`. `f5d2883` ("HR-25: completed training stops serving files…") — on `origin/main`, in promotion `b853787` (08-12 midday). | `shipped` |
| 9 | HR-26 | phases | `in_progress` | No `commits:`. `7048504` ("HR-26: MANAGER reads the training library and assigns from it") — on `origin/main`, in promotion `b853787` (08-12 midday). | `shipped` |
| 10 | HR-28 | phases | `in_progress` | `commits:` `142e858`, `340f99b`, `e9a717c` — all three `--is-ancestor origin/main` TRUE and all three `--is-ancestor b853787` TRUE (08-12 midday). | `shipped` |
| 11 | DOC-1 | phases | `in_progress` | No `commits:`. `d728da4` (A), `e18dd54` (B), `9133dcf` (C) — all three on `origin/main` and all three `--is-ancestor ce036f9` TRUE, the **2026-08-12 evening** promotion. | `shipped` |

**The promotion-order constraint HR-24/25/26 carried was honoured** and that is
checked here rather than assumed: all three rode `b853787` together, and
`f5d2883` (HR-25) is the oldest of the three in that range. Nothing promoted the
wider door first.

### 3b. Ancestor of `origin/staging`, not of `origin/main` → `staging` (one)

| # | ID | Coll. | Was | Evidence | Now |
|---|---|---|---|---|---|
| 12 | DEBT-28 | debt | **absent** | `893d91d` ("stores/staff: one em-dash label form across the five hyphen sites"; the ID `DEBT-28` is the last line of the commit **body**) — `--is-ancestor origin/staging` TRUE, `--is-ancestor origin/main` **FALSE**. It is the current tip of `origin/staging`. | `staging` |

**This is the §2 debt corollary's first live case.** DEBT-28 was one of the 28
status-less debt rows, absent-by-convention under DEBT-14's *"a missing status
means OPEN"*. Its code is on staging, so omission no longer describes it, and it
now declares `status: staging` explicitly rather than relying on absence.

---

## 4. Rows LEFT ALONE — sixty-five

Per §3c, *neither ancestor → leave alone. The row is accurate.* Every one of the
sixty-five was measured; none is left alone by default.

**Thirty-two are named by no commit subject at all.** The remaining
**thirty-three** are named only by commits that **file, scope, renumber or
cross-reference** the row — or, in five cases, by work that is explicitly
partial. Filing a row is not shipping it. Worked examples of the distinction,
all left `planned`:

- **HR-23** — one hit, `0273c98` "HR-22 docs: board amendment + **HR-23 filed** +
  disclosure wording of record". Filed by the HR-22 session; never built.
- **HR-27** — one hit, `1892b3a` "…+ **HR-27 filed** blocked on HR-19…".
- **HR-11h**, **HR-11i** — filed out of HR-11d's sessions (`a79047a`, `ba1f38b`).
- **DEBT-73** — filed by `f7723fe` while verifying DEBT-70a/70b.
- **BUG-5**, **BUG-8**, **DEBT-27**, **DEBT-30**, **DEBT-34**, **DEBT-37**,
  **DEBT-39**, **DEBT-40**, **DEBT-44**, **DEBT-49**, **DEBT-51**, **DEBT-52**,
  **DEBT-58**, **DEBT-62**, **DEBT-64**, **DEBT-66**, **DEBT-68** — same shape.

**Five were left alone despite a real work commit naming them, because the work
is explicitly partial.** These are the interesting ones and each is named so the
judgement is auditable rather than silent:

- **DEBT-33** (red lint baseline) — `89c70f7` "fix: prefer-const on hr-signed-pdf's
  inline mark size (**DEBT-33, partial**)". The commit says partial in its own
  subject, and CLAUDE.md § Commit Gates still forbids bare `npm run lint`
  *"until DEBT-33's baseline clears"*. Not cleared. Left absent.
- **DEBT-55** (21 unguarded lookups) — `2e75029` "**DEBT-55 site 1/21**".
  One of twenty-one. Left absent.
- **DEBT-61** — `3f062ab` records "DEBT-61 **containment** in code", not the
  removal the row describes. Left absent.
- **DEBT-50** (no in-app organization switcher) — `5695aab` "DEBT-50 / F1" and
  `3784c34` "DEBT-50 / F4" are two fixes *from the DEBT-50 package*, which
  `1024bf6` records as having been split into **their own rows**. The switcher
  itself is not built. Left absent.
- **L-2** (optional Square labor integration) — `9f317d4` "L-2 re-scoped … **(docs
  only)**" and `92c5c0c` "L-2: **rule** the disconnect question". Two rulings and
  a re-scope; no integration. Left `planned`.

**DEBT-72 is left `planned`, and that is correct rather than incidental.** Its
only commits — `b809e03` (the audit) and `039e7a2` (its recorder) — are on
**local** staging and are **not** on `origin/staging`. Measured against the
remote refs §3a specifies, DEBT-72's code is nowhere, and `planned` is what the
board should say. The audit's own §7 predicted this.

**DEBT-69, DEBT-70, DEBT-71** — left `planned`. DEBT-70's split children
(DEBT-70a, DEBT-70b) shipped and are already `verified`; DEBT-70's own client
half is open and is explicitly out of scope per §6.

---

## 5. FLAGGED — measured, contradicting git, and deliberately NOT applied

### 5a. BUG-6 — `status: staging`, but both its commits are on `origin/main`

| ID | Coll. | Status | Evidence | Proposal |
|---|---|---|---|---|
| BUG-6 | bugs | `staging` | `commits:` `37361ba`, `b77082e` — **both** `--is-ancestor origin/main` TRUE, carried by promotion `06dc830` (2026-08-14). | `shipped` — **NOT APPLIED** |

**Why it is not applied.** §3a defines the measurement set as rows reading
`planned`, `in_progress` or absent. BUG-6 reads `staging`, so it is outside the
set this prompt authorises, and §3c says *no others*. It is nonetheless a row
that contradicts git, its row already records *"VERIFIED ON STAGING BY GARY
2026-08-13 — THE DEFECT IS CLOSED"*, and the promotion that carried it is
logged. **It is Gary's to apply.**

It also says something about the rule this session is writing: a `staging` row
that never advances to `shipped` is the same disease one stage later. The §2 rule
closes the `planned`/`in_progress` → `staging` gap. The `staging` → `shipped`
gap is a second, narrower one, and BUG-6 is its only instance today.

### 5b. Residual work under a `shipped` status — eight of the eleven

Not ambiguous about *where the code is*, and recorded because `shipped` is a
statement about code location, not about completeness. The board's own header
defines `shipped` as *"merged to `main`, live in prod"*. Each of these rows has
open work named in its own notes, and **the correction prepended to each row in
§3a names it** so nothing is lost behind the status flip:

- **HR-11d** — Phase 1's six items shipped (2a–2e in `576fc4e`, 2f in `6ff7ea6`);
  **Phase 2 — the staging browser walk and the DOC-1 non-regression check — is
  not done.**
- **HR-11k** — Phase A, the display follow-ups and Phase B / Case A all shipped;
  **"THE 409 IS STILL OWED. THIRD SESSION."** stands, and Phase B was never
  verified on staging.
- **HR-11n** — Phase A shipped; **the anchor column was withdrawn to Phase B**
  mid-session by Gary's scope cut, and Phase B is not built.
- **HR-20/21/22/24/25/26/28, DOC-1** — each carries its own follow-ups; DOC-1's
  three phases are all shipped but its row records open corrections.

None of this changes the status. All of it stays readable in the row.

### 5c. Not a status contradiction, but a measurement limitation worth recording

Four `shipped` rows carry `commits:` entries that are **not commit SHAs after
YAML parsing** — unquoted short SHAs read as numbers:

```
I-1      1079400000, 3.893e+65
HR-0     233558
HR-11b   547125
L-0      Infinity
```

This is **DEBT-21**, already filed and already `shipped` — the *generator* was
fixed (`70ee3c8`) so the board renders, but the underlying YAML is unquoted and
any consumer that parses the file hits the same coercion. Every other SHA on
those four rows is on `origin/main`, so **no status contradiction is hidden
here** — but these five values cannot be ancestry-tested at all, and a future
promotion gate will have to decide what to do with them. Recorded, not fixed;
fixing them is not this prompt's scope.

---

## 6. Counts

| | |
|---|---|
| Candidate rows measured (planned / in_progress / absent) | **77** |
| Rows CHANGED | **12** (11 → `shipped`, 1 → `staging`) |
| Rows LEFT ALONE | **65** |
| Rows FLAGGED, proposal recorded, **not applied** | **1** (BUG-6) |
| `rulings` rows in the measurement set | **0** (all six read `ruled`) |

---

## 7. §7 re-check — run AFTER the ROADMAP.yaml edits

Written in the same authoring pass as everything above; nothing above was revised.

The §3a probe was re-run against the edited working-tree `docs/ROADMAP.yaml`,
with `origin/main` and `origin/staging` unchanged at the SHAs in §1.

```
Candidate rows remaining (planned / in_progress / absent): 65
Rows contradicting git among them:                           0
```

**Zero rows remain contradicting git within §3a's measurement set.** One row
outside that set still contradicts it — **BUG-6**, §5a — by design, awaiting
Gary.

`npm run build` was green before each commit. `scripts/generate-roadmap.mjs`
parses `docs/ROADMAP.yaml` at prebuild, so the build is the YAML gate.
