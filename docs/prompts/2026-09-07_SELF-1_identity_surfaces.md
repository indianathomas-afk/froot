# SELF-1 — "Show me, me": assignment banner, own-row pin, sidebar identity

**TIER 3 — STRUCTURAL.** Role-adjacent visibility, a new cross-entity read on
the highest-traffic page in the app, and a resolution path with a known history
of silent failure (BUG-2). Escalation is one-way; this session may not
re-declare down.

**Two phases in one session. Phase 1 ends at a written plan and STOPS.** Phase 2
begins only when Gary approves that plan. Do not read ahead into Phase 2 while
auditing — it exists so you don't need a second session, not so you can plan
the build before you've read the code.

**Save to:** `docs/prompts/2026-09-07_SELF-1_identity_surfaces.md`
**Phase id:** `SELF-1` — **proposed, not ratified.** Gary confirms the id before
any ROADMAP row is written. Do not invent a row on your own initiative.

---

## 0 · Preconditions — run one at a time, read each result

No `&&` chains. If any check fails, stop and report; do not "fix it quickly."

1. `froot` — then `pwd`. It must print the **lowercase** `froot` git root.
   The capital-F parent is a trap that has fired repeatedly.
2. `git status --short` — the working tree must be clean. As of 2026-09-07 there
   are two untracked items (`docs/ROADMAP.yaml.bak`, `Claude outputs/`). **If
   they are still present, stop.** This session must never run `git add -A` with
   those in the tree, and `Claude outputs/` may contain transcript material.
3. `git branch --show-current` — must be `staging`. If it says `main`, stop and
   tell Gary; he switches branches, not you.
4. `git log --oneline -1` — record the SHA in the artifact.

You never push. Gary runs every push, including when the target branch is
obvious. Push instructions do not belong in this file and none appear below.

---

## 1 · What this is, in plain English

A manager who has been assigned training has no way to find out. The assignment
lands on their staff record, and their staff record is not where they live —
they live on `/dashboard`. Their own training gets lost underneath everyone
else's.

Four asks arrived separately and are all the same feature:

1. **A persistent banner on `/dashboard`** for a person with incomplete assigned
   training or unsigned required documents, linking through to the work. It
   clears only on completion.
2. **The viewer's own row pinned to the top of `/staff`**, marked, so they can
   find themselves.
3. **The sidebar footer name is clickable**, going to that person's staff page.
4. **The sidebar footer shows a full name.** It currently renders `corporate`
   for `corporate@keva.com`.

Every one of them bottoms out in a single question: *given this login, which
staff member is this?* Answer it once; all four fall out. That framing is the
scope of this phase.

**Not blinking.** Gary's original ask was a blinking banner. Ruled against:
WCAG 2.2.2, and on a dashboard staff read all shift a blink becomes wallpaper
inside a week — the exact failure the feature exists to prevent. Solid,
high-contrast, persistent, with a count and the nearest due date. At most a
single pulse on load.

---

## 2 · Ratified rulings — direction, not up for re-litigation

Ratified by Gary in chat 2026-09-07. **Gary writes these into
`docs/DECISIONS.md` in his own words separately**; if that entry does not exist
when you run, say so in the artifact and proceed on the text below.

**R1 — Who gets the banner.** Anyone whose login resolves to **exactly one**
staff member, *regardless of role*. Not "MANAGER or ADMIN." Consequences that
are wanted, not tolerated: device logins resolve to nothing and stay silent with
no role logic; the STAFF role already has `/my`, and any overlap is a design
question for the audit, not a reason to reintroduce a role gate.

**R2 — What counts as owed.** Any assigned training not Complete, plus any
required document not signed on its current version. Overdue and not-yet-due
both count; overdue is styled harder. Read the existing rollup — do not build a
second definition of "owed."

**R3 — Elevated logins that resolve to nothing.** The banner ships anyway. The
audit **files a row** (does not build) for an admin-visible surface listing
logins with no linked staff record. A manager silently exempt from her own
compliance banner is indistinguishable from a compliant one, and somebody has to
be able to see that.

---

# PHASE 1 — AUDIT

Read-only. Answer every question with file paths and line numbers. "Probably" is
not an answer; cite the line.

### 1a. Identity resolution
- `findStaffMemberForUser` and `findStaffMemberForEmail` in `src/lib/hr.ts` —
  every call site in the repo. Which surfaces already resolve self, and is there
  a duplicate implementation anywhere (the BUG-2 pattern)?
- `findStaffMemberForEmail` uses `findFirst` with **no `orderBy`**. Confirm at
  HEAD. Today's data returns one row, so it is deterministic *by accident of the
  data, not by construction* — the same critique `hr.ts` already makes of itself
  in the store-resolution comment. State what R1's "exactly one" requires here:
  a count, not a `findFirst`.
