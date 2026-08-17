# BUG-7 closure + five unlogged fast-forward promotions — docs reconciliation

**TIER 2.** Docs-only. No source files, no schema, no migration, no behaviour change.
Declared TIER 2 rather than TIER 3 because nothing executable is touched and every fact
below is already measured — but the audit-first floor still applies: read before writing,
and report any divergence between this prompt and the repo rather than proceeding.

Save this file to `docs/prompts/` before starting. Do not edit it after execution —
addenda only.

---

## Who I am and how we work

I'm Gary, founder and sole developer of UseFroot (usefroot.com), a multi-tenant
store-operations SaaS for Square merchants, anchored by Keva Juice. Next.js 16, React 19,
TypeScript, Tailwind 4, Prisma 7, Neon Postgres, Clerk, shadcn/ui, Vercel, Square OAuth.

Repo `github.com/indianathomas-afk/froot`, local `~/Claude_Projects/Froot/froot` — the
lowercase `froot` is the git root, the capitalized parent is not.

House rules that bind this session:

- **I run all pushes.** Commit only. Never push, never promote.
- **No `&&` chains.** One command per block. I read the result before the next runs.
- **Two-commit pattern**: work commit, then a docs/roadmap recorder commit naming the SHA.
- **Preserve-and-mark.** `docs/DECISIONS.md` and `docs/ROADMAP.yaml` are append-with-preamble.
  Never overwrite, never delete a note, never silently correct one. Original text stays
  below a dated correction block.
- **Evidence carries its source.** A database result names the Neon branch. A log result
  names the environment. A Square result names the application ID.
- **Timestamps.** Neon `DateTime` columns are `TIMESTAMP(3)` UTC. Vercel log timestamps and
  git commit times in this session are Pacific (`-0700`). Convert before comparing and
  state the conversion inline. This trap has produced false investigations here before.
- Work on branch `staging`. Confirm with `git status -sb` before the first edit.

---

## Why this session exists

BUG-7 is fixed, in production, and now **verified in production under live load**. It was
never verified on staging, its roadmap row still says `in_progress`, and the promotion that
carried it to production was one of **five consecutive fast-forward merges with no
`docs/DEPLOY_LOG.md` entry between them**.

The code is not the problem. The record is.

---

## Section 0 — Audit before writing (do this first, report, then stop)

Read, in this order, and report what you find before editing anything:

1. `docs/prompts/BUG-7_AUDIT.md` — the 2026-08-13 TIER 3 audit. It is the record. Do not
   re-derive it.
2. The `BUG-7` row in `docs/ROADMAP.yaml` (begins line ~9483 at time of writing).
3. The `F-4` row in `docs/ROADMAP.yaml` (begins line ~2657), specifically its first
   blocker — "PRODUCTION CONFIGURED 2026-08-13 BY GARY — STILL OPEN".
4. `docs/DEPLOY_LOG.md` — read the heading order with `grep -n "^## "`. **The file is
   reverse-chronological, newest at top.** A `tail` on this file produced a false debt row
   once (DEBT-23, withdrawn). Do not repeat it.
5. The `DEBT-38` row — fast-forward promotions leave no artifact that prompts an entry.
6. The `DEBT-69` row — coalescing, filed as BUG-7's companion.

Then run, one at a time, and report:

```
git log --format='%h %ad %s' --date=iso f318d2e..06dc830
```

```
git reflog show main
```

Confirm from the reflog that `main@{0}` through `main@{4}` are all
`merge staging: Fast-forward`, and that the last real merge commit is `f318d2e` at
`main@{5}`.

**Stop here and report.** If anything above diverges from what this prompt asserts, say so
and do not proceed — the divergence is the finding.

---

## Section 1 — The evidence of record

All of this is measured. Do not re-derive it, and do not soften it into hedged language.
Reproduce it faithfully into the documents named below.

### 1a. Production is running the fixed code

Neon console, **production branch `br-sparkling-block-a620qvg4`** (endpoint
`ep-green-smoke`), 2026-08-16:

