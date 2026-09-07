# Unassign training — remove a single assignment from a staff member

**Written:** 2026-09-07. Short-form session. No audit phase, no stop gate.

## PREFLIGHT — one command at a time, no `&&` chains

1. `froot`, then `pwd`. Must print the lowercase `froot` git root.
2. `git status` — tree clean. Stop and tell Gary if anything untracked is
   present.
3. No pushes. Commits only.

## THE CHANGE

A manager can remove a training assignment from one staff member, from that
person's training list on their staff record. Single assignment, one at a time.

**The rule (Gary, 2026-09-07): refuse if there's progress, allow if untouched.**
An assignment nobody has started can be removed. One with any progress or a
completion against it cannot — the completion is proof the person did the
training and must not be erasable by a stray click.

The refusal is a plain sentence explaining why, not a disabled control with no
explanation and not a generic error.

## FIRST: CHECK WHETHER THIS IS ALREADY BUILT

`DELETE /api/hr/training/assignments/[id]` exists, and planning believes it
**already refuses once progress exists** — which is exactly the ruling above.

Check that at HEAD before writing anything. Two outcomes:

- **It already enforces the rule** → this session is UI only. Surface the
  action, wire it to the existing route, render the refusal. No route change.
  Say so in the report.
- **It doesn't, or it refuses differently** → report the actual behaviour and
  make the route match the ruling. Do not silently widen what it accepts.

Either way, report which branch you took.

## SCOPE

**In:** the unassign action on the staff member's training list, its confirm,
the refusal message, and whatever minimum the route needs to match the ruling.

**Out — do not touch:** bulk assign (route or dialog), the bulk write path,
`RECIPIENT_SELECT`, the compliance rollup in `hr-compliance.ts`, HR-13
semantics, and the guards on any route. **No bulk unassign** — not built, not
scaffolded, not half-wired. If it's wanted later it's its own row.

## DONE

Scoped eslint clean → green `npm run build` → work commit → docs commit citing
the work SHA. Report both SHAs, the unpushed count, which branch the check
above took, and the refusal message as actually rendered.

Docs commit: ROADMAP row under the next free id, `status: in_progress` at the
work SHA. Short DEPLOY_LOG entry — this is small. This prompt file rides the
docs commit.

**Also in this docs commit:** flip HR-34 (bulk assign recipient rows) off
`in_progress`. It reached production 2026-09-07 and was verified in the browser
as Karson.

Before any DEPLOY_LOG heredoc splice: `grep -c '__'` must return zero.

Commits, never pushed. Gary pushes and verifies.