- Does the app shell / `(app)` layout resolve the current user's staff member
  today, or would this be the first time? Cost of doing it in the layout, given
  it renders on every page for every role.

### 1b. The dashboard
- Path and server/client split of the `/dashboard` page. Where would a banner
  mount, and is `/dashboard` the landing page for **every** role including STORE?
- **Cost.** That page already carries sales performance, labor coverage, labor
  budget, monthly goal and forecasting. Adding a per-render compliance rollup is
  the single biggest risk in this phase. Report the query count and whether
  anything is cached or streamed. If it would slow the dashboard, say so and
  propose the shape that does not.

### 1c. What "owed" resolves to
- `computeStaffComplianceDetails` / `getStaffComplianceDetail` in
  `src/lib/hr-compliance.ts` — signature, cost, and what it returns. Confirm the
  statuses are `not-started` / `in-progress` / `overdue` / `needs-resign` /
  `complete` per `scripts/verify-hr8-compliance.ts`.
- Does it behave for a member with **no store assignment**? The verify script's
  s5 case suggests yes — confirm at HEAD.
- Does it behave for a **terminated** member? The banner must not fire for one.
- Is there a cheaper summary function already used by the `/staff` compliance
  column? If a summary exists, say whether it is sufficient for the banner.

### 1d. `/staff` own-row pin
- `src/app/(app)/staff/page.tsx` groups members **by store** and renders a table
  per group. A global "managers first" sort is therefore a sort inside every
  group — and `StaffMember` carries **no role at all** (role lives on `User`),
  so it would need a new join on a list query several roles can see.
- The ask is "help me find my profile." Pin the viewer's own row with a **"You"**
  marker instead. Confirm this needs no role join, only the id from 1a.
- A member assigned to several stores appears under several groups (see DEBT-13
  territory). Say what pinning means in that case — every group, or the primary.
- Which roles can reach `/staff` today, and does a STORE login see it? Report
  only; widen nothing.

### 1e. Sidebar footer
- Which component renders the footer, and where does the string `corporate` come
  from? Candidates: the email local part, or the Clerk `identifier` — which
  BUG-2 ruled must never be read as an email or a name.
- **`User.name` is NULL for all 32 rows in production.** A full name cannot come
  from there. `/users` renders "Keva Corporate Test" for this account, so a
  working resolution already exists in this repo — find it and say why the shell
  isn't using it. This ask is blocked on the same join as everything else, which
  is why it sits in this phase and not in a quick cosmetic fix.
- Where does the footer link go when the login resolves to **nothing**? Propose;
  do not decide.

### 1f. Fragility to record, not fix
- `User` has no uniqueness on (organizationId, email): `kevajuice14@icloud.com`
  exists **twice** in the Keva org with different roles (STAFF and STORE). Any
  code resolving a login by email and reading role off it is ambiguous today.
  Record it; it is a fourth argument for R1.
- `User` carries `grantedCapabilities` / `deniedCapabilities` arrays alongside
  `role`. This phase stays out of that system entirely. Note where it would
  intersect if anyone later tried to gate the banner on role.

### Phase 1 deliverable

Current-state answers to all of 1a–1f with paths and line numbers; **the exact
file list Phase 2 would touch and why**; the verification plan filled in against
§4 below with real account names; the proposed ROADMAP row text; the R3 row
text; and anything surprising.

**Then STOP and wait for Gary's approval. No file is touched until he gives it.**

---

# PHASE 2 — BUILD

Begins only on Gary's explicit approval of the Phase 1 plan. If the plan changed
during discussion, build the changed version, not this file's assumptions.

### 2a. Order of work — the resolver first

Build the identity resolver as **one helper in one place** before any of the
four surfaces consume it. Four callers each resolving self their own way is how
BUG-2 happened, and TYPE-1's six-derivations story is the same lesson. If a
suitable helper already exists per 1a, extend it rather than adding a second.

Then the consumers, in this order — each one independently revertable:
1. Sidebar footer: full name + link (smallest, proves the resolver).
2. `/staff` own-row pin.
3. `/dashboard` banner.
4. Banner styling pass.

### 2b. Hard constraints

- **No role gate anywhere in this feature.** R1 is "resolves to exactly one
  staff member." If you find yourself writing `role === "MANAGER"`, stop.
- **One definition of "owed."** Read the existing rollup. A second definition
  drifting from the first is DEBT-26's failure mode.
- **Resolve to exactly one, or resolve to nothing.** Two matches is not one
  match. Nothing renders rather than guessing whose training to show.
- **Additive-only schema, and none expected.** If you believe a migration is
  required, **stop and present the case** — do not write one.
- **No widening.** This phase shows people their own data. It grants no one
  access to anyone else's, and no role gains a route it lacked.
- **The build is the commit gate. Lint is not** (DEBT-33). No pipes in a gate
  chain — a pipeline returns the last command's exit code.