`SalesPeriodCache` rows carry two `id` formats. Prisma generates cuids client-side; the
post-BUG-7 raw `INSERT` supplies its own `randomUUID()`. `ON CONFLICT DO UPDATE` does not
rewrite `id`, so a row born under the old code keeps its cuid forever even after the new
code rewrites its numbers. **The boundary therefore falls on business date, not on
`syncedAt`** — `syncedAt` is overwritten on every write and was never a creation time.

| business date | id format | rows |
|---|---|---|
| 2026-08-16 | uuid | 11 |
| 2026-08-15 | uuid | 11 |
| 2026-08-14 | cuid | 11 |
| 2026-08-13 | cuid | 11 |
| 2026-08-12 | cuid | 11 |

**Business date 2026-08-15 is the first uuid day.** That brackets the production rollout to
between the creation of Aug 14's rows and Aug 15's. 11 rows on every date, no gaps — every
linked store is syncing, none silently missing.

The mixed format is the documented BUG-7 fingerprint predicted in `src/lib/sales-sync.ts`
(the comment at the `values` map). Ids are opaque, unreferenced by any foreign key, and
never exposed in a response. **No backfill. No cleanup.** Rewriting a column nothing reads
would be churn against the additive-only rule.

### 1b. The Square webhook is delivering

Square Developer Console, **production application `sq0idp-UdjqLfkxl0hlbw7b30IiLA`**
("Froot"; the staging application is `sq0idp-YPgmfGap_oYDRTyYIFG3zw`, "Froot Staging" —
two portals, deliberately, so staging tests against real live data separately).

**34,914 delivery results, all 200**, to `https://www.usefroot.com/api/webhooks/square`,
most recent 2026-08-16 13:18 PT. Square retains webhook logs 28 days.

**A 200 does not prove the sync ran.** The handler ACKs before processing
(`route.ts:89-94`), so a 200 proves signature verification and acceptance only. What
follows is proven separately in 1c and 1d.

### 1c. Every production store is syncing live

Same production branch `br-sparkling-block-a620qvg4`, 2026-08-16 ~21:10 UTC (2:10 PM PT):

Nine linked stores — Spanish Springs, South Reno, Meadowood Mall, Carson, Las Brisas, UNR,
Sparks, University Village, Southgate — all with `last_sync` inside the previous ten
minutes and `latest_day` = 2026-08-16. Keva Kiosk (17:12 UTC) and Cafe De Keva Cart
(11:01 UTC) lag, consistent with lower volume or closure. Rohan's Restaurant is unlinked
(`squareLocationId` null).

**This is F-4's closing evidence** — real transactions moving "Today so far" with no manual
refresh, which is exactly what the F-4 blocker said was outstanding and needed a store to
be open.

### 1d. The guard fires under real contention — BUG-7's actual verification

Vercel **production** function logs, 2026-08-16, ~11:53–14:11 PT
(18:53–21:11 UTC), filter `discarded`:

Approximately **55 occurrences** of

```
[sales-sync] store=<id> wrote 0/1 day(s); discarded 1 superseded by a newer fetch: 2026-08-16
```

all on `POST /api/webhooks/square`, across at least nine distinct store ids
(`cmqvygqz2…`, `cmqvygq1m…`, `cmqvygque…`, `cmqvygqx9…`, `cmqvygr1l…`, `cmqvygqxb…000004l45ajpg1la`,
`cmqvygqxb…000004l4v0im0byu`, `cmqvygpze…`, `cmqvygr36…`).

Two collisions are tight enough to be worth naming in the record, because they are the
exact shape that used to throw P2002:

- `12:52:27.19` and `12:52:27.26` PT — same store, **70 ms apart**
- `13:22:58.94` and `13:22:59.21` PT — same store, **270 ms apart**

**Read the "0/1" correctly, and say so in the record.** The log statement is wrapped in
`if (discarded.length > 0)`, so **a fully successful write emits no log line at all.**
Filtering on `discarded` can only ever return losers. The winners are invisible by
construction, and their existence is proven by 1c — every store's `syncedAt` is minutes
fresh. A reader who finds this filter later and reads a 100% discard rate as a defect will
be wrong, and the record should stop them.

`P2002` cannot appear in the post-fix code: `ON CONFLICT` makes it structurally
impossible. An empty `P2002` result is therefore confirmation the old path is gone, **not**
proof the guard works. 1d is the only direct proof.

