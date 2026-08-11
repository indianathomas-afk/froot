# SESSION PROMPT — TRAINING AUDIT (Categories + Bulk Assignment pre-phase)

**Date commissioned:** 2026-08-10
**Session type:** READ-ONLY AUDIT with hard stops. No code edits. No schema changes. No migrations. The only file this session may create is the audit artifact itself, and only after Gary's explicit in-session approval of the plan.
**Executor:** Claude Code. **Rulings authority:** Gary, in the Claude.ai planning chat. This session gathers evidence; it does not decide.
**Git:** One docs commit for the audit artifact (after approval). Commit, never push — Gary runs all pushes. `npm run build` is not required for a docs-only commit, but do not touch anything that would make it relevant.

---

## GROUND RULES (CLAUDE.md has the full set — read it first)

- THE SOURCE OF TRUTH IS THE REPO AT HEAD, not this prompt's summaries. Where this prompt describes the board or the schema, verify against the files. If the file disagrees with this prompt, the file wins — and say so in the report.
- Repo root: `~/Claude_Projects/Froot/froot` (lowercase `froot` is the git root; the capital-F parent is a known trap). `src/generated/` is excluded from all greps.
- Evidence rules are absolute:
  - Any database query result must carry the Neon identity output (`current_database()` + `neon.endpoint_id` / `neon.branch_id`) in the same output block. Dev = `br-broad-wave`, staging = `br-square-feather`, production = `br-sparkling-block`. `br-purple-rain` is a fossil — never query it, never cite it.
  - This session should not need production queries. If one becomes necessary, that is a STOP, not a judgment call.
- RULING NOW discipline: anything that smells like a decision stops the session and gets written into the ruling packets for Gary. Do not resolve ambiguity by picking the reasonable-looking option.
- Out-of-scope findings go through triage before the report: FIX NOW / RULING NOW / COMMENT NOT A ROW / ROW (ROW is last resort). No fixes in this session regardless — a FIX NOW finding is recorded, not executed.
- Preserve-and-mark applies to any doc this session touches: nothing is deleted, closures prepend with dates.

## REQUIRED READING BEFORE ANY WORK

1. `CLAUDE.md` (house rules, evidence standards)
2. `docs/ROADMAP.yaml` at HEAD — full pass, with particular attention to: HR-6, HR-7, HR-8, HR-13, HR-15b, HR-18, HR-19, TPL-1, TPL-2, PERM-6, UX-2, DEBT-26, DEBT-59, PERM-5C
3. `docs/prompts/TYPE-1_AUDIT.md` — this is the model for the audit artifact this session produces. Match its rigor and shape.

## STANDING CONTEXT (verify, don't trust)

- CHK phase complete, shipped, verified. Main and staging both at `f318d2e`.
- HR is LIVE in production (HR_MODULE_AVAILABLE env flag + per-org toggle, two independent gates). Keva has ~150 staff.
- `notify.ts` is console-only — no real email provider. Blocks HR-16, F-5 alerts, HR-8 reminders. Notifications are OUT OF SCOPE for the phase this audit prepares.
- HR-19 (registry migration of 35 HR routes / 13 pages) is planned and NOT started — HR routes still use inline role checks. New routes in the coming phase should MATCH the inline pattern, not begin the migration (see R-e).
- STORE role is a shared iPad account: operational breadth, zero confidential or personal data.
- `isCorporate` staff are excluded from every store-scoped compliance surface, retained in org-wide ADMIN views.

---

## THE PHASE THIS AUDIT PREPARES (context only — nothing here is built in this session)

### PART 1 — TRAINING CATEGORIES, first-class and managed

Operators can create, rename, recolor, and delete training categories (examples: New Hire Training, Manager Training, Procedures Training, Operations Training, Product Training, Smoothie Training). When a training module is created or edited, a category is assigned. The `/hr/training` list gains category badges and filter chips.

THE MODEL IS TPL-1/TPL-2, DELIBERATELY — read both rows and `docs/prompts/TYPE-1_AUDIT.md` before proposing anything. Carry over the settled patterns rather than re-litigating them:

- Per-org entity (the IngredientCategory / LossReason / TemplateType pattern — this would be the fourth instance).
- Colours are badge-preset KEYS, never class strings (Tailwind 4 CSS-first constraint — a class string from the DB never generates; `src/lib/badge-presets.ts` holds the literals).
- Delete blocked while in use, with reassign offered. Rename shows the affected count first.
- Management UI lives WITH the list it categorises (the Manage Types dialog precedent — Gary ruled this for templates; assume the same here unless the audit finds a reason not to).
- Starter seed for orgs that would otherwise have zero categories (the DEBT-59 line: visible, renameable defaults offered to an operator — never a value silently stamped on a record).
- If TrainingModule already carries any category-like string field, the TPL-1a additive shape applies: new entity + nullable FK, mirror kept during transition, retirement is its own later step.

### PART 2 — BULK ASSIGN TRAINING, from the module itself

With ~150 employees, assigning a new training one person at a time via `/staff` → person → Training → assign is unusable for anything org-wide. The flow that fixes it:

1. Open `/hr/training`.
2. On a training module (card OR list row — see Part 4): "Bulk Assign Training".
3. Pick recipients: one or more individual staff, an entire store's staff, or everything in the assigner's scope.

Scope is a hard rule, not a UI convenience: a MANAGER bulk-assigns only within their store scope (`getUserStoreScope`), and every submitted staff/store id is validated server-side against org ownership AND caller scope — PERM-6's lesson, applied to a new write path on day one instead of retrofitted. The response body reports its own blast radius: assigned / already-assigned / skipped-and-why counts, all summed into the totals (the CHK-3 counter lesson: a field's name is not evidence of what it counts, and a bulk write that reports only what it wrote hides what it excluded).

