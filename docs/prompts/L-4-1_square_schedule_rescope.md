TIER 3 session (rescoping only — no code, no schema, no migration). Read /Users/garythomas/Claude_Projects/Froot/froot/docs/prompts/L-4-1_square_schedule_rescope.md and execute it. Repo gate first, one command at a time. Stop where it says stop.

# L-4-1 — Rescope L-4: Square is the schedule — TIER 3

## Why this session exists

L-4-0 (2026-10-30) scoped L-4 as a Froot-only scheduler. L-4a then built its
empty `LaborAssignment` table. Before L-4b built the scheduler screen, Gary
looked at how Keva actually works. Every store's managers already schedule
everyone in Square, including salaried managers, with job titles and time off.
A second scheduler in Froot would mean entering every shift twice.

Gary's position (2026-10-30, in chat; ratify in this session):
- **Square is the source of truth for the schedule.**
- A merchant who doesn't schedule in Square may someday need a Froot-native
  scheduler. That is a possibility to plan for, not to build now.

This session changes no code. It re-reads what exists and re-scopes L-4.
Plan-first, hard stops, one docs commit at the end.

## The real-world case that tests the design

Kristie, a salaried manager, now floats between stores in a partly regional
role. In Froot's salaried allocation she is set to:
- 10% Las Brisas;
- 10% UNR;
- 80% "Cafe De Cafe".

The 80% is there so she doesn't count as floor coverage at the real stores,
which keeps Las Brisas and UNR properly staffed. Gary's words: it is
"essentially wiping out her effect on labor."

This mixes two different things that Froot currently treats as one:
1. **Cost:** whose budget pays her salary. That is the allocation's job.
2. **Presence:** which store she is physically at on a given day. Square's
   schedule knows this. The allocation can't.

Phase A must establish what the 10% / 10% / 80% setup actually does today.

## Repo gate (one command at a time, paste results)

```
pwd
```
→ must end in `Froot/froot`. If it ends in capital-F `Froot`, run
`cd /Users/garythomas/Claude_Projects/Froot/froot` and run `pwd` again.
Anything else: STOP.

```
git status
```
→ on `staging`, tree clean except this prompt file (untracked is expected).
If an uncommitted L-4b prompt file is present, report it and leave it alone.

```
git log --oneline -1
```
→ expect `45fcf5f`. If different, say so before continuing.

## Phase A — read (read-only; report with file:line)

The file wins over this prompt. Say so where they disagree. No production
database reads. Use code, plus dev reads with the branch column, per CLAUDE.md.

A1. **What the allocation does today.** In `labor-plan.ts`, `labor-coverage.ts`,
    `labor-salaried.ts` (or wherever salaried allocation is read), trace a
    salaried person allocated 10% to a store. Report, with file:line:
    - Does the manager band draw at that store? (L-4-0 found
      `hasGm = salaried.hasSalariedPerson`, labor-plan.ts:262.)
    - Does `gmHoursByDay` credit her floor hours at that store? Are they the
      full window or scaled by the 10%?
    - Does the GM 40-hr cap see her?
    - What reaches the budget/cost side: the 10%, or something else?
    Answer in plain English first, then the cites. The key question: **at 10%,
    does Froot think a manager is on the floor 7–2 every day at Las Brisas and
    UNR, and plan fewer crew hours because of it?** If yes, that is the most
    important finding of this session. Say so at the top of the report.
A2. **"Cafe De Cafe".** What is it in Froot: a real store row, labor-enabled or
    not, linked to a Square location or not? What does an 80% allocation to it
    do to its own plan and budget? Read code and dev data only.
A3. **What Square schedule data Froot already has.** `SquareScheduledShift`
    (schema.prisma:3619), the `/api/cron/labor-scheduled-shifts` sync, and
    `labor-schedule.ts` (`ShiftDetails`, `ScheduledShiftPayload`,
    `EffectiveShift`). Report:
    - which fields are stored: team member, Square location, start/end,
      job id/title, draft vs published;
    - how a Square location maps to a Froot store;
    - how far ahead and how often it syncs;
    - how a salaried person's Square team member id joins to
      `LaborSalariedPerson`;
    - where Square-scheduled shifts are displayed today.
A4. **Time off.** Does the installed Square SDK (check `node_modules` types, not
    memory) expose time-off / availability records through an endpoint
    Froot's existing read scopes cover? Report what you find. If unclear, say
    unclear. Do not guess.