### 1e. A measured number DEBT-69 did not previously have

~55 discards in ~2.5 hours across 9 stores is roughly **one discarded sync every 2–3
minutes**. Each discarded sync completed a full paginated Square `orders/search` before
losing at the write. That is real Square API quota and real lambda time spent on work that
is thrown away.

The audit estimated 3–5 events per order and 76–144 paid orders per store per day. This is
that multiplier, measured rather than predicted. Put the number on DEBT-69.

---

## Section 2 — The work

### Task 1 — `docs/ROADMAP.yaml`, BUG-7 row

Append a dated block **above** the existing notes, per preserve-and-mark. Do not edit a
word of what is there — in particular leave "FIXED IN CODE 2026-08-13, NOT YET VERIFIED ON
STAGING" standing, and let the new block explain how it was overtaken.

The block must carry:

- `status:` changed from `in_progress` to `verified`.
- **VERIFIED IN PRODUCTION 2026-08-16, NEVER VERIFIED ON STAGING** — stated in those terms.
  This is unusual and the row should say why it is nonetheless sufficient: production
  exercised real contention across nine stores under live webhook load, which the staging
  fixture could only simulate.
- The four evidence items — 1a (id-format boundary, production branch named), 1b (Square
  app id named), 1c (nine stores, timestamps), 1d (the ~55 discards, the two sub-second
  collisions, the environment named).
- **The 0/1 reading**, per 1d. This is the single most important sentence for a future
  reader.
- **Why `P2002` is not the proof** — structurally impossible post-fix.
- The rollout bracket: first uuid business date is 2026-08-15; production ran old code
  through Aug 14's rows and new code by Aug 15's.
- **The gap in the record, stated plainly**: `801dceb` records the commit SHA because the
  two-commit pattern captures it, but nothing captured when it reached production, because
  that promotion was a fast-forward with no DEPLOY_LOG entry. Same root cause as Task 3.
- No repair, no backfill, and why (1a).

**If I supply the Vercel production deployment timestamp for `00881dc` before you write
this**, replace the 24-hour bracket with the exact instant, converting Pacific to UTC
inline. If I have not supplied it, **leave the bracket and say it is a bracket** — do not
state it tighter than the evidence supports.

### Task 2 — `docs/ROADMAP.yaml`, F-4 row

Append above the existing first blocker. Mark the blocker **resolved**, citing 1c and 1b.
Its own text said what remained was one sentence long and needed a store to be open; nine
were. Name the production Square application id and the branch the store evidence came
from.

Note the two-portal arrangement (`Froot` → production, `Froot Staging` → staging) in the
row, because the docs elsewhere record a "staging Square app points at production domain"
gap that this arrangement resolves.

### Task 3 — `docs/DEPLOY_LOG.md`, five retroactive entries

Five promotions reached production as fast-forwards with no entry. Write one entry per
promotion, newest first, at the top of the file, from the `f318d2e..06dc830` output.

Each entry must carry:

- The tip SHA and date, Pacific and UTC both, conversion stated.
- Its full commit list.
- **"FAST-FORWARD, not a merge — `git revert -m 1` does not apply."** Then the reverse-order
  revert list, because that is the only rollback available. This is the format the two
  earlier fast-forward entries already use; match it.
- What shipped, by theme.

The 2026-08-13 entry (`06dc830`) is the one that needs care. It carried, in one push:

- `37361ba`, `b77082e` — BUG-6's two fixes, which **increased** the number of concurrent
  syncers (one store switch went from 2 scheduled syncs to as many as 8)
- `588206c` — the BUG-7 audit
- `00881dc` — BUG-7's guarded upsert
- `728638d`, `9021caa` — BUG-6 verified on staging and closed, BUG-8 filed
- `06dc830` — F-4 production webhook configured

**Say plainly that this single push changed the sales-sync concurrency system in three
directions at once**: more racers, a new guard, and a new continuous writer. And say that
`00881dc` went to production while its own roadmap row read `in_progress` and
"NOT YET VERIFIED ON STAGING".

