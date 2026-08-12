# SESSION PROMPT — TRAINING ACCESS AUDIT (STORE preview access + assignment capability)

**Date commissioned:** 2026-08-11
**Session type:** READ-ONLY AUDIT with hard stops. No edits to any file except the audit artifact, and only after Gary's explicit in-session approval of the plan.
**Tier:** 1 — this touches role access, a confidential-content surface, and the capability override layer. Full ceremony.
**Executor:** Claude Code. **Rulings authority:** Gary. This session gathers evidence and surfaces rulings; it does not decide any of them.
**Git:** One docs commit for the audit artifact after approval, gated by green `npm run build`. Commit, never push.

---

## GROUND RULES

- Source of truth is the repo at HEAD. Required reading before any plan: `CLAUDE.md`, `docs/prompts/2026-08-10_TRAINING_AUDIT.md` (especially §4 the assign path, §6 the permission surface, §10.3 R-c's options), the HR-20/21/22 rows and the R-a..R-f transcription on HR-20's row, HR-6/HR-7/HR-17/HR-18 rows, and the PERM-5 series rows (5A/5B/5C) plus whatever shipped the capability-override UI now live at `/users`.
- Verify repo state and report: expected branch staging, main and staging level after the HR-20/21/22 promotion. If they are not level, say so — reasoning against a stale branch is what caused the HR-22 follow-up near-miss (see `docs/prompts/HR-22-FOLLOWUP_AUDIT.md`).
- No database queries. If the audit believes it needs one, that is a STOP and the query goes to Gary for the Neon console with the branch id selected inside it.
- HARD STOP #1: after required reading, present the audit plan and WAIT for approval before writing the artifact.
- HARD STOP #2: anything that smells like a ruling becomes an evidence packet and stops there. Several are named below; expect more.

## WHY THIS SESSION EXISTS — the operator scenario, in Gary's words

A training module is created for something store-specific and operational: *how to restart the water heater at a particular store*. Testing on production surfaced holes:

1. **STORE logins cannot reach the training card at all.** They should be able to see every training module — but must not edit, delete, or assign anything.
2. **A MANAGER can assign a training to an employee; once that employee completes it, the module leaves their view.** Gary rules this behavior CORRECT and wants it preserved: completed training must not remain reachable from an employee's personal self-service session after hours. The concern is trade-secret material walking out of the building.
3. **STORE access should be review/preview only** — read the procedure on the floor, on the shared iPad, at the moment the water heater needs restarting.
4. **STORE gets the training card by default, with no edit, assign, or delete.**
5. **Under capability overrides (ADMIN, at `/users`), Gary wants the option to grant a STORE login the ability to assign trainings to team members — still never edit or delete.**

## THE CONFLICT THIS AUDIT MUST RESOLVE BEFORE ANYTHING IS SCOPED

**Item 5 appears to run against the override layer's stated direction.** The override UI at `/users` says, verbatim on screen: overrides turn things off for a person only, can restrict below what their role allows and never above it, and to give more access you change the role. If that is the implemented rule and not just copy, then "grant STORE the ability to assign" cannot be expressed as an override — it would require assignment to be part of STORE's baseline role and then be restricted by default, which is a different mechanism with different blast radius (every STORE login would hold the capability until someone turns it off, and the current 11-store fleet is shared iPads).

**Establish, with file and line evidence:**
- Whether the override layer is genuinely restrict-only in code, or whether the copy is stricter than the implementation.
- Whether a training-assignment capability key exists in the capability registry today, what role tiers grant it, and where it is enforced.
- What it would actually take to express item 5: a grant-direction override, a role-baseline change plus default-off overrides, a new per-login flag, or something else. **Price each; recommend nothing.** This is ruling R-i below.

**Also surface, do not resolve:** R-c ruled `/hr/training` ADMIN-only on 2026-08-10, on the grounds that training content is confidential (Keva's handbook) and HR-6 shipped the page that way deliberately. That ruling explicitly said it was reversible-by-row on demonstrated manager need. Items 1, 3, and 4 are that demonstrated need arriving — but from STORE, not MANAGER, which R-c did not contemplate. **The audit must state plainly what R-c's reversal costs and what it does not** — including whether MANAGER page access rides along or stays closed, since MANAGER currently reaches assignment only through `/staff/[id]`.

## WHAT TO MAP

1. **The page gate today** — `/hr/training`'s server shell, the guards in `api/hr/training/access.ts`, and every tier each guard admits. Name the exact function each of the five item-behaviors would have to pass.
2. **The STORE role's current surface** — what STORE reaches across the app, and where the "operational breadth, zero confidential or personal data" line is currently drawn in code. A store-specific equipment procedure is operational; a handbook policy module may not be. **Is the training library one bucket or two?** If STORE gets the card, it gets every module in it unless something separates them — that is ruling R-j.
3. **The preview surface** — HR-17 shipped a module preview. Map it: what it renders, what it omits, what guard it sits behind, and whether it is reusable as STORE's read-only view or whether STORE needs its own. Include whether attached resources are downloadable from preview, since item 2's whole concern is material leaving the building.
4. **The completion-disappears behavior in item 2** — find the code that causes it. Gary states it as observed and endorses it, but it must be located and named before it can be preserved deliberately: is it a filter on `/my/training`, a status transition, an assignment lifecycle rule, or an accident of a query? A behavior nobody wrote on purpose is not yet a guarantee.
5. **The assignment write paths** — single (`/staff/[id]`) and bulk (HR-22's route), and exactly which guard each uses, so item 5's capability question has a concrete enforcement point rather than an abstraction.
6. **HR-18's boundary** — HR-18 plans a supervised-completion path where a STORE device witnesses completion. Item 5 (STORE assigns) and HR-18 (STORE witnesses) are adjacent and must not collide. State the seam.

## RULINGS TO SURFACE WITH EVIDENCE — DO NOT DECIDE

- **R-g. STORE read access shape.** Preview-only reuse of HR-17 vs. a distinct STORE view. What each costs, what each exposes, and whether resources/attachments are reachable.
- **R-h. Scope of what STORE sees.** Every module in the org, or only modules applicable to that store (the `appliesTo` / store-assignment filter that already exists on the assign path)? A store-specific water-heater procedure argues for filtering; an org-wide food-safety module argues against.
- **R-i. Item 5's mechanism.** The override-direction problem above, with each option priced. Include the blast radius of any option that makes assignment a STORE baseline.
- **R-j. Content classification.** Whether the training library needs a confidential/operational distinction at all, or whether STORE simply gets everything. If a distinction is wanted, what carries it — the existing category entity (HR-20's `TrainingCategory`), a per-module flag, or store applicability.
- **R-k. R-c's status.** Reaffirmed, amended, or superseded — and whether MANAGER page access changes as part of this or stays a separate future row.
- **R-l. Phase IDs and split.** Continue the HR- sequence. Propose a split; note that the read path (items 1/3/4) and the capability question (item 5) are separable and may not deserve the same session.

## EXPLICITLY OUT OF SCOPE unless Gary rules otherwise

HR-19 registry migration; HR-13's compliance semantics; HR-23's single-assign retrofit; notification emails (HR-16); any change to training authoring (HR-6) or the execution renderer (HR-7); HR-18's supervised-completion build. The bulk-assign dialog scroll fix is its own separate bug session and does not ride here.

## DELIVERABLE

A dated audit artifact in `docs/prompts/`, modeled on `2026-08-10_TRAINING_AUDIT.md`: the mapping above with file/line evidence, the R-g..R-l evidence packets, a proposed phase split with sizes, and out-of-scope findings triaged (FIX NOW / RULING NOW / COMMENT NOT A ROW / ROW) before the report. Rulings come back to Gary in the planning chat; nothing is filed to ROADMAP.yaml by this session.