- Anything out of scope you find: write it down, do not fix it. Triage as
  FIX NOW / RULING NOW / COMMENT / ROW, with ROW the last resort.

### 2c. Acceptance criteria — testable statements, not vibes

1. A login linked by `StaffMember.userId` with an incomplete assignment sees the
   banner, with a correct count and the nearest due date.
2. A login linked only by **email match** with an incomplete assignment sees the
   same banner. (This path is separately verified because it is the weaker one.)
3. A login resolving to **no** staff member sees no banner, no crash, and a
   footer that still renders something sensible.
4. A **device** login (`kevajuice##@icloud.com`) sees no banner.
5. A person with **nothing owed** sees no banner.
6. A **terminated** member's record does not produce a banner.
7. The footer shows a full name, not an email local part, wherever one resolves.
8. The footer link lands on that person's own staff page.
9. The viewer's own row appears first on `/staff` with a "You" marker.
10. `/dashboard` does not measurably slow down. State how you measured.

### 2d. Verification — both link paths, or it isn't verified

- **Do not create test training or documents on any real employee.**
  **Kristie Connolly is a real, salaried employee** — she is off limits for test
  data entirely. If a disposable fixture is needed, create one and say so.
- **Keva Corporate Test** (`corporate@keva.com`) already carries a real
  assignment — Keva Employee Training Guide Day 1, Not started, due Sep 9 2026 —
  and sits on the **email-match** path. Natural fixture for criterion 2.
- For criterion 1 (the `userId` path), find an already-linked member with an
  incomplete assignment rather than manufacturing one.
- **`karson@keva.com`, the usual ADMIN test account, is on the fragile
  email-match path** while six real managers are on the solid FK. Testing only
  Karson does not exercise what most managers experience. Test both.
- **`corporate@keva.com` is Keva Corporate Test in production and Tommy Thomas
  on staging** — different staff rows, potentially different link paths. A green
  staging pass on that account is **not** evidence for production.
- Route-level tests, not button tests.
- Staging pass completes before any promotion is proposed. Staging-SHA
  precondition: SHA-match the deployment to local HEAD first, two commands. A
  change verified against the wrong deployment is void.

### 2e. Evidence standards

- Any database result names the Neon branch (`br-broad-wave` dev,
  `br-square-feather` staging, `br-sparkling-block` production) **and** the
  `ep-` host in the same output. `br-purple-rain` is a fossil — never query it.
  A result without a named branch does not count.
- Browser observations name the org id and Clerk instance `verified-snapper-7`,
  captured before testing.
- Database is UTC; Gary is Pacific. **Decode before reasoning about due dates** —
  this phase is full of them, and an off-by-one on "overdue" is a wrong banner.
- Re-measure, don't cite. Stale claims get corrected with dated lines.
- A green result from an instrument that cannot detect the failure is not
  evidence. The specific hazard: an account resolving to no staff member shows
  no banner, which looks exactly like being compliant.

### 2f. Landing it

- Commits land on `staging`, **never** directly on `main`.
- ROADMAP row written **at the end, from what was actually done**, not from this
  plan. Preserve-and-mark: nothing deleted, corrections prepend with dates.
- The R3 row is filed in the same pass.
- `DEPLOY_LOG.md` entry scaled to blast radius — this is a real feature, so a
  normal entry, not a 243-line one.
- **Before any DEPLOY_LOG heredoc splice, `grep -c '__'` must equal zero.**
  Placeholder tokens (`__SHORTSHA__`, `<SHA>`) reaching a committed file is a
  recurring failure here and must be caught by this check, not after the fact.
- Secrets are never printed in reports or transcripts.
- PRE-PUSH-CHECK, then hand back to Gary. **You do not push.**

---

## 3 · Known facts from the 2026-09-07 planning session

**Direction, not evidence.** Read from the Neon console without the branch
literal or `ep-` host in the same output, so **none of it may be cited in the
artifact, a ROADMAP row, or a DEPLOY_LOG entry.** Re-measure anything you state.

- `StaffMember.organizationId` holds a **UUID** (`cf888f2d-…`). `User` has its
  own `organizationId` holding a **cuid**, plus a `clerkUserId` distinct from
  `User.id`. The Clerk `org_…` string, the staff UUID and the user cuid all get
  called "the org id" in conversation, and that ambiguity broke a query during
  planning. **Write this down somewhere durable** — it will cost a future
  session too.
- Production shows a second organization (`cmqvpe2bf…`) with 1 staff member.
  Org-blind queries pull it in.
- Of 11 ADMIN/MANAGER logins in the Keva org: 6 `linked` on `userId`,
  3 `email-match`, and **2 resolve to nothing** — `karissa@keva.com` (MANAGER)
  and `taylin@keva.com` (ADMIN). R3 exists because of those two.
- ~92 staff rows against ~32 logins. Expected shape: most staff never get a
  login, per the design note in `hr.ts`. Not a problem to fix.