Record the ordering fact without softening it: the gate at ROADMAP line ~9584 reads
*verify BUG-6 on staging → verify BUG-7 on staging → register the Square subscriptions*.
BUG-6 **was** verified on staging (`728638d` says so). BUG-7 was not. The webhook was
configured two hours later anyway. One missing step in a three-step chain.

Then discharge the standing-note obligations at the top of the file — `65abb74`,
`f318d2e`, `0a745c3`, `a56c905`, and the HR-24/25/26 chain — marking each with the entry
that now names it, per the preserve-and-mark instruction already on that section. Note that
the HR access-control work reaching production unlogged is a **governance failure, not a
live exposure**: HR is dark in production (`HR_MODULE_AVAILABLE` unset) and zero documents
have ever been granted to a real employee.

### Task 4 — `docs/ROADMAP.yaml`, DEBT-38

Append. This is the **second genuine recurrence**, and record the mechanism accurately —
it is not a logging lapse and should not be filed as one. The mechanism is
**end-of-work-block pushing**: the reflog shows Aug 11 morning, Aug 11 afternoon, Aug 12
midday, Aug 12 evening, Aug 13 evening. A working rhythm, not five separate oversights.
A fast-forward leaves no merge commit, so nothing in the flow ever pauses to prompt an
entry.

Record that this also means **five consecutive violations of the `--no-ff` rule added in
`7d984be`**, and therefore five production states with no one-line rollback.

### Task 5 — `docs/ROADMAP.yaml`, DEBT-69

Append the measured number from 1e. Cite the environment and window. Note that the audit
rejected Option 4 as a whole fix — in-process coalescing is per-lambda-instance and cannot
help across instances or users — and that this measurement does not change that: BUG-7's
guard remains the correctness fix, and coalescing remains a cost and quota optimisation.

### Task 6 — `docs/DECISIONS.md`

One entry, dated 2026-08-16, on the pattern this session exposed. Not a mea culpa — a
mechanism. The suggested spine, in my words to be written by me if I choose to expand it:

> A promotion procedure that never reads the roadmap cannot enforce a gate the roadmap
> records. `00881dc` shipped while its own row said `in_progress` and the file said the
> gate required a staging verification that had not happened. Nothing was ignored — nothing
> ever looked.

Include the corollary that matters for future evidence work: **the direct proof of a
concurrency guard is a success log, not an error log**, and the success log here is
`discarded`. Chasing `P2002` was chasing a filter that could only return zero.

---

## Section 3 — NOT in this session

- **Do not draft the WORKFLOW.md promotion gate.** I am ruling that myself and writing it
  in my own words. A recommendation is not a ruling until I have written and ratified it.
  Leave a placeholder row or a marked TODO in `docs/ROADMAP.yaml` and stop there.
- **Do not promote anything.** Staging is ~40 commits ahead of production (R2, Case A,
  HR-11k/n/o, DOC-1, HR-20…HR-28, DEBT-70a/b). None of it moves in this session.
- **Do not touch `src/`.** No code, no fixture run, no schema.
- **Do not backfill the cuid ids.** Ruled: no cleanup (1a).
- **Do not reopen** DEBT-70a's owed post-5pm-Pacific mint verification, the needs-current
  naming problem, or the client half of DEBT-70.

Working tree note: `docs/test_docs/` currently has two untracked PDFs
(`V5_Test_Employee_Handbook copy.pdf`, `V7_Test_Employee_Handbook.pdf`). `V6` was restored
with `git checkout --` before this session. **Leave all three alone** — fixture hygiene is
not this session's scope. Flag them in the session report and nothing more.

---

## Section 4 — Out-of-scope findings

Classify anything found outside the six tasks as **FIX NOW / RULING NOW / COMMENT / ROW**
before the session report. ROW is the last resort. One contained change per row; anything
that expands scope becomes a new row rather than a rider on an existing one.

---

## Section 5 — Commits

Two commits, work then recorder, per the pattern.

1. **Work commit** — Tasks 1–6, all documents.
2. **Recorder commit** — the roadmap/docs entry capturing the work commit's SHA.

Do not push. Report both SHAs and the unpushed count. End the session report with the
unpushed line, and state it against `origin/staging` — not against `origin/main`, which is
a different measurement and has been reported wrongly in this project before.