### PART 3 — DUE DATES ON BULK ASSIGNMENT

The bulk-assign flow lets the assigner set a due date that applies to every assignment it creates. Due date is OPTIONAL with NO invented default (DEBT-59: a date nobody chose is not a real answer). NOTE BEFORE SCOPING: HR-13 already reserves "exclude-until-due training semantics" for compliance — the audit must establish how due dates interact with the compliance rollup (HR-8 computes live) and whether Part 3 fires HR-13's trigger or stays independent of it.

### PART 4 — CARD VIEW AND LIST VIEW on /hr/training

The training library becomes viewable two ways: the existing card form, and a compact list form. Constraints that come with the toggle:

- ONE data source feeds both views (DEBT-26's discipline: two renderings, never two derivations — a module must not show a different category, status, or action set depending on the view).
- Everything this phase adds appears in BOTH views: category badges, filter chips composing with the toggle, and the Bulk Assign entry point. A feature reachable in one view and not the other is a defect, not a style choice.
- View preference persistence is a RULING, not a default (R-f) — UX-2 documented that localStorage outlives logout on shared devices, so "remembers per browser" is a decision to make deliberately, even for a cosmetic toggle.

### EXPLICITLY OUT OF SCOPE unless Gary rules otherwise

Assignment notification emails (notify.ts is console-only — the gate is HR-16's, not this phase's); any HR-19 registry migration; any change to training content authoring (HR-6) or the execution renderer (HR-7); HR-18's supervised-completion path.

---

## RULINGS GARY WILL MAKE AFTER THE AUDIT — surface these with evidence, DO NOT DECIDE THEM

- **R-a. Phase IDs and split.** Propose ids (continue the HR- sequence, or open a TRN- sub-series — note the labor track's lesson: never a third numbering of an existing thread) and a session split (likely: schema+entity, management UI+chips, bulk assign, due dates, view toggle — but let the audit shape it; the toggle may ride with the chips session since both rework the same page).
- **R-b. Duplicate handling.** Bulk-assigning a module to someone who already has it: skip, re-assign, or reset progress? Check whether a unique constraint exists on module × staff member; check the HR-15b signing-cycles precedent for re-assignment.
- **R-c. Who can bulk assign.** ADMIN + MANAGER presumably; does STORE (a shared iPad) get it? Gary's instinct is no — confirm what the existing single-assign path enforces and match or tighten.
- **R-d. Recipient edge cases.** Terminated staff (HR-7 termination rules), corporate staff with no store (isCorporate is excluded from store-scoped surfaces — is "entire store" ever right for them? is "everything in scope" for an ADMIN?), staff with no self-service login.
- **R-e. Permission mechanics.** HR-19 is planned and unstarted; new routes should MATCH the existing HR inline-check pattern, not quietly begin the registry migration inside this phase (PERM-5C's edge discipline). If the audit disagrees, bring the argument, don't act on it.
- **R-f. View-toggle persistence.** Session-only, per-browser (localStorage — with the UX-2 shared-device caveat stated), or keyed by user. Bring the option costs; Gary picks.

---

## THE TASK — two parts, in order

### PART A — BOARD SUMMARY (read-only, report in-session)

Read `docs/ROADMAP.yaml` at HEAD and produce a plain-English summary of the board:

- Open rows by track.
- Anything stale (statuses that don't match repo reality, dates that look abandoned) — flag with the file line, do not edit.
- How this training phase fits the sequence, given HR-6, HR-7, HR-8, HR-13, HR-15b, HR-18, HR-19 and the TPL precedents.
- Verify at HEAD; do not trust this prompt's summaries over the file.

### PART B — THE TRAINING AUDIT (plan first, STOP, then write on approval)

Modeled on `docs/prompts/TYPE-1_AUDIT.md`. Map, with file paths and line references:

1. **TrainingModule** — schema at HEAD (fields, constraints, indexes; does any category-like string field already exist?), every read site, every write site.
2. **TrainingAssignment** — schema at HEAD (fields, constraints; does `dueDate` already exist? is there a unique constraint on module × staff member?), every read site, every write site.
3. **`/hr/training` page** — how it renders today: server/client split, where the card markup lives, what a list view would share with it, how filtering (if any) works now.
4. **The `/staff/[id]` Training tab's assign path** — what it enforces (role checks, scope checks, org validation), what it writes, what a duplicate assign does today.
5. **The compliance rollup's consumption of assignments** — how HR-8 computes, where due-date semantics would land, whether Part 3 fires HR-13's trigger.

**Deliverables:**

- The audit written to `docs/prompts/` as a dated `.md` (this file's date + `TRAINING_AUDIT.md` or per house convention) — ONLY after the plan stop clears.
- A proposed phase split with sizes.
- R-a through R-f evidence packets, one per ruling, each with the file/line evidence and the honest option costs — no recommendations dressed as findings. These come back to Gary in the planning chat.

**HARD STOPS:**

1. After required reading and before any audit work: present the audit plan (what will be grepped/read, in what order, what the artifact's structure will be). WAIT for Gary's explicit approval before writing anything.
2. Any finding that smells like a ruling: STOP and record it as a ruling packet. Do not proceed past it by assuming an answer.
3. Any need to query a database: STOP. This audit should be satisfiable from the repo at HEAD.

**Done criterion:** audit artifact committed (docs commit, not pushed), Part A summary and R-packets delivered in the session report for Gary to carry into the planning chat.
