# Two silent disagreements — the hours sweep, the surfacing, and the flag audit

TIER 2 — contained. Two independent tracks, no schema, no migration.
Branch: staging. Commit only. NEVER push — Gary pushes.

PRECONDITION: R7-E is promoted (`817b3ef`, stamped `57e7764`) and both
branches are level. Verify; do not assume.

## WHY THESE ARE ONE SESSION

They are the same defect shape in two places: a surface says one thing
while the machinery says another, and nothing reconciles them.

  The hours dialog says "saved" while the engine silently discards the
  row and infers a window from sales instead.

  A blocker's prose says "CLEARED" while the board counts it live,
  because the board reads only the `resolved:` flag.

Neither is dramatic. Both make Gary distrust a number with no signal
anywhere explaining why. Track A and Track B are independent — if one
fails, the other still ships. Separate commits.

---

# TRACK A — the store hours sweep and the surfacing

## A1 · The deployed sweep

`scripts/sweep-store-hours.ts` exists and takes a Neon console JSON
export. Ten of twelve stores have never been swept. Two have:
production Las Brisas and UNR were checked 2026-08-23 and every row was
admitted.

CREDENTIAL RULE STANDS. `vercel env pull` is banned for every
environment; read-only is not an exception. HAND GARY THE SQL for the
Neon console. Do not reach for a deployed credential.

Give him one query returning every `StoreHours` row with its store name,
and tell him to paste the `ep-` endpoint host back with the result —
`current_database()` returns `neondb` on every branch and proves
nothing. Production is `ep-green-smoke`.

When the export arrives, run the sweep and report a table:

  store · day · open · close · validator verdict · **ENGINE VERDICT**

The engine verdict is the point and it is a DIFFERENT PREDICATE from the
validator's. Key it to `labor-plan.ts:273` — the `e > s` test — using
the engine's own parsers, not a reimplementation. A row that fails it is
discarded and that store is running on sales inference.

Known-discarded shapes, so they are recognised rather than rediscovered:
`08:00–08:00` (zero-length), any overnight window, and a `00:00` close
BEFORE the R7-E parse fix. Note that the `00:00` fix shipped in
`817b3ef`, so midnight closes are now admitted — a row that was being
discarded last week may be live now.

DO NOT FIX DATA. A wrong row is Gary's to correct in the UI.

## A2 · The surfacing — this is the actual build

Today a discarded row is invisible at every layer. The dialog shows
hours, the store card shows hours, and the engine uses something else.
Nothing anywhere says so.

Build a visible signal, keyed to the ENGINE's admission rule:

  - On the store card and/or the hours dialog, where the hours are
    shown. A store whose rows the engine will not read must say so
    plainly — something in the shape of "these hours are not being used;
    coverage is inferred from sales." Exact wording is Gary's call:
    PROPOSE IT, DO NOT SHIP COPY HE HAS NOT SEEN.
  - Reuse the engine's predicate. Do not reimplement `e > s` in the
    component — that divergence is BUG-11/BUG-12's whole lesson and it
    is why `store-hours-validate.ts` is shared by both call sites.

DO NOT solve this by warning on overnight in the validator. Ruled
2026-08-23: that contradicts the dialog's own promise while leaving the
engine still ignoring the row — a worse state than today, because the
operator would be told their hours are questionable rather than unused.

Fixture first, shown failing. Extend `verify-store-hours.ts` or add a
sibling; assert the engine-admission predicate directly against
`labor-plan.ts`'s parsers so a future change to them breaks this test.

## A3 · BUG-14's row

Update per the house pattern — appended, never rewritten. If the sweep
comes back clean at all twelve stores, say so; that is a real result and
the row can then close on the surfacing alone. If it does not, the
findings go on the row and BUG-14 stays `in_progress`.

---

# TRACK B — the resolved-flag audit

## B1 · The finding, restated so it is not re-derived

Two conventions ran at once. PERM-6's older convention closes a blocker
by PREPENDING a note above it. P-4 (2026-08-01) added `resolved: true`
for exactly this purpose. **`ROADMAP.yaml`'s own header says only the
flag is read.**

So a blocker cleared in prose but never flagged shows as LIVE on
`/internal/roadmap`. R7-C carried one for a day. Three entries were
flagged tonight in `af407b3`.

**The question this session answers: how many others are there?**

## B2 · The audit

Sweep every blocker entry in `docs/ROADMAP.yaml` and report:

  1. Total blocker entries, and how many carry `resolved:`.
  2. Every entry whose PROSE indicates it is closed — "CLEARED",
     "RESOLVED", "CLOSED", "no longer", "fixed by", a SHA, a date
     followed by a closing verb — but which carries NO flag. These are
     the over-counted ones.
  3. The inverse, which matters more: any entry FLAGGED resolved whose
     prose does not support it. A blocker wrongly marked closed is
     invisible, and that is worse than one wrongly shown live.
  4. Which rows are affected and by how many.

Report as a table with row id, entry number, and the prose fragment that
triggered the classification. **Prose matching is a HEURISTIC — say so.
Every hit is a candidate for Gary, not a verdict.**

## B3 · What to fix, and what not to

FLAG the unambiguous ones — an entry that literally opens "CLEARED
<date>" is not a judgment call. Re-indenting a folded block to add the
flag MUST preserve the prose byte-for-byte: parse with the generator's
own parser before and after, diff the RENDERED strings, and report the
md5 on both sides. That is how `af407b3` proved it.

DO NOT FLAG anything ambiguous. List it for Gary's ruling instead. A
blocker is a safety device; silencing one on a guess is the failure mode
here.

DO NOT touch category 3 at all — an entry flagged resolved whose prose
disagrees is a RULING, not a fix.

## B4 · Stop it recurring

Propose ONE mechanism, cheapest first, and do not build it without
Gary's word:

  - a `grep` gate in the promotion checklist, in the shape of DEBT-72's
  - a check in the roadmap generator that warns when prose says cleared
    and the flag is absent
  - a line in `ROADMAP.yaml`'s header stating the flag is mandatory and
    the prepend convention is retired

State which you would pick and why. Gary dislikes ceremony; the cheapest
thing that actually fires is better than the most thorough thing that
needs remembering.

---

## HOUSE RULES

Additive only. No schema, no migration, no drops. Preserve-and-mark —
nothing is deleted from the ROADMAP; corrections prepend with dates.
Two-commit pattern per track: work commit, then the recorder with the
SHA. Gate per commit: scoped `npx eslint` on touched source files, then
bare `npm run build`. No bare `npm run lint` (DEBT-33).

ROADMAP edits: `cp` a backup first, edit by line number, then
`diff | grep -c "^<"` to prove nothing was clobbered. When editing by
line number, edit the HIGHER line first — lower edits shift the targets
below them.

No `&&` chains in anything handed to Gary. Fixed sequences go in ONE
parenthesised subshell with `|| echo "*** NO MATCH ***"` guards and
`|| { echo "*** CD FAILED ***"; exit 1; }` on the opening `cd`.

When a gate returns the expected number, confirm no error line printed
above it — a failed command piped into `grep -c` returns 0, which looks
like a pass.

Row ids come from `ROADMAP.yaml`'s next free. S5-D numbers are
DEVIATIONS, not row ids, and they run past S5-D68.

STOP AND REPORT between Track A and Track B. Never push.

Triage per track: FIX NOW / RULING NOW / COMMENT / ROW. Default to the
first three. Report the count in each bucket.
