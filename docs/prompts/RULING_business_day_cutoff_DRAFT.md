# DRAFT — Business day cutoff: the model is ruled, the build is deferred

**FOR GARY TO EDIT INTO HIS OWN WORDS BEFORE IT IS RATIFIED.** A ruling is
only official once it is in `docs/DECISIONS.md` in Gary's voice. Change the
wording freely — the substance is what was agreed 2026-08-23, the phrasing
is Claude's and should not survive unedited.

---

## Overnight hours are a business day cutoff, and the model is ruled now — 2026-08-23 (Gary)

Gary's ruling, in his words:

- **Overnight hours are supported.** The hours dialog already promises a
  store closing after midnight is fine, and I am not going back on that. A
  row an operator saves is a row the engine uses.

- **The way you do this is a business day cutoff, not a wider clock.**
  Every business I have run has one. A bar that closes at 2am sets its
  close of business at 3am, and everything before 3am belongs to the day
  before. It is a per-store setting, it defaults to midnight, and the
  operating window is expressed relative to it. That is the model.

- **Froot's cutoff must agree with Square's, or it does not ship.** My
  sales come from Square and I reconcile against Square. If Froot decides
  Friday runs to 3am and Square reports that 1am sale on Saturday, my
  labor percentage is computed on one day against sales from another, and
  nobody would ever catch it. Find out what Square does first. If Square
  has a cutoff, Froot mirrors it and nobody types a different number.

- **A close at midnight is not overnight.** 18:00 to 00:00 is a normal day
  that ends at 24:00. The engine reading that as hour zero and throwing
  the row away is a plain bug and it gets fixed now, on its own.

- **Nothing is discarded silently.** Until true overnight works, if the
  engine will not read a store's hours, the operator has to be able to see
  that on screen. A row that saves, displays, and drives nothing is worse
  than a row that was rejected.

- **Build it when a store needs it.** None of my locations cross midnight
  today. I am ruling the model so nobody solves this a different way in
  six months, but I am not paying for a cutoff across sales, goals and
  labor for a case I do not have. The row waits for a real store.

---

**WHY THIS IS RULED BEFORE IT IS BUILT, WHICH IS THE OPPOSITE OF THIS
PROJECT'S USUAL ORDER.** The R7 sequence is the argument: `LaborPositionStoreHours`
and `weeklyHoursOverride` were both storage built ahead of a ruling, and both
were re-shaped by the consumer when it arrived. Here the consumer does not
exist yet and the shape is known, so the cheap move is the reverse — fix the
model in writing, build nothing, and let the row wait. (Claude)

**WHAT THE ENGINE ACTUALLY DOES TODAY, MEASURED.** `labor-plan.ts:272`
admits a stored window only when `e > s`. `parseHourStart("22:00")` is 22 and
`parseHourEnd("02:00")` is 2, so every overnight row fails and falls through
to sales inference. `parseHourEnd("00:00")` is 0, so an ordinary midnight
close fails too. The row saves, the dialog displays it, and the engine runs
on a window nobody typed. (Claude)

**THREE PARTS OF THE SYSTEM DISAGREED ABOUT ONE ROW, AND IT IS WORTH NAMING
WHY.** The dialog promises overnight works. The write route declines to
order-check *because* of that promise. The BUG-14 validator asserts overnight
is clean on both lists — explicitly, because the spec required it. The engine
discards it. The validator is not wrong; its silence means something narrower
than it looks. **"Clean" means the editor accepts the row, not that the engine
uses it, and those were assumed to be the same predicate when the rule set was
written.** They are not, and the next person writing a validation rule needs
to know that. (Claude)

**DO NOT RESOLVE THIS BY WARNING ON OVERNIGHT.** That contradicts the
dialog's promise while leaving the engine still ignoring the row — a worse
state than today, because the operator would then be told their hours are
questionable rather than told they are unused. (Claude)

**THE CUTOFF IS NOT A DISPLAY SETTING.** It redefines what "a day" means
across everything keyed by date: `SalesHourlyCache`, `DailyGoal`, the
forecast, `LaborDaySplit`, and the whole labor plan. That is why the build is
TIER 3 with an audit first, and why the Square question is the audit's opening
task rather than a detail inside it. (Claude)

---

## What ships now, and what does not

**NOW — small, no cutoff, no model change:**
- The `00:00` parse fix. `parseHourEnd("00:00")` must yield 24, not 0. One
  line, rides Phase 3.
- The surfacing work on BUG-14, keyed to the ENGINE's admission rule and not
  the editor's — they are different predicates. First task on that row.

**DEFERRED — its own row, TIER 3, waits for a store that crosses midnight:**
- The business day cutoff itself, per store, defaulting to midnight.
- The audit that must precede it. **Opening question: does Square expose a
  business-day cutoff, and what does it use to attribute a 1am sale?** If
  Square owns it, Froot mirrors it and never accepts a divergent value. If
  Square does not, Froot owns it and that is a larger decision than this
  ruling settles.
- Overnight support in the coverage engine, whose points array is
  `for (let h = 0; h < 24; h++)` — one calendar day, with nowhere to put the
  hours that belong to the next.

**NOT RULED HERE:** what the cutoff defaults to for a store that has one, how
a cutoff interacts with the week boundary, or whether `SalesHourlyCache` is
re-keyed or offset at read. All of that is the audit's.
