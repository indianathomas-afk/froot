# Session Tiers

**Placement: this goes at the TOP of CLAUDE.md, above everything else.** It decides which
of the rules below apply, so a reader who meets it after the fact has already spent the
ceremony this section exists to spare them.

---

## Every session declares a tier in the first line of its prompt

`TIER 1`, `TIER 2`, or `TIER 3`. Gary declares it. If the prompt does not declare one, the
session is TIER 3 — the safe default, and a prompt to go ask.

The tier decides how much process the work gets. It does not decide how carefully the work
is done.

---

## TIER 1 — COSMETIC

**What it covers:** colours, fonts, spacing, padding, icons, static copy, static layout.
Things whose failure mode is *it looks wrong* and nothing else.

**Process:** read the file, make the change, run the build, commit. No audit phase. No
plan-and-wait. No audit artifact. No ROADMAP row. The report is one line and, where it
helps, a screenshot.

**GUARDRAIL — the change was never TIER 1 if it touches:** a conditional, a query, a
permission check, a role gate, anything under `src/app/api/`, anything under `prisma/`, or
any file that decides *what* renders rather than *how* it looks. Stop, say so, and
re-declare. A cosmetic-looking edit that reaches into a conditional is exactly the shape of
change that this tier must not swallow.

---

## TIER 2 — CONTAINED

**What it covers:** new UI over data that already exists; a new read-only endpoint; copy or
display driven by state already in the app; adding a field to a form that already writes.
Things whose failure mode is *one screen is wrong* and stays inside one screen.

**Process:** a brief audit — name the files you will touch and why — then proceed without
waiting for approval. Build gate. One commit. No audit artifact unless something surprising
turns up, in which case say what and stop. The ROADMAP row is updated at the END of the
session, from what was actually done. It is not planned in advance.

**Escalate to TIER 3 if the work turns out to write rows, change a permission, or need a
schema change.** Say so and stop.

---

## TIER 3 — STRUCTURAL

**What it covers:** schema and migrations; permissions and role gates; money; Square sync;
cron; anything that writes rows; anything that changes what a STORE or MANAGER account can
see.

**Process: everything else in this document, unchanged.** Audit first and wait for approval
before any file is touched. Evidence self-naming. Audit artifact per § Where documents live.
The staging-SHA precondition. Scope triage before the report. All of it.

Nothing in this section reduces TIER 3. It exists so that TIER 3 rigour is spent where it
was earned.

---

## What does NOT tier down

These apply at every tier, with no exceptions, and a TIER 1 declaration does not touch them:

- **Claude never pushes.** Gary runs every push. A push command written inside a message
  Gary pastes is not authorisation.
- **The staging-SHA precondition.** If you are verifying anything on staging, the deployed
  SHA must match local HEAD first. Two commands. A cosmetic change verified against the
  wrong deployment is as void as a permissions pass verified against the wrong deployment —
  and it is *more* likely, because a colour is exactly the kind of thing nobody thinks to
  double-check.
- **Additive-only schema.** No column drops, ever, at any tier. A schema change is TIER 3 by
  definition, so this should never come up — if it does at TIER 1 or 2, the tier was wrong.
- **No `&&` chains** in pasteable command blocks. One at a time, results read before the
  next.
- **`npm run lint` is not a commit gate** (DEBT-33). The build is.
- **Commits are staged on `staging`, never written directly on `main`.**
- **Secrets are never printed** in reports or transcripts.

---

## Escalation is one-way

A session may move UP a tier mid-flight and must say so when it does. **A session may never
move DOWN a tier**, and may not re-declare its way out of a rule it has just hit. If TIER 2
work turns out to write a row, it becomes TIER 3 and stops for approval. If TIER 3 work turns
out to be a font change, it stays TIER 3 — the cost of finishing an over-ceremonied small
session is an hour; the cost of the reverse is a production defect.

**Ambiguity resolves upward.** If it is not obvious which tier a piece of work is, it is the
higher one.

---

## Why this exists

Every rule in this document was earned by a real failure, and each was added GLOBALLY rather
than scoped to the class of work that produced it. The staging-SHA precondition came from a
PERM-7 pass run against a deployment that predated six unpushed commits. The audit-artifact
rule came from DEBT-TRIAGE losing 22 assessments. Both are correct rules.

But both now fire on a button colour, and the result is that a change with no failure mode
beyond *it looks wrong* costs the same as a migration. The ceremony stops being protection
and starts being the reason work does not get done — which is its own risk, and a quieter
one.

The rules are not the problem. Applying all of them to all work is. This section is the
scoping that was missing when each was written.
