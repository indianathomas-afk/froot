# Session — three phases: the ruling, hours validation, manager on the floor

Branch: staging. Commit only. NEVER push — Gary pushes.
Three phases, three separate commits (plus recorders per the house
two-commit pattern). HARD STOP and report between each phase.

## PRECONDITIONS

**Phases 1 and 2 have none.** They move no numbers and do not wait.

**Phase 3 requires R7-D (`1e7286b`, `6911469`) promoted and pushed, with
staging level with main.** Verify; do not assume. If it is not, run
Phases 1 and 2, then STOP before Phase 3 and say so — Phase 3's blast
radius must not ride R7-D's un-promoted DEPLOY_LOG entry.

Also commit the untracked files in `docs/prompts/` so this session's own
inputs are in git.

## WHY THESE ARE ONE SESSION

They are three small changes Gary would otherwise sit through
separately. Commit hygiene does not relax: each phase gets its own
commit and its own gate. If Phase 1 goes wrong, Phase 3 does not start.
Phases 1 and 2 are independent of each other. Phase 3 depends on Phase 1.

---

# PHASE 1 — Record the ruling

Read `docs/prompts/RULING_manager_on_floor_DRAFT.md` for the annotations
and the arithmetic. It is a draft in Claude's voice — **its `(Gary)`
bullets are superseded by the ruling at the bottom of this file**, which
Gary has approved as his own.

Do:
- Insert the entry into `docs/DECISIONS.md` per the house pattern —
  newest at top, Gary's words marked `(Gary)`, your annotations marked
  `(Claude)`. Carry across the draft's `(Claude)` annotations where they
  still hold; drop any the final wording contradicts, and say which.
- Preserve-and-mark: nothing existing is edited or deleted.
- Update DEBT-83: closing condition becomes L-4, plus the note that
  CONFIGURING the window makes the band WIDER — 6:30–3:30 goes through
  `Math.ceil(930/60) = 16` at `labor-plan.ts:284`, so a 7am store's band
  goes from 7 hours a day to 9.
- Record Southgate's configured window (465->900) as inert — no
  allocation, `hasGm` false, drives nothing. On the DEBT-83 row or at the
  site, whichever the house pattern prefers. **Not a new row.**
- Keep the draft file as-is. It is the provenance record.

ROADMAP edits: `cp` a backup first, edit by line number, then
`diff | grep -c "^<"` to prove nothing was clobbered, then
`npm run build`. Predicted line counts are orientation, not a gate.

Gate: bare `npm run build`. Commit. **STOP AND REPORT.**

---

# PHASE 2 — Store hours validation

Execute `docs/prompts/STORE_HOURS_VALIDATION.md` in full. It is
self-contained; do not restate or reinterpret it here. Ignore its own
R7-D precondition — superseded by this file's.

Fixture first, shown failing. Report the read-only sweep as a table with
the branch named in the same output. **Do not fix hours data** — a wrong
row is Gary's to correct in the UI, which is also the first live test of
the editor's new behaviour.

Gate per that prompt. Commit. **STOP AND REPORT.**

---

# PHASE 3 — Manager on the floor

**Gated on R7-D being pushed. If it is not, stop here and report.**

Execute `docs/prompts/MANAGER_ON_FLOOR_BUILD.md` in full. It is
self-contained; do not restate or reinterpret it here. Its ruling
precondition is satisfied by Phase 1 — verify the entry landed in
`DECISIONS.md` rather than assuming Phase 1 succeeded.

Two things that prompt requires and that are easy to skip:
- **Predict the per-store weekly Suggested delta IN WRITING before you
  capture it**, then verify against your own prediction. Suggested will
  drop hard at Las Brisas and UNR. A number that moves onto a written
  prediction is a fix; one that moves without a prediction reads as a
  regression.
- **Propose the band's new copy. Do not ship wording Gary has not seen.**

Gate per that prompt. Commit. **STOP AND REPORT.**

---

# AT THE END — the promotion, consolidated

