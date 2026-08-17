# Session prompt — Roadmap visibility for HR-11m, HR-11n, HR-11k

**TIER 1 — cosmetic / docs only.** No `src/` changes, no schema, no behavior.
Proceed without ceremony; report what you changed.

**Save to:** `docs/prompts/2026-08-15-roadmap-visibility.md`

---

## Precondition

`HEAD` on `staging` matches `origin/staging`, and the deployed staging SHA
matches `HEAD`. Commits `eab6254` and `7ee53f5` must already be pushed — the
roadmap page renders from `src/generated/roadmap.ts`, which `prebuild`
regenerates on deploy, so unpushed rows are invisible at
`/internal/roadmap` regardless of what this session does.

If they are not pushed, stop and say so. There is nothing useful to do first.

---

## Why this session exists

Three rows now describe what is next, and I need to read them at
`/internal/roadmap` without opening the YAML:

- **HR-11m** — Signature checkpoint duplication fix. Verified, recording
  `974bf49`.
- **HR-11n** — orphaned Signature checkpoints have no removal path. Planned.
- **HR-11k** — R2, two upload paths. Planned.

The concern is legibility, not correctness. HR-11j and HR-11m are long rows
written for evidentiary completeness, and the two planned rows need to read as
"here is the next piece of work" to someone scanning the page.

---

## Scope

1. **Verify the three rows render.** Load the generated roadmap and confirm
   HR-11m, HR-11n and HR-11k all appear with the intended status
   (`verified`, `planned`, `planned`). Report the phase count.

2. **Check the ordering.** The HR-11 family is not in alphabetical or
   chronological order in the file (HR-11j sits before HR-11i and HR-11h).
   Report how the page sorts and whether the three rows above land somewhere a
   reader would find them. Do not reorder the file without telling me first —
   `ROADMAP.yaml` is append-only and I want to rule on any move.

3. **Legibility pass on the two planned rows only.** HR-11n and HR-11k should
   each open with a plain-English sentence stating what the work is and why it
   matters, before the evidence and the detail. If they already do, change
   nothing and say so. If they open with measurement tables or internal
   references, add a lead sentence — **prepend, never rewrite**, per
   preserve-and-mark.

4. **Report anything that reads as stale** on those three rows — a reference to
   a file that moved, a SHA that doesn't resolve, a status that contradicts the
   notes. Report only; do not fix without asking.

Leave HR-11j and every other row alone.

---

## Constraints

- Docs only. If you find yourself editing anything under `src/`, stop.
- `ROADMAP.yaml` is append-only. Corrections prepend with dates; nothing is
  deleted or rewritten in place.
- No `&&` chains. One command at a time.
- Commits stay on `staging`. Commit only — never push.
- The generator must parse the file after any edit; run it and report the phase
  count.

---

## Out of scope

- Building HR-11n or HR-11k.
- Reordering rows (report only — I rule on it).
- Any change to HR-11j or to rows outside the HR-11 family.
