# HR-17 — Supervised (proctored) training completion

**Modules:** Staff + HR (training) + Users/roles
**Roadmap:** New entry `HR-17` — "Supervised training completion under an elevated session" — status `in_progress`
**Branch/target:** staging only. Do not push. I run all git commands.

---

## Read first

- `docs/MODULES.md` — Staff, HR/training, Users/roles module boundaries
- `docs/ROADMAP.yaml`
- `docs/WORKFLOW.md`
- `docs/DECISIONS.md` — specifically the HR attestation/provenance decisions

---

## What this is (read carefully — this is NOT a permission widening)

Training completions can be captured today in two ways:

1. **Self-service** — the team member logs into their own portal and completes lessons/quizzes.
2. **Manager-attested** — an elevated user presses **Mark complete** on the Staff profile
   Training tab, attesting the training happened. The record is attributed to the attester.

**Do not change either of these. `Mark complete` stays exactly as it is today.**

This phase adds a **third** capture path:

3. **Supervised / proctored** — an elevated user (ADMIN, MANAGER, STORE) is logged in on a
   shared device, opens a proctored session from the team member's Staff profile Training tab,
   and hands the device to the team member. **The team member personally completes the lessons
   and quiz.** The completion is recorded as *executed by the team member, supervised by the
   elevated user* — not as a manager attestation, and not as self-service.

The distinction matters legally. A manager-attested completion says "I confirm this person was
trained." A supervised completion says "this person did the work; I watched." These must be
distinguishable in the record forever.

---

## Audit-first

Read everything relevant, present a plan, and **wait for my explicit approval before editing
anything**. Present findings as text. Do not fix anything outside the three named modules —
write it down instead.

In the plan, tell me specifically:

### 1. Current permission surface
- Where is the "who can complete/attest training" check enforced today? Give me file paths and
  line references for every enforcement point: route guard, server action, API handler, and any
  client-side conditional rendering.
- What roles pass that check today, and is the check duplicated or centralized?
- **Does the STORE role currently have access to `/staff` at all?** (Sidebar nav, route guard,
  and any store-scoping on which staff records a STORE user can see.) If STORE cannot reach a
  Staff profile today, tell me what it would take — and whether that is in scope or a separate
  phase. Do not silently grant it.
- How are MANAGER and STORE users scoped to stores, and does that scoping already restrict
  which staff members they can act on? A MANAGER must not be able to proctor a team member at a
  store they aren't assigned to.

### 2. Data model / provenance
- Show me the current shape of the training completion, lesson-progress, and quiz-attempt records.
- Propose an **additive** way to record capture method. Something like a
  `completionMethod` / `captureMethod` value with `SELF_SERVICE`, `MANAGER_ATTESTED`,
  `SUPERVISED` — plus the supervising user's identity stored alongside the subject staff member.
- Existing rows must keep their current meaning. Backfill existing completions to their correct
  existing method; **do not** leave them null and do not delete or rewrite any acknowledgment or
  checkpoint row (G1 rule stands).
- A supervised record must carry, at minimum: subject `StaffMember` id, supervising `User` id
  (Clerk user), capture method, timestamp, and store context.
- **Identity binding:** propose how the team member confirms it's them at the start of the
  supervised session. My preference is a typed confirmation against `StaffMember.fullName`
  (legal identity — not `displayName`), consistent with the signing ceremony. Tell me if there's
  a better fit given the existing code. This is a fork — present options, don't pick for me.

### 3. Session containment (treat this as a first-class requirement, not polish)
Handing a logged-in elevated session to a team member exposes Users, Labor, Reports, Stores,
and Settings. Tell me:
- How you'd constrain the proctored session to the training content only — full-screen takeover,
  nav suppression, route guard on the proctor session, or some combination.
- How the session **ends**, and what prevents the team member from ending it themselves and
  landing back in the manager's app shell. Present options for the exit gate (re-auth, a
  supervisor confirmation step, a PIN, timeout) with tradeoffs. Don't assume.
- What happens on abandonment: browser closed mid-session, tab navigated away, device sleeps,
  session expires. Partial progress should not silently become a completion.

### 4. Quiz handling
- A quiz taken in proctored mode is a genuine attempt by the team member and should count as
  one. Confirm that's how the current attempt model would treat it.
- Proctored attempts must be distinguishable from self-service attempts in the record so pass
  rates aren't blending capture conditions.
- Tell me whether existing quiz scoring/attempt-limit logic needs any change to accommodate
  this, or whether it works as-is.

### 5. UI
- Where the new affordance lives on the Training tab, and how it reads so it's never confused
  with **Mark complete**. Both will be visible to the same users at the same time — the labels
  need to make the difference obvious to a store manager who has never read a spec.
- How supervised completions are displayed after the fact in the training list and on any
  compliance/report surface, so an auditor can see how each completion was captured.

### 6. Schema
- Any schema change surfaced as **SQL first**, for my approval, before Prisma migrate runs.
- **Additive only.** No column drops, no type changes, no destructive edits.
- **Echo the database host before running any migration.** Staging Neon branch only.
- `package-lock.json` committed with any dependency change.

---

## Constraints

- Staging only. Never push.
- One phase, this session. Don't start HR-14 or anything adjacent.
- Out-of-scope findings: write them as text in the report-back. Do not fix inline.
- Do not modify `Mark complete` behavior, its permission check, or its record shape.
- Do not weaken or repurpose the existing manager-attestation record to carry supervised
  completions.
- Never write to the sibling `froot_docs/` folder. All docs live in `docs/` inside the repo.

---

## Report back

1. Enforcement points found, with file paths — and which ones changed.
2. STORE role's current access to `/staff`, and what you did or didn't do about it.
3. Final data model for capture method, with the SQL that ran.
4. How the proctored session is contained and how it exits.
5. How supervised vs. attested vs. self-service completions now read in the UI.
6. Out-of-scope findings (text only).
7. Anything you were unsure about and made a judgment call on.

---

## Done criterion

- `next build` passes.
- `docs/ROADMAP.yaml` HR-17 entry updated.
- Verified on staging with the Tommy Thomas / Las Brisas test account:
  a supervised completion recorded end-to-end, distinguishable in the record from both a
  self-service completion and a `Mark complete` attestation.