Hand Gary the promotion ritual as CONSOLIDATED PASTE BOXES, not one
command per box. Fixed-sequence commands with no branching go in ONE
parenthesised subshell. Commands whose result decides the next step stay
alone. Guard anything that can return empty with
`|| echo "*** NO MATCH ***"`, and the opening `cd` with
`|| { echo "*** CD FAILED ***"; exit 1; }`.

`--no-ff` only. `--ff-only` is banned. **Fold any ROADMAP status flips
into the SHA-stamp box** so the board and the DEPLOY_LOG cannot land out
of step — that gap is DEBT-72 and it has already fired once.

STOP BEFORE THE PUSH.

DEPLOY_LOG: **one entry covering the phases that ran**, not one each.
Scale the ceremony to the blast radius — Phase 3 moves a visible number
and needs the full treatment; Phases 1 and 2 do not. Build it as a
pasteable heredoc in short chunks with `wc -l` and `grep -c "^## "`
splice checks. SHA auto-stamped, never hand-typed; leave a
machine-stampable placeholder for the merge SHA.

Note whether `scripts/promote.sh` is still unbuilt. Do not build it here.

---

# HOUSE RULES — all phases

Additive only. No schema, no migration, no drops. Preserve-and-mark.
Gate per commit: scoped `npx eslint` on touched source files, then bare
`npm run build`. No bare `npm run lint` (DEBT-33). No `&&` chains in
anything handed to Gary. Row ids come from `ROADMAP.yaml`'s next free —
S5-D numbers are DEVIATIONS, not row ids, and they run past S5-D65.
Never push.

When a gate returns the expected number, confirm no error line printed
above it — a failed command piped into `grep -c` returns 0, which looks
like a pass.

Triage everything found and not fixed, per phase: FIX NOW / RULING NOW /
COMMENT / ROW. Default to the first three. Report the count in each
bucket.

---

# GARY'S RULING — VERBATIM

## Manager on the floor — one guaranteed number — 2026-08-23 (Gary)

Gary's ruling, in his words:

- **Call it the manager on the floor.** "GM on-floor window" is jargon
  and it is wrong besides — Kristie is a store manager, not only a
  general manager. Rename it everywhere it shows on screen. The column
  names stay as they are; this is a label change, not a migration.

- **The manager's hours are guaranteed, and whatever is left spreads
  across the other shifts based on what the business needs.** That is
  how I run the stores and it is what floor-first already does. The
  guaranteed number is the manager's credited hours at that store — 20 a
  week at Las Brisas and 20 at UNR, off her allocation, never typed by
  hand.

- **The window says when the manager is expected on the floor. It does
  not say how much of the floor she covers.** Every number that claims
  coverage uses the credited hours instead. The band can stay on the
  chart as a reminder of when she is expected; it stops feeding any
  number.

- **Leave the setting where it is for now.** Shift blocks and the
  manager window describe the same hours from two directions and one day
  they should be one thing. Not today — shift blocks only drive the
  supervisor rule right now, and moving a live setting into one that
  barely does anything buys me nothing. Revisit when L-4 lands.

- **Do not fix DEBT-83 by setting the window.** If I enter my real hours
  the band gets wider, not narrower. Leave the default alone, write down
  why, and close it with L-4.

---

# ASSUMPTIONS BEHIND THE ARITHMETIC — correct these if wrong

The ruling's "20 credited is within an hour of real" claim rests on
these. If any is wrong, the number in the annotation moves and Claude
should be told before Phase 3's prediction is written.

1. Kristie works **five days a week**, 6:30am–3:30pm with an hour's
   lunch — about 8 floor hours a day, ~40 a week.
2. The 50/50 split is by **whole days** — roughly 2.5 days at each
   store — not a morning at one and an afternoon at the other.
3. She works **the same shift at both stores**, notwithstanding that
   UNR opens at 08:00 and Las Brisas at 07:00.
4. The 50/50 is her **actual** split, not a nominal one for payroll.

If 1–4 hold, credited 20 at each store is within an hour of her real
coverable presence and the ruling's reasoning stands as written.