A5. **Boundary.** Quote the L-2 boundary ruling and its seam (b) amendment
    (DECISIONS.md:4264-4272) verbatim. State plainly whether "a Square
    scheduled shift decides whether the manager band draws at a store on a
    day" crosses it. Do this for two cases:
    - (i) band only, display-only;
    - (ii) the band and the floor credit in `gmHoursByDay`.
A6. **What L-4a left behind.** `LaborAssignment` (empty) and its CHECK. Confirm
    nothing in `src/` reads or writes it (L-4a D5 found zero hits). Confirm any
    L-4b prompt file's status (committed or not).

## Phase B — plan (then HARD STOP)

B1. **RULING NOW items**, one sentence each, with your lean and a draft wording.
    At minimum:
    1. **Schedule source.** Square is the schedule source of truth for an org
       that schedules in Square. Froot never holds a second, competing schedule
       for that org.
    2. **Froot-native scheduler.** It is deferred until a real customer that
       doesn't schedule in Square needs it. When it comes, it is a per-org
       setting: one source per org, never both. `LaborAssignment` stays in
       place, unused, as its future storage. Nothing is dropped.
    3. **L-4b.** Paused: not cancelled, not built.
    4. **Cost vs. presence.** Salaried allocation decides cost only. Where a
       person is on a day comes from the schedule.
    5. **L-4d redefined.** The manager band draws at a store on a day only when
       the Square schedule has that salaried person there that day. With no
       Square schedule data for her that week, it behaves as today. Whether this
       is display-only (A5 case i) or also moves the floor credit (case ii)
       follows from A5. My lean: display-only in L-4. Moving the floor credit
       stays with L-5, and needs its own boundary ruling.
    6. **L-5 revised.** Rewrite its scope from "assignments feed core" to
       "Square schedule presence feeds the floor credit and GM cap." Keep it
       `planned` and `BEHIND L-4`. State that it needs an L-2 boundary
       amendment before it can be built.
    7. Anything else A1–A6 surfaced, especially an A1 overcredit finding:
       FIX NOW is not allowed here (no code). Propose how it gets fixed, and
       whether it jumps the queue.
B2. **Row corrections.** Exact preserve-and-mark YAML, prepended and dated
    2026-10-30, for:
    - **L-4:** the new title, with the old title kept in notes; the
      Square-as-source pivot; L-4b paused; the L-4d redefinition. Status: work
      exists (L-4a's table is on staging), so keep the status the file's
      convention gives and say which.
    - **L-5:** the revised scope.
    Confirm the "L-4 IS NOT SHIPPED UNTIL L-4d SHIPS" guard. It was in the
    unrun L-4b prompt, so it may not be on the row. Add it if missing.
B3. **What's left to build.** The remaining L-4 work as one ordered list (likely
    just L-4d, plus L-4c only if breaks still make sense with Square as source).
    Give tier and size for each.
B4. Classify every out-of-scope finding FIX NOW / RULING NOW / COMMENT / ROW.

### ═══ HARD STOP ═══
Print A1's plain-English answer first, then B1–B4. For each ruling:
"Ratify as written, or give me your wording." Write nothing until Gary
replies. Record his reply verbatim.

## Phase C — write (only after Gary's go)

C1. Prepend the approved corrections to the L-4 and L-5 rows in
    `docs/ROADMAP.yaml`. No `meta.updated` key.
C2. Add Gary's ratified rulings to `docs/DECISIONS.md`, in his words verbatim,
    as one dated entry at the top. Note that L-4-1 supersedes L-4-0 rulings
    where they conflict, and name each one it supersedes. Don't edit the
    L-4-0 entry.
C3. `docs/LABOR.md` § "L-4 · Assignment layer": prepend a dated pivot block:
    - the A1 findings with cites;
    - the cost-vs-presence split;
    - the new L-4d definition.
    Keep the L-4-0 and L-4a design text below it, marked superseded where it no
    longer applies.
C4. Placeholder count before and after. It must not rise:
    `grep -c '__' docs/ROADMAP.yaml`
C5. Run `npm run build`. It must pass with no error lines.
C6. Stage only the files you touched plus this prompt (no `git add -A`). One
    docs commit:
    `docs(L-4-1): Square is the schedule source; L-4b paused; L-4d and L-5 rescoped`
C7. `git status` shows a clean tree.

## Report and stop

Report:
- the commit SHA and files changed;
- A1's plain-English answer;
- rulings ratified vs. open;
- the remaining L-4 build list.

Do NOT push. Do NOT start L-4d. Next is Gary's PRE-PUSH-CHECK.
