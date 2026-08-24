Write the Phase 3 promotion. Do ALL the document work yourself — I do not
want to hand-edit anything. Commit it, then hand me ONE paste box.

## 1 · THE DEPLOY_LOG ENTRY — write it, splice it, commit it

New entry at the top of docs/DEPLOY_LOG.md, heading in the current
format `## <sha> — <date> — <title>`, with a machine-stampable merge-SHA
placeholder exactly as the R7-D entry used. Build it as a pasteable
heredoc in short chunks with wc -l and grep -c "^## " splice checks.
Never hand-edit the file. Do not touch any entry above it.

The entry carries, in this order:

**WHAT SHIPPED.** headcount is hourly heads only; suggestedHours reads
the day's credited hours via the new pure suggestedHoursForDay.
points[].gm untouched — the band still draws. Peak is now the hourly
peak (pinned by fixture §11, not by the capture — say which). The six
approved copy strings. The parseHourEnd("00:00") -> 24 fix, which
deviates from R7-E's own zero-diff rule for labor-plan.ts on purpose and
is recorded as a deviation, not done quietly.

**THE CAPTURE, AS THE CENTREPIECE — measured BEFORE the merge:**

    store         B    Suggested before -> after    ΔWEEK
    Las Brisas    46   282.0 -> 256.0               −26
    UNR           38   117.0 -> 99.0                −18
    no-band store  0   31 -> 31                      0  (byte-identical)

Confirmed by two independent paths: the admission checker over the typed
production rows, and the two-version capture. All 14 production rows
admitted, 0 discarded. Computed per day — neither store has a uniform
week (Las Brisas Sun 5h / Mon–Fri 7h / Sat 6h; UNR Sat+Sun 4h /
Mon–Fri 6h).

**WHY THE DELTA IS TRUSTWORTHY EVEN THOUGH THE LEVELS ARE CONSTRUCTED.**
Δ = K − G reads nothing on the hourly side. The capture asserts hourly
heads, points[].gm, usedHourlyHours, understaffedBudget and
supervisorGap byte-identical between versions on every day. Only the
absolute levels depend on the constructed demand shape; the deltas do
not. So −26 and −18 will hold on production even where the levels differ.

**WHAT MANAGERS WILL SEE, AND WHAT DID NOT MOVE — its own heading.**
Suggested falls ~9% at Las Brisas and ~15% at UNR. State plainly:
RECOMMENDED HOURLY STAFFING DOES NOT CHANGE. No dollars move, no hourly
pool changes, no persisted figure moves. What fell is the figure that
was crediting the manager for hours she was never covering — the drawn
band ran 46 and 38 hours a week against a credited 20. A smaller
Suggested does NOT mean fewer people are allowed, and if it is read that
way the ruling has been inverted.

**WHAT THE PRE-REGISTRATION GOT RIGHT AND WRONG.** Pre-registered at
08c2e6e as −29 and −22; actual −26 and −18. The box, ΣK = min(B,C),
C = 20, the ten-store no-op and every falsifier held. What failed was
assumption 2's opening times — true Mon–Fri only. The misses are exactly
the weekend days: 3h at Las Brisas, 4h at UNR. Also record that
assumption 1 SURVIVED and the earlier "5 open days" note taken from dev
was itself wrong — both stores open 7 days.

**S5-D10's SECOND CASE IS MEASURED NOT-LIVE.** B of 46 and 38 against
C = 20, nowhere near the boundary. Real as a mechanism, not firing today.

**ROLLBACK.** git revert -m 1 <merge sha>. No schema, no migration.
Reverting restores the manager being counted as a whole body in
headcount and Suggested.

**POST-DEPLOY CHECK.** /labor at Las Brisas and UNR: band draws
unchanged, Suggested lower by roughly the stated amounts, hourly heads
and the floor warnings UNCHANGED from this morning. A no-band store
(Carson, Sparks) identical. If hourly heads moved anywhere, that is a
STOP and a revert.

**KNOWN OPEN AT PROMOTION.** Read the ROADMAP for this — do not copy a
list forward blindly. At minimum: BUG-14's deployed sweep and the
surfacing work (ten stores unswept); CUTOFF-1; DEBT-83 closing with L-4;
BUG-13.

## 2 · THE ROADMAP — do every flip yourself

Fold ALL row updates into the stamp step of the promotion box so the
board and the DEPLOY_LOG land in the same commit. That is DEBT-72's
requirement and it has already fired once today.

- **R7-E -> shipped**, commits += the merge SHA. Its stated reason for
  being in_progress was the missing capture; the capture is done and the
  row already says so.
- **BUG-14 stays in_progress.** The deployed sweep and the surfacing
  work are outstanding. Add the merge SHA to its commits only.
- **R7-C's blocker at ROADMAP.yaml:8212** — clearing condition is "L-4
  lands, or Gary rules that the double-drawn band is acceptable and it
  is labelled on the coverage surface." READ IT AT HEAD AND REPORT
  WHETHER IT NOW CLEARS. My read: the manager-on-floor ruling is
  STRONGER than that clause — the band is not merely labelled, it no
  longer feeds any number. DO NOT FLIP R7-C. Report and wait for my
  ruling. If it clears, R7 closes and that deserves my words.

## 3 · THE PROMOTION — one paste box, same shape as R7-D's

That box worked; reuse its structure exactly:
- preflight aborts BEFORE any write: clean tree, on staging,
  origin/staging not ahead, prior main tip is the expected SHA
- payload listed with a count
- rollback tag at the prior main tip before the merge
- --no-ff merge (--ff-only is banned)
- stamp-and-flip as ONE python step with exact-match assertions, so a
  missing anchor exits having written nothing rather than half-stamping
- verification greps after: zero PENDING tokens, the stamped heading,
  each flipped row
- npm run build gate, then the stamp commit
- STOP BEFORE THE PUSH, print the rollback tag

Push lines printed for me afterwards must be separate parenthesised
subshells, NOT && chains — the R7-D box printed an && chain and I had to
be handed a corrected version.

## HOUSE RULES
Additive only. Preserve-and-mark. No schema, no migration. Scoped npx
eslint then bare npm run build (no bare npm run lint — DEBT-33).
Never push. Triage: FIX NOW / RULING NOW / COMMENT / ROW, report counts.
