# FIXTURE-TRIAGE — audit of the five fixtures N-5-SYNC found red

**TIER 3, audit only.** Started from the N-5-SYNC session (2026-11-03), which re-ran
all 65 earlier fixtures and found these five red both with and without its
change. Nothing in `src/` or `scripts/` was edited by this session. Nothing
committed, nothing pushed.

- Repo `froot/`, branch `staging`, HEAD `2556904` (working tree clean — **no
  untracked files at all**, so the suspected stray `src/app/menu/tmp-n1e-ui/`
  page does not exist and is not the cause of either eng1 or nav1).
- Every fixture run with `npx tsx scripts/<name>.ts` from `froot/`, local `.env`.
- Database evidence below is **local dev, Neon branch `br-broad-wave-a6vpjdw0`**
  (per the brief; the fixtures create and clean up their own throwaway orgs).
- Run date **2026-11-03 (Tuesday)**. Two of the five failures are
  calendar-driven, so the date is part of the evidence.

## Summary

| Fixture | Failing check | Verdict | Introduced by | Class |
|---|---|---|---|---|
| eng1-engagement | 26 — every page.tsx has a ROUTE_PATTERNS entry | **CODE stale** (list fell behind 18 pages) — a real, low-severity data defect | `1641d1e` HELP-1a, 2026-09-04 (first of 10 commits) | FIX NOW *(behaviour change — needs Gary's go)* |
| nav1-url-sets | 15 role/scenario differ | **FIXTURE needs a ruling** — 5 nutrition URLs gained, none lost | `70baf2f` N-1, 2026-11-01 (+ `218e984`, `d88ef4d`, `68571da`) | RULING NOW |
| hr8-compliance | 9 checks (s2/s3 status, pct, rollups) | **FIXTURE stale** — expectations predate rulings R1 and R2 | `32205a4` R1 2026-08-15, `457a57f` R2 2026-08-16 | FIX NOW *(fixture-only)* |
| ms5 | C14b — pay-access MANAGER CSV confidentiality | **FIXTURE calendar flake (DST)** — no leak | latent since `511f321` MS-5; triggered by DST end 2026-11-01 | FIX NOW *(fixture-only)* |
| notify14-doc-digest | §7 default slot sent=0, expected 4 | **FIXTURE time bomb** — hard-coded Monday 2026-11-02 is this week | latent since `de21089` NOTIFY-14; triggered week of 2026-11-02 | FIX NOW *(fixture-only)* |

**No code regression in four of five.** The one place the code is actually
wrong is eng1 (engagement rollups), and it is wrong in the way its own comment
predicted. None of the five is related to N-5 or N-5-SYNC.

Correction to the brief: hr8 shows **9** failed checks on this run, not 10.

Triage counts (MEMORY: triage findings before filing rows): **FIX NOW 4**
(1 behaviour-changing, 3 fixture-only), **RULING NOW 1**, **COMMENT 1**
(the meta-finding at the end), **ROW 0**.

---

## 1. `verify-eng1-engagement.ts` — check 26

**Output (local dev):**

```
pages with no ROUTE_PATTERNS entry: /calendar, /help, /help/[slug],
/inventory/recipes/import/bevspot, /menu/[slug], /my/help, /my/help/[slug],
/nutrition, /nutrition/import, /nutrition/labels, /nutrition/menu,
/nutrition/menu/[salesItemId]/label, /nutrition/publish, /nutrition/settings,
/print/nutrition-label/[salesItemId], /settings/notifications,
/staff/milestones, /staff/milestones/report
FAIL  26. every page.tsx has an entry, and vice versa   expected 0, got 18
```

No "entries with no page" — the list only fell behind; nothing was removed.

**Mechanism.** `ROUTE_PATTERNS` in `src/lib/engagement.ts` is a hand-maintained
closed list; `normalizePath()` maps every beacon path onto it or onto `/other`.
The file's own header says: *"KEPT IN SYNC BY THE FIXTURE, NOT BY DISCIPLINE …
A page added without an entry here would otherwise roll up silently as
'/other' — green everywhere, wrong on the report."* `engagement.ts` has not been
touched since `f1e9833` (ENG-1, 2026-08-30). Since then 18 pages shipped with no
entry.

**Verdict: the CODE is stale, the fixture is correct.** Consequence in
production: since 2026-09-04, visits to Help, Calendar, Notification settings,
Staff Milestones, Milestone Report, BevSpot import and every Nutrition page roll
up as `/other` on `/staff/engagement`. Not a security problem — `normalizePath`
is still total and `UsageDaily` is still bounded — just wrong numbers on a
report. History already recorded as `/other` cannot be recovered.

**Introducing commits** (first-add of each page.tsx, `git log --diff-filter=A`):

| Commit | Date | Pages |
|---|---|---|
| `1641d1e` HELP-1a | 2026-09-04 | /help, /help/[slug], /my/help, /my/help/[slug] — **first divergence** |
| `bb675e1` CAL-1 | 2026-09-18 | /calendar |
| `a16bab2` NOTIFY-2a | 2026-09-20 | /settings/notifications |
| `4f21157` MS-1 | 2026-10-15 | /staff/milestones |
| `511f321` MS-5 | 2026-10-19 | /staff/milestones/report |
| `95c336b` BEV-1 | 2026-11-01 | /inventory/recipes/import/bevspot |
| `70baf2f` N-1 | 2026-11-01 | /nutrition, /nutrition/import, /nutrition/menu |
| `218e984` N-1e | 2026-11-02 | /nutrition/labels |
| `d88ef4d` N-2 | 2026-11-02 | /nutrition/menu/[salesItemId]/label, /nutrition/settings, /print/nutrition-label/[salesItemId] |
| `68571da` N-3 | 2026-11-02 | /nutrition/publish, /menu/[slug] |

So eng1 has been red for two months, not since `e32e22c`.

**Proposed fix (not applied):** add the 18 patterns to `ROUTE_PATTERNS`. The
static-beats-dynamic rule in `normalizePath` already handles the new siblings
(`/nutrition/menu` vs `/nutrition/menu/[salesItemId]/label`, `/help` vs
`/help/[slug]`). `/menu/[slug]` and `/print/...` are unreachable by the beacon
and are listed for totality, as the header already does for `/print/*`.
**FIX NOW — but it changes what the engagement report records, so it waits for
Gary's go.**

---

## 2. `verify-nav1-url-sets.ts` — "15 role/scenario differ"

**Output (local dev, abridged):** every scenario, every role except STAFF:

```
ADMIN    LOST [] GAINED ["/nutrition/import","/nutrition/labels","/nutrition/menu","/nutrition/publish","/nutrition/settings"]
MANAGER  LOST [] GAINED ["/nutrition/menu"]
STORE    LOST [] GAINED ["/nutrition/menu"]
STAFF    IDENTICAL
```

3 roles × 5 scenarios = 15. **Nothing LOST anywhere** — the regression this
fixture exists to catch is absent.

**Mechanism.** The fixture compares sidebar items parsed from pinned baseline
`10439b3` against the working tree, filtered by the real `can()`. A GAINED URL is
a failure unless listed in `SANCTIONED_ADDITIONS`, and the file states that
adding an entry *"is a RULING, not a fix"* (precedents: `/help` HELP-1a,
`/calendar` CAL-1 / Gary's R5 ruling 2026-09-17). The Nutrition group was added
to `src/components/layout/sidebar.tsx` without a sanction entry.

Second, smaller staleness: the fixture models group-level module gating only by
hard-coded href prefix (`!i.href.startsWith("/inventory/") || env.inventoryModule`).
The Nutrition group is gated `requiresModule: ["inventory", "nutrition"]`, and
the fixture has no nutrition-module scenario, so it cannot prove that the
Nutrition items vanish when the module is off.

**Introducing commits** (`git log -S` on each href in sidebar.tsx):
`/nutrition/menu` + `/nutrition/import` `70baf2f` N-1 2026-11-01 (**first
divergence**); `/nutrition/labels` `218e984` N-1e; `/nutrition/settings`
`d88ef4d` N-2; `/nutrition/publish` `68571da` N-3. The nutrition URLs are the
only unsanctioned gains, so nav1 should have been green from CAL-1 until
2026-11-01 (inferred from the output, not re-run at an older commit).

**RULING NOW for Gary:** are these five URLs sanctioned additions —
`/nutrition/menu` for ADMIN/MANAGER/STORE (`nutrition.view`), and
`/nutrition/import`, `/labels`, `/settings`, `/publish` for ADMIN only
(`nutrition.manage`)? If yes, the fixture change is five `SANCTIONED_ADDITIONS`
lines naming N-1/N-1e/N-2/N-3 and the ruling date, plus (recommended) a
"nutrition module off" scenario so the gate is actually exercised. The output
above shows the capability split is exactly what the sidebar declares; whether
that is the *intended* visibility is the ruling. `BASELINE_REV` must not move.

---

## 3. `verify-hr8-compliance.ts` — 9 failures

**Output (local dev):**

```
✗ s2: docA complete via all-required-acked (pending-record)
✗ s2: pct 33 (1/3) — got 0
✗ s3: docB needs-resign (record pinned to v1)
✗ s3: pct 0
✗ summaries: s2 → 33
✗ rollup: overdue 1 · needs-resign 1
✗ store A: 2 staff, 4/6 = 67% — got 2 staff, 50%
✗ store B: 1 staff, 0/4 = 0%
✗ manager scope: required 6, completed 4
```

**Mechanism.** The fixture was last edited `d728da4` (DOC-1 A, 2026-08-12). It
asserts two behaviours that Gary reversed by ruling days later:

1. **s2 — "all required checkpoints acked, no record yet → complete
   (pending-record)."** Reversed by **R1** (`32205a4`, ruled 2026-08-15):
   *completion derives from the signed record, not checkpoints.*
   `documentCompletion()` in `src/lib/hr-completion.ts` now returns
   `in-progress` when `recordMissing`. So s2 docA is in-progress and s2 pct is
   0, not 33.
2. **s3 — "signed record on v1, current is v2 → needs-resign."** Reversed by
   **R2** (`457a57f`, ruled 2026-08-15, committed 08-16): *a prior version's
   signature satisfies the current one* (`hasCurrentCycleRecordOnEarlierVersion
   → signed`). So s3 docB is complete, which moves s3 pct, store B, and the
   needs-resign count.

Every downstream number follows from those two: store A = (3 + 0)/6 = 50%;
store B = 1/4; manager scope completed = 3, not 4; org rollup completed stays 4
only by coincidence (s2 loses 1, s3 gains 1), which is why that check still
passes.

**Verdict: FIXTURE stale, code correct per R1/R2.** R1/R2 behaviour is
exercised by the later DOC-7/DOC-8 fixtures (`verify-doc7-annual-resign.ts`,
`verify-doc8-due-dates.ts`, both reference `documentCompletion` /
`recordMissing`). hr8 has been red since 2026-08-15 — again, not since
`e32e22c`.

**FIX NOW (fixture-only, no behaviour change):** re-express s2 as "all
required acked, no record → in-progress, 2/2 checkpoints" and s3 docB as
"complete via the v1 record (R2)", then recompute the pct / rollup / store /
manager-scope expectations. Optionally add an s3 variant with Case A
(per-version re-verification, `bf7cd28`) switched on, which is the one path
that still yields needs-resign for a version bump, so the fixture keeps
covering that status. Waits on Gary's go only because this is a TIER 3 audit
session.

---

## 4. `verify-ms5.ts` — C14b

**Output (local dev):**

```
FAIL  C14b. the pay-access MANAGER's CSV has Ana's dates but not Cara's (confidential)
        expected [true,false], got [true,true]
50 passed, 1 failed
```

This looked like a confidentiality leak, so it was probed rather than reasoned
about. A scratchpad copy of the fixture (imports pointed back at the repo, no
repo file touched) printed the pay-access MANAGER's CSV lines containing
"Cara's" date string, on local dev `br-broad-wave-a6vpjdw0`:

```
PROBE cara date 2027-01-22 ana date 2027-01-22
PROBE line: MS-5 Ana,MS-5 Pacific One,Active,2026-07-20,105,…,Recent raise,2026-10-24,2027-01-22
```

**Cara's and Ana's expected dates are the same string, and the only line that
contains it is Ana's.** Cara's row carries no raise date — C12 (payload) and
C13/C14 (no-pay MANAGER) pass too. **No leak.**

**Mechanism.** The fixture wants Ana (Los Angeles) and Cara (Denver) to have
raise dates on *different* local days, so the CSV check can tell them apart.
`splitHour()` picks an instant on *today's* UTC date where Denver is already a
day ahead of LA — computed with *today's* UTC offsets (MST/PST, 07:30 UTC). The
raise is then placed at `ago(10)`, ten days earlier — 2026-10-24, still daylight
time (MDT/PDT), when 07:30 UTC is 01:30 Denver and 00:30 LA: **the same day.**
So for the ~10 days after each DST change the two dates collapse and C14b fails
for any build. It began failing 2026-11-01 (DST end) and will pass again on its
own around 2026-11-11 — and break again for ~10 days after 2027-03-14.

**Introduced:** latent since `511f321` (MS-5, 2026-10-19), the only shape of
this test; triggered by the calendar, not a commit. Nothing to bisect.

**FIX NOW (fixture-only):** choose the split instant for the raise day itself —
i.e. compute `splitHour()` relative to the `ago(10)` date (or assert
`raised(LA) !== raised(DEN)` up front and pick the instant by search over that
day). Fixture-only; no product behaviour.

---

## 5. `verify-notify14-doc-digest.ts` — §7 default slot

**Output (local dev):**

```
✓ result: sent 4, failed 0 — {..."sent":4,...,"intentState":"queued"}
✓ a second run in the same period mails nobody (F11)
✗ FAIL the default slot runs the org once and mails the four —
  [{"organizationId":"cmw16k07i0000bypd5wl0imps","views":4,"recipients":7,"sent":0,"failed":0,"dryRun":0,"intentState":"sent"}]
53/54 passed — 1 FAILED
```

(org id is a throwaway fixture org on local dev `br-broad-wave-a6vpjdw0`,
cleaned up by the fixture.)

**Mechanism.** §5 runs `processDocDigest` for `localDate = today` (real clock,
2026-11-03) and sends the weekly digest, writing intent
`{orgId}:{isoWeekKey(today)}`. §7 then calls `runScheduledEmails` at the
hard-coded `MON_0830 = 2026-11-02T16:30Z`. The dedupe key is
`periodKey("weekly", localDate)` = ISO week (`src/lib/notifications/schedule.ts:73`).
2026-11-02 and 2026-11-03 are the **same ISO week**, so §7 finds §5's intent
already `sent` and correctly mails nobody — the F11 send-lock working as
designed. Any day before 2026-11-02 the two calls landed in different weeks.

**Verdict: FIXTURE time bomb, code correct.** It will pass again from Monday
2026-11-09 Pacific. `doc-digest-alerts.ts` and `scheduled-emails.ts` are
unchanged since `de21089`.

**Introduced:** latent since `de21089` (NOTIFY-14, 2026-10-27), which
hard-coded the 2026-11-02 Monday (also `MON_0730`, `TUE_0830`); triggered by
the calendar reaching that week. Nothing to bisect.

**FIX NOW (fixture-only):** derive the Monday constants from the clock (e.g. the
Monday of *next* ISO week relative to `today`, so §5 and §7 can never share a
period), or reset the org's intents between §5 and §7. Fixture-only.

---

## COMMENT — the meta-finding

Two of these five (eng1 since 2026-09-04, hr8 since 2026-08-15) have been red
for two to three months while phases shipped over them, and eng1 is a fixture
whose code comment calls it *"the only reason a hand-maintained list is
acceptable."* A sync-by-fixture rule only works if someone runs the fixture
when adding a page; nothing currently does. Two more (ms5, notify14) are
calendar-sensitive and would have flipped red on any build this week. Worth
Gary knowing when weighing how much a "N earlier fixtures pass" line in a
session report proves. No row filed — this is a comment, not work.

## What this session did not do

- Edited nothing under `src/` or `scripts/`; the ms5 probe ran from a
  scratchpad copy outside the repo.
- Did not run the fixtures against staging or production.
- Did not bisect with a checkout: every introducing commit is identified from
  `git log -S` / `--diff-filter=A` plus the mechanism, and for ms5/notify14 the
  trigger is the calendar, not a commit.
- Did not commit this file. Nothing pushed.
