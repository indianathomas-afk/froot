@AGENTS.md

# Session Tiers

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

---

# Froot — Claude Build Context

**Froot** (Framework for Routine Operations & Organizational Tasks) is a multi-tenant operational execution platform for multi-store franchises. It lets operators define checklist templates, assign them to stores, and track completion across locations. Square is an optional integration for importing locations and team members.

---

## Stack

| Layer | Tech |
|---|---|
| Framework | Next.js 16 (App Router), React 19, TypeScript 5 |
| Styling | Tailwind CSS 4 |
| Auth | Clerk (`@clerk/nextjs ^7.5.9`) + Svix webhook validation |
| Database | PostgreSQL on Neon (`@neondatabase/serverless`) |
| ORM | Prisma 7 with `@prisma/adapter-neon` |
| UI Components | shadcn/ui + Radix UI primitives + Lucide icons |
| Forms | React Hook Form + Zod |
| Square | OAuth 2.0 — Locations, Team Members (Phase 1); Catalog, Inventory (Phase 2) |
| Data utils | PapaParse (CSV), xlsx (Excel), date-fns, recharts |

---

## Project Structure

```
froot/
├── src/
│   ├── app/
│   │   ├── (app)/              ← Authenticated app shell (sidebar layout)
│   │   │   ├── layout.tsx
│   │   │   ├── dashboard/
│   │   │   ├── checklists/
│   │   │   ├── instagram/
│   │   │   ├── templates/
│   │   │   ├── stores/
│   │   │   ├── users/
│   │   │   ├── staff/
│   │   │   ├── reports/
│   │   │   ├── settings/
│   │   │   └── store-view/
│   │   ├── (auth)/             ← Sign-in / sign-up pages (Clerk hosted UI)
│   │   ├── api/                ← All API routes
│   │   │   ├── checklists/
│   │   │   ├── corporate-updates/
│   │   │   ├── instagram/
│   │   │   ├── messages/
│   │   │   ├── square/
│   │   │   ├── staff/
│   │   │   ├── stores/
│   │   │   ├── templates/
│   │   │   ├── users/
│   │   │   └── webhooks/clerk/
│   │   ├── print/              ← Print pages (no sidebar, outside app shell)
│   │   │   └── template/[id]/
│   │   ├── globals.css
│   │   └── layout.tsx          ← Root layout (Clerk provider)
│   ├── components/
│   │   ├── layout/             ← app-shell.tsx, sidebar.tsx
│   │   └── ui/                 ← shadcn/ui components
│   └── lib/
│       ├── auth.ts             ← getOrgId(), getOrganization(), requireModule()
│       ├── prisma.ts           ← Prisma client singleton
│       └── utils.ts            ← cn() helper
├── prisma/
│   └── schema.prisma
└── scripts/
    └── import-keva-templates.ts
```

---

## Multi-Tenancy

Every tenant is a Clerk Organization. Every database record belongs to an `Organization` row linked by `clerkOrgId`.

**Every API route and server action must scope queries to the org:**

```ts
import { auth } from "@clerk/nextjs/server"
import { prisma } from "@/lib/prisma"

export async function GET() {
  const { orgId } = await auth()
  if (!orgId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const org = await prisma.organization.findUnique({ where: { clerkOrgId: orgId } })
  if (!org) return NextResponse.json({ error: "Org not found" }, { status: 404 })

  // Always scope with organizationId:
  const records = await prisma.store.findMany({ where: { organizationId: org.id } })
  return NextResponse.json(records)
}
```

Or use the helpers in `src/lib/auth.ts`:
- `getOrgId()` — returns Clerk orgId or throws
- `getOrganization()` — returns the full `Organization` DB record or throws
- `requireModule('inventory' | 'nutrition')` — throws if Phase 2 module is not active

---

## API Route Conventions

- Routes live at `src/app/api/[resource]/route.ts`
- Validate request bodies with Zod schemas defined at the top of each route file
- Return `NextResponse.json(data)` for success, `NextResponse.json({ error }, { status })` for errors
- Auth check → org lookup → Zod parse → DB query — always in that order
- DELETE routes return `NextResponse.json({ success: true })`
- POST create routes return `NextResponse.json(record, { status: 201 })`

---

## Page Conventions

- Pages that need the sidebar live under `src/app/(app)/`
- Heavy client interactivity is split into `*-client.tsx` files with `"use client"` at the top
- Server components fetch data directly; pass it as props to client components
- Button islands for isolated interactivity live in `*-buttons.tsx` or `*-actions.tsx` files next to the page
- Print pages live under `src/app/print/` — no sidebar, trigger `window.print()` on load

**A NEW PAGE MUST NOT LOOK THE USER UP BY `clerkUserId` ALONE.** Use
`getCurrentUser()` from `src/lib/auth.ts`, or `findFirst` with
`organizationId: org.id` — never a bare
`prisma.user.findUnique({ where: { clerkUserId } })`. `clerkUserId` is `@unique`
GLOBALLY, so an identity with memberships in two orgs resolves to whichever
org's row it was created in, and that row's ROLE is then handed to the current
session. `getCurrentUser()` has guarded this centrally since DEBT-53/F1; a page
that rolls its own lookup opts back out of the guard.

Twenty existing pages still do it (DEBT-55). They are UI-only today — every gate
behind them refuses independently — and **Gary ruled 2026-08-06 (R1) to leave
them latent** rather than sweep them now. This note exists so the surface stops
growing while they sit: the sweep is a hard prerequisite for DEBT-50's
org-switcher half, and it gets more expensive with every page that copies the
pattern. Exemplars doing it correctly:
`src/app/api/checklists/[id]/task-log/route.ts:36`,
`src/app/api/users/[id]/route.ts:201`.

---

## Design System

**Primary brand color:** `oklch(65% .2 35)` — warm orange-red. Used for buttons, active sidebar items, icons, and accents.

**Background:** `oklch(97% .02 65)` — warm off-white.

**Border radius:** `lg = 0.65rem`, `md = calc(0.65rem - 2px)`, `sm = calc(0.65rem - 4px)`.

**Status colors:**
- Success: `#25ba3b`
- Warning: `#efa201`
- Info: `#0081f2`
- Destructive: `oklch(57.7% .245 27.325)`

**UX rules:**
- Use **skeleton loaders** for async data — never spinners
- All destructive actions require a confirmation `AlertDialog`
- Empty states must include a CTA explaining next steps
- Checklist execution and inventory count screens are **mobile-first** — tap targets ≥ 44px

---

## Phase Status

Phase status lives in `docs/ROADMAP.yaml` — the single source of truth. Do not
track status here, in `docs/ROADMAP.md`, or in any external sheet. Narrative
history for shipped phases (fixtures, migration names, decision cross-refs) is
frozen in `docs/ROADMAP_ARCHIVE.md`.

**Read `docs/ROADMAP.yaml` at the start of every session.** Check the
`blockers` and `deferred` fields of any phase you touch or build on.

**Update it before the session ends (TIER 2 and TIER 3)** — see "Session
completion rules" in `docs/WORKFLOW.md`. A TIER 1 session writes no row
(§ Session Tiers).

### Where documents live

**`docs/prompts/` holds session artifacts; `docs/` holds living reference
documents.** A session's saved prompt and anything that session produced as a
record — audits, preserved query output, smoke-pass results — go in
`docs/prompts/`. Documents a future reader consults for current truth
(`ROADMAP.yaml`, `MIGRATIONS.md`, `PERMISSIONS_INVENTORY.md`, `DECISIONS.md`,
`DEPLOY_LOG.md`) stay in `docs/`.

**The line that decides an edit is POINTERS vs CLAIMS, not frozen vs living.**
A pointer's job is to *resolve* — repair it when its target moves. A claim's job
is to record what was believed at the time — never touch it. This is why
`DEPLOY_LOG.md` gets its paths fixed even though it is dated history: the path is
a pointer, and a dated entry that resolves to nothing helps no one. And it is why
nothing in `docs/prompts/` is ever edited: a saved prompt is a claim *wholesale*
— the whole document is the instruction of record — so even a broken path inside
one stays broken. Editing it would rewrite what was instructed to match what is
now true, which is the opposite of why the library exists.

`DEBT-1_AUDIT.md` and `DEBT-2_AUDIT.md` moved here 2026-08-01, making the rule
consistent with `verification-smoke-pass.md` and `BUILD-2_default_store.md`,
which were already in `docs/prompts/`.

**AN AUDIT-ONLY SESSION MUST WRITE ITS FINDINGS TO
`docs/prompts/<NAME>_AUDIT.md` BEFORE IT REPORTS.** Ruled 2026-08-07 (DEBT-45).
This fires on a session whose entire product is analysis; the brief audit *phase*
of a TIER 2 session is not one, and produces no artifact (§ Session Tiers).
This is DEBT-37's rule — *an observation that lives only in a transcript does
not exist* — at SESSION scale: an audit is nothing but observations, so a
session whose entire product is analysis has the largest possible exposure to it
and, until now, no habit protecting it. **The report summarises the file; it
does not replace it.** A session that reports findings it never wrote down has
not delivered them.

The file is the session's own output, not a living document — so it obeys the
pointers-vs-claims line above like any other artifact in `docs/prompts/`: it is
a claim wholesale, and nothing in it is ever edited afterwards. Write it at full
size. `DEBT-1_AUDIT.md` (28k) and `DEBT-2_AUDIT.md` (27k) are the exemplars, and
they are still cited by live rows today; the DEBT-TRIAGE audit's 22 per-row
assessments are the counter-example and are simply gone.

**This rule is the BACKSTOP, not the whole mechanism.** The other half — a
standing line in Gary's prompt template, so the instruction arrives with the
session rather than waiting to be remembered — lives OUTSIDE this repo and
cannot be enforced from here. DEBT-45 named that automatic half as the harder
and more important one. CLAUDE.md catches the sessions the template misses; it
does not make the artifact automatic.

## Staging Verification — Precondition

**Before verifying anything on staging, confirm the deployed commit SHA matches
local `HEAD`. If it does not, STOP and push first. This is a precondition, not a
checklist item.**

```bash
git rev-parse HEAD                              # FULL 40-char sha — the filter below needs it
npx vercel inspect <staging-alias>              # → which deployment the alias serves
npx vercel ls --meta githubCommitSha=<full-sha> # → must return that same deployment
```

If the SHAs differ, every observation is about different code and the entire
pass is void — including the passes, not just the failures.

**The old one-liner was `npx vercel inspect <alias> --json | grep -i
githubCommitSha`. It stopped working and the way it fails is the reason this
paragraph exists.** Corrected 2026-08-02 during DEBT-9 Phase 3. On Vercel CLI
58.4.4 `inspect --json` returns a trimmed object — `id, name, url, target,
readyState, createdAt, aliases, builds, contextName` — with **no git metadata at
all**. The grep therefore returns empty.

Note the direction of that failure. An empty grep reads as *"the deployed SHA
doesn't match"*, which sends you to push, redeploy, and re-check — and it will
read empty again, because the field is gone, not different. The check cannot
produce a false PASS, only a false FAIL, so nothing was ever verified against
the wrong code by it; the cost is an hour chasing a deploy that already landed.
**Confirm the field is present before trusting its absence** — this applies to
any grep-based gate, not just this one.

Two traps in the replacement, both hit on the first attempt: `--meta
githubCommitSha` compares the **full 40-character** sha, so the short form
returns "No deployments found" — indistinguishable from a genuine mismatch. And
`--meta githubCommitRef=<branch>` lists that branch's deployments but does not
tell you which one the alias currently serves; pair it with `inspect` on the
alias, and match the deployment id.

Recorded 2026-07-28 after a full PERM-7 staging pass was run against a
deployment created **32 minutes before the first of six unpushed commits**. Two
"failures" and one "pass" were diagnosed at length; all three were artifacts of
testing code that did not contain the feature. Every turn of that session had
correctly ended with "unpushed commits: six" — the information was present and
never connected to the test plan. A report line is not a gate; this is the gate.

Corollary: **Claude never pushes** (see Git Rules below), so on any Claude-run
phase the default assumption is that staging does NOT have the work yet.

### Name every test principal for the phase that made it

**Any staff member, user, store or invite created to verify a phase gets that
phase's name in it — `PERM-6b Staff`, `perm-6-staff`, `indianathomas+store2@`.**
Relocated here 2026-08-02 from DEBT-44, which keeps the cleanup task itself.

This is the only reason staging fixtures are cleanable at all. Test principals
accumulate — PERM-6 and PERM-7 left a staff member, four accounts and a stale
invite between them — and they fail exactly the way the ambiguous org names in
§ Database Evidence fail: a query resolves to *a* row, silently. A fixture whose
name says which phase made it can be found and deleted by whoever comes next; an
unnamed one becomes indistinguishable from real data the moment its session ends,
and the next person cannot tell whether deleting it is safe.

**The session that leaves fixtures unnamed removes that property for everyone
after it.** Naming costs nothing at creation time and is unrecoverable afterwards.

## Database Evidence — Precondition

**Every database result used as evidence must name the branch it came from, on
the same line as the result. A result without a named branch does not count.**

```
preview/staging  User(gary@keva.com) role=STORE stores=1     ← usable
                 User(gary@keva.com) role=ADMIN stores=0     ← not evidence
```

This applies to **all** database evidence — `production`, `preview/main`,
`preview/staging`, local dev — not just production. It generalises the rule
already applied to the BUILD-2 production pre-check, which named its branch
because the answer was meaningless without it. That is true of every branch, not
only production.

Recorded 2026-07-28. Three branches were queried in one evening and the results
reported without branch labels. A `role=ADMIN` row from `production` was read as
though it came from `preview/staging`, which triggered a privilege-escalation
investigation, a fabricated explanation for how the row "got there", and a
retraction of a correct PERM-6 coverage finding. The corrected
`preview/staging` row was `role=STORE` — the feature had worked. **Neither the
query nor the result was wrong; only the missing label was.**

Note the failure mode: a mislabelled result does not look like an error. It
produces a coherent, urgent, entirely wrong investigation. Cheap label, expensive
absence.

**Belt and braces — let the query carry the branch, and still name it.** Added
2026-08-01 (Gary's ruling), after PERM-7's Task 7 closure produced the technique.
The rule above asks the *reporter* to assert the branch, and the 2026-07-28
failure it documents was a correct query wearing a wrong label. On Neon,
`current_setting('neon.branch_id', true)` returns a real value —
`br-square-feather-a63z92vz` for `preview/staging` — so selecting it alongside
the result makes the label a product of the same query as the row, and the two
cannot drift. **Do both:** select the branch id *and* name the branch, since the
id is not the `preview/staging` name and that mapping otherwise lives only in a
human's head.

Recommended where available, **not mandatory**: it is Neon-specific and returns
null on local dev — which is itself a signal about where the query ran, not an
invalidation of the evidence. A null return never disqualifies an otherwise
correctly labelled result.

**The same precondition applies to the ORGANIZATION, not just the branch: name
orgs by ID — optionally `ID (name)` — in every doc, prompt and query result. An
org NAME is not an identifier.** Relocated here 2026-08-02 from DEBT-19, which
closes on this relocation. It belongs in this section rather than in a section
of its own: it is the same failure as the branch label, one layer down, and
splitting one idea across two headings is how it stops firing.

Measured on branch `preview/staging` 2026-07-28 — nine `Organization` rows, of
which **five are called "Microsoft"** and two "Keva Juice". Six have zero or one
user; exactly one has Square connected. So "the Microsoft org" picks out five
rows, four of them empty shells.

Note the failure mode, which is the branch-label mode exactly: an
under-specified identifier that still **resolves**. Nothing errors. You get *a*
row, just not necessarily the one you meant — and a wrong-org result looks
identical to a right-org result.

The sharpest case is a WRITE. HR-14 carries an unresolved Clerk-org-rename issue
(a rename reaches the DB but the slug is never rewritten). Whoever resolves it
must identify the target org by ID: applied to "the Microsoft org" by name it has
five candidates, would silently rename the wrong one, and because the slug is the
part that does not update, **the damage would not be visible in the name column
afterwards.**

The dead single-user shells on staging are what make the names ambiguous in the
first place. Cleaning them up is tracked on DEBT-44, which absorbed that half —
and per that row, delete the PRINCIPALS, not the stores. Do it by ID.

**Correction appended 2026-08-02 — two numbers above are wrong, and the way they
got here matters more than the numbers.** Re-queried on `preview/staging`
(branch id `br-square-feather-a63z92vz`) by DEBT-44a: all nine org ids and all
nine user counts reproduced exactly, so the *measurement* stands. But **seven**
orgs have zero or one user, not six — three at zero and four at one. And of the
five "Microsoft" rows, only **two** are empty; two of the other three hold a
User each. The ambiguity argument is untouched, since five rows still answer to
the name. "Empty" is the word that makes a shell sound safe to delete, and it
was wrong for half of them. The provably-empty list now lives on DEBT-44,
measured against all 45 `Organization` foreign keys rather than the user count
alone.

**A relocation copies errors as faithfully as facts.** Both sentences arrived
here verbatim from DEBT-19 when that row closed on 2026-08-02. Nothing in a
relocation re-derives what it moves — that is what makes relocating cheap, and
it is why this happened. The cost is not the off-by-one: it is that a number
from one evening's count, carrying one evening's confidence, was read as settled
once it appeared in a precondition. **When you relocate a measurement, bring its
provenance with it** — when it was taken, on what branch, by which query — so
the copy cannot claim more authority than the original had.

**A ROW ID DOES NOT IDENTIFY A BRANCH. Resolve ids from scratch on every branch
you write to, and never carry one across.** Recorded 2026-08-02 (Gary's
observation) during DEBT-9 Phase 4, which set a flag on two staff members on
staging and then on production.

The ids were **identical on both branches** — `cmqxfyiwy000004l49ps3w1tf` and
`cmqxfyjt1000004jtbfzj9jmz` — because staging was branched from production and
inherited its rows. So were the organisation id and the store ids.

Note what that does to the safety rail. The Phase 4 `UPDATE` was deliberately
written as `WHERE id IN (…) AND "organizationId" = …`, id-keyed and org-guarded,
specifically so a wrong value could not match. **On sibling Neon branches that
guard is inert**: every value in it is valid on both, so a staging id pasted
into a production query matches, updates, and returns exactly the rows you
expected. There is no error, no zero-row result, nothing to notice. The rule
held on the day it was written down **by discipline, not by enforcement** — the
guard could not have caught the mistake it looks like it is guarding against.

This is the § Database Evidence failure mode one layer deeper. The branch label
protects the *reading* of a result; nothing protects the *targeting* of a write,
because the identifier that would distinguish the branches is the one thing the
branches share. Which is why the discipline has to be procedural: **re-run the
resolve query on the branch you are about to write to, every time, even when you
already have the id on screen from ten minutes ago.**

Corollary for anything destructive: a `DELETE` or an `UPDATE` composed against
one branch will execute cleanly against its sibling. Prefer statements that
report what they touched — `RETURNING`, and a row count you assert against an
expected number — so a right-shaped result on the wrong branch is at least
*visible* afterwards.

**A DATABASE TIMESTAMP IS UTC. EVERYTHING YOU READ OFF YOUR OWN MACHINE IS
LOCAL. Never compare one to the other until both are converted, and state the
conversion in the same output as the comparison.** Recorded 2026-08-15 after
this fired THREE TIMES IN ONE DAY.

Every `DateTime` column in `prisma/schema.prisma` is `TIMESTAMP(3)` **with no
time zone** — there is not one `@db.Timestamptz` in the file — so Prisma writes
and returns UTC. Vercel deployment times, `git log` commit times, and anything
`date` prints on a dev machine are **local**. The two sources are seven hours
apart in PDT and eight in PST, and nothing in either output says which it is.

Note what that offset does to a comparison. It is large enough to move an event
across a deployment boundary, across a commit, and across midnight into the
wrong DAY — and it does so *silently*, because both numbers are real, correctly
transcribed, and printed without a suffix.

**The failure mode is the branch-label mode exactly, and this is the third
section of this document to describe it: the naive comparison produces a
coherent, urgent, entirely wrong conclusion, and every observation supporting it
is real. It does not look like an error.** It looks like a finding, and it argues
back.

The three occurrences, all 2026-08-15, all on the same handful of rows:

1. **HR-11n Phase A** dated four orphaned checkpoints by their first
   acknowledgment against the HR-11m deploy time. Raw, `19:02` read as six hours
   AFTER a `12:46` deployment — which would have convicted a fix that was
   working, declared a live leak, and stopped the phase. Converted (`19:02 UTC`
   = `12:02 PDT`), it is 44 minutes BEFORE. The column type was checked only
   because the answer looked wrong.
2. **The same rows, a second time**, after that correction was written down —
   `20:05 UTC` read as an hour after an `18:59` local deployment when it is five
   hours and fifty-four minutes before it.
3. **The ceremony-route investigation that produced this rule**
   (`docs/prompts/hr-11n-ceremony-route-audit.md`), which spent a session
   hunting an unfiltered ceremony route that did not exist. The
   acknowledgments in question predated the retirement feature's first commit by
   2 h 18 m. There was no defect to find.

**The correction did not stop it from happening again**, which is why this is a
precondition and not a note. Writing down "I got the timezone wrong" fixes one
comparison; the habit that fixes all of them is converting BEFORE the comparison
looks surprising, rather than after.

Two cheap checks, in order:

- **State the zone on every timestamp you write down**, the way § Database
  Evidence already demands a branch label on every row. `20:05:58 UTC
  (13:05:58 PDT)` cannot be misread; `20:05:58` invites it.
- **When a timestamp implies a defect, check whether the artifact predates the
  code being blamed.** `git log --format="%h %ad %s" --date=format:"%Y-%m-%d
  %H:%M:%S" <sha>` is one command and ends the question. An artifact cannot have
  been produced by code that did not exist when it was made — and a signed record
  is never regenerated, so the certificate you are looking at may be hours older
  than the deployment you are testing.

## Browser Evidence — Precondition

**Every observation taken in a browser must name the ORGANIZATION ID it was
taken under, on the same line as the observation. A screenshot or a page reading
without a named org id does not count.** This is the § Database Evidence rule
applied to the other place evidence is gathered: there the under-specified
identifier is the branch, here it is the active Clerk org.

```
production · org_3FhYUR4l0ue7egug1I0Ig8wxOVn  /staff → nine store cards + Corporate  ← usable
dev · org_3FhMmIWVjja5HYpsou8n6rVtZn2         /staff → one Unassigned card           ← usable
                                              /staff → one Unassigned card           ← not evidence
```

Recorded 2026-08-02 during DEBT-9 Phase 3. Dev holds **two organizations both
named "Keva Juice"** — `org_3FhYUR4l0ue7egug1I0Ig8wxOVn` (9 stores, 6 staff) and
`org_3FhMmIWVjja5HYpsou8n6rVtZn2` (0 stores, 1 staff) — so a session can be on
the wrong one while every visible signal says it is fine.

**Correction appended 2026-08-06 — the attribution above is wrong, and the way
it is wrong is this section's own lesson one layer down.**
`org_3FhYUR4l0ue7egug1I0Ig8wxOVn` is a **PRODUCTION** Clerk org (Keva Juice,
5 members — production Clerk dashboard, 2026-08-04; production SQL on
`br-sparkling-block-a620qvg4` joining `Organization`
`cf888f2d-f234-48c7-8097-fd5b44b5b3dd` to that `clerkOrgId`). Dev holds
`org_3FhMmIWVjja5HYpsou8n6rVtZn2` and one other. **The incident itself is
recorded accurately** — the browser was on the dev instance, on the 0-store org,
and the roster it showed was the wrong company's. Nothing production-side was
touched (R5, ruled 2026-08-06).

What went wrong is the LABEL. The "9 stores, 6 staff" figures came from a SQL
measurement on branch **dev** (`br-broad-wave-a6vpjdw0`, DEBT-50) — and dev was
forked from production, inheriting its `Organization` rows verbatim,
`clerkOrgId` included. So the id was read off a production-originated row
sitting in the dev database and written down as a dev org. **A Clerk org id
identifies an INSTANCE, not a database branch; a row carrying it proves only
that some fork once held that row.** Clerk-side truth wins over a DB row. This
is § Database Evidence's "A ROW ID DOES NOT IDENTIFY A BRANCH" — which was
written **55 minutes after this passage**, in the same evening's work
(`04388f0` 20:57, `f4648ca` 21:52, both 2026-08-02), and would have caught it.

**Therefore name the INSTANCE as well as the org id.** The org id alone was not
enough here: it was a real id, correctly transcribed, and still put the reader
in the wrong environment.

**The failure mode is the branch-label one exactly, and it is worse in a browser
because more things agree with you.** `/staff` was requested as a correctly
authenticated ADMIN. It returned 200. It rendered a plausible roster. Both orgs
carry `hr` in `activeModules`, so the module gate passed too. Nothing anywhere
errored — and the org was not the one under test.

**The counterfactual is the point of writing this down.** What caught it was a
harness run earlier the same session against a NAMED org id, whose six staff did
not include the member the browser was showing. Without that prior output the
finding would have been filed as *"the Corporate card doesn't render"* — a
Phase 3 defect report about code that was working. An error is cheap; you fix
it and move on. **A wrong answer that looks like a finding costs a whole
investigation, and it argues back**, because every observation supporting it is
real.

Corollary, learned the same hour: **verify the org by a structural fact, not by
its name** — store count, a known member, anything the duplicate does not share.
Two rows answering to "Keva Juice" make the name worthless as a check, and the
app offers no in-app switcher to confirm against (see the org-switcher row in
`docs/ROADMAP.yaml`).

## Verifying a guard covers every path

**YOU CANNOT GREP FOR A MISSING CALL SITE. To verify that a guard covers every
path, enumerate every RENDERER of the shared component — or every CALLER of the
shared route — and check each one. Never conclude coverage from a search for the
guard's own name.**

Recorded 2026-08-15 (HR-11j Item 4). `isSigningBlocked` refuses to start a
signing ceremony on a document version whose detected fields are unconfirmed.
Grepping it returned a **clean** result: one definition, one readiness helper,
callers at the ceremony page and at the mint, all correct. Nothing was out of
place, because the route that was missing the call had nothing to match on.

The uncovered path was `/my/documents/[documentId]`, which imports
`SigningClient` from `(app)/hr/acknowledge/[documentId]/` **across a route-group
boundary**. A signer walked into the ceremony on an unconfirmed version through
that route, initialed four pages and signed two; only the mint-time backstop
stopped a hollow record. The guard had been built on the page that OWNS the
client and was believed to be complete.

**The belief was recorded in a comment, and the comment was true.** It said the
guard "covers BOTH entry points" — meaning the self and attested modes of that
file. It was read as meaning both ceremonies. **A count of entry points taken
from inside one file cannot see the importers outside it**, and a shared client
in a different route group is exactly the importer that does not come to mind.

Note the direction of the failure, which is what makes it expensive: the search
produces a PASS. A grep that finds nothing wrong reads as coverage confirmed, so
the session stops looking. Compare § Staging Verification, where an empty grep
reads as a FAIL and merely wastes an hour — a check that cannot produce a false
pass is a different class of tool from one that can.

**Second time this shape has cost a session.** DEBT-22 swept for unordered
`storeAssignments` loads and correctly reported it had fixed the last one; it
missed a STORE load keyed by assignment ids, because that is not a
`storeAssignments` load and the pattern could not match it (the note lives in
`src/app/(my)/my/documents/[documentId]/page.tsx`). Same lesson at a different
layer: **a sweep is only as complete as the shape it searches for, and the shape
you are searching for is chosen from what you already know exists.**

The reliable procedure, in order:

1. Find every file that renders the shared component or calls the shared route —
   search the COMPONENT'S name, not the guard's.
2. Include importers from other route groups, other directories, and re-exports.
3. Check each one individually for the guard.
4. Only then claim coverage, and say how many paths were checked.

## Git Rules

Claude Code **commits when asked and never pushes** — including when the
target branch is obvious or already checked out. Pushes are Gary's. (Recorded
2026-07-25 after a session pushed `6f70465` to staging unasked; written down
rather than assumed. Everyday flow stays `docs/WORKFLOW.md`.)

**Every end-of-session report ends with an explicit unpushed-commits line:**
whether commits exist on the current branch that are not on its origin remote
(`git log --oneline @{u}..`), listing them if so — even when the answer is
none. This is the structural guard against unpushed work sitting unnoticed
(the F-4 incident), now that pushing is never Claude's to do.

## Commit Gates

**Every commit gate is ONE chained command, and it contains NO PIPES.**

```bash
npx eslint <files this commit touches> && npm run build > /tmp/build.log 2>&1 && git commit -F - <<'EOF'
...
EOF
```

**NO PIPES IN A GATE CHAIN — including for readability.** A pipeline returns the
**last** command's exit code, so `&& npm run build | tail` reports `tail`'s
success and commits on a red build. The pipe does not just shorten the output;
it discards the result the gate exists to check.

If the output is too long to read, **redirect it to a file inside the chain** —
as above — and read the file **afterwards, as a separate command**. Reading the
log is never part of the chain: anything appended after `git commit` runs after
the commit already happened, and anything appended with `;` does not
short-circuit at all.

Recorded 2026-08-01 after the DEBT-SWEEP session appended `| tail` to four gate
chains purely to shorten output. "No pipes" was already the rule; it got bent for
convenience by someone who knew it, which is why the reason is attached to it
now. The gate passed on re-run, so nothing was hidden — that is luck, not
evidence the shortcut is safe.

**No bare `npm run lint`** until DEBT-33's baseline clears: it exits 1 on a clean
checkout (ten errors at time of writing), so any gate containing it can never
reach the commit. **Scoped eslint over the files this commit touches** is the
interim rule. Docs-only commits skip eslint and gate on `npm run build` alone.

## Display-Only Changes — the gate is the test

A **display-only** change is one that cannot alter what any code branches on.
Copy, labels, headings, typos; a separator glyph; a comment or a doc sentence;
spacing, colour, radius or a Tailwind class moving toward § Design System;
spinner → skeleton; an empty-state CTA; an unused import; an auto-fixable lint
rule. Its correctness is visible in the diff and nowhere else.

**For a display-only change, a green commit gate plus the diff read back
against a stated intent is the complete verification. Do not ask Gary to test
one** — not to open a page, not to click through a surface, not to confirm a
choice already made in the row's own notes or in § Design System. State the
choice you made and move on.

**Why this is a bounded exception and not a shortcut.** The verification
protocol in this file — the staging SHA precondition, the named-branch rule for
database evidence, the browser-instance rule — exists because *claims about
deployed behaviour* were built on unlabelled or stale inputs and produced five
coherent, confident, wrong causal chains in one evening (2026-07-28,
`DECISIONS.md`). Every one of those was a claim about a running system. A
display-only change makes no such claim: it is verifiable by reading, and
`next build` typechecks the whole graph before anything commits.

**The boundary, which is the part that keeps this safe.** The protocol binds in
full again the instant a change starts making a claim about a deployed
environment, a database, or what a role may do. If a "cosmetic" change turns
out to need a schema column, an env var, a migration, a Square/Clerk call, or a
product decision about what the right value *is* — it was never display-only.
Stop, revert it, and file or amend the row saying which of those it turned out
to need. Widening this rule to avoid that is the failure mode it is most
exposed to; the escalation is not a defeat, it is the rule working.

**Two adjacent rules survive unchanged and are worth naming here, because a
display-only change is exactly where someone would reach past them.** A text
change inside `docs/prompts/` is still forbidden — a saved prompt is a claim
wholesale (§ Where documents live). And a wording change to a decision record
is display-only in mechanism but not in consequence: reword the *premise* that
was false, never the *ruling*, and say in the commit message which you touched.

**Batch the human check.** Where a display-only change does leave something a
human eye should confirm, it goes into a single list at the end of the run —
route plus the one thing to look at — not a question per change. Changes with
nothing to look at are named as such and left off the list. A padded list
trains the reader to skim it, which costs more than it buys.

Recorded 2026-08-17. The prior habit was per-change confirmation on cosmetic
work, most of which established only that the tree was in sync.

## Module Gating

Modules are gated per-org via `activeModules` on the `Organization` record.
Some add a second server-side env gate (e.g. `HR_MODULE_AVAILABLE`,
`LABOR_MODULE_AVAILABLE`) so in-development work can't surface in prod even if
an org toggles it on.

**Before building any module-gated route, call:**
```ts
import { requireModule } from "@/lib/auth"
await requireModule("inventory") // or "nutrition", "hr"
```

(The feature-gated sidebar-lock convention lives under "Common Patterns" below.)

---

## Square Integration

One OAuth connection per org. Tokens stored encrypted on `Organization.squareAccessToken` / `squareRefreshToken`. All Square API calls use `store.squareLocationId` to scope to the right location.

**Existing Square routes** (`src/app/api/square/`):
- `auth/route.ts` — initiates OAuth redirect
- `callback/route.ts` — exchanges code for tokens
- `disconnect/route.ts` — revokes and clears tokens
- `status/route.ts` — GET connection status
- `locations/route.ts` — GET Square locations list
- `team-members/route.ts` — GET Square team members list

**The requested scopes — six, all reads** (`src/app/api/square/auth/route.ts:9`,
as of SQ-SCOPE-1, 2026-08-18):

`MERCHANT_PROFILE_READ ITEMS_READ ORDERS_READ EMPLOYEES_READ TIMECARDS_READ TIMECARDS_SETTINGS_READ`

The last two were added by SQ-SCOPE-1 for the deferred L-2 labor build, pinned
at source by the LABOR-0B survey (`docs/prompts/LABOR-0B_RESULTS.md` Task 3).
Three things to know before you reason about them:

- **This list is what Froot ASKS FOR, not what any token HOLDS.** Adding a
  string changes the authorize URL only. An already-connected merchant keeps the
  permissions they granted until they re-consent, so a scope can sit in this
  line for weeks while every live call still runs on the older, smaller grant.
  Check the grant, not this line, when a call 403s.
- **`TIMECARDS_READ` IS LIVE (corrected 2026-08-20).** This bullet used to say
  both timecard scopes were "deliberately DORMANT" because `SQUARE_VERSION` was
  "still pinned at `2024-01-17`", below the `2025-05-21` floor the Timecard
  endpoints require. **That version bump landed** — SQ-VER-1 set
  `SQUARE_VERSION` to `2026-01-22` (`src/lib/square.ts:13`), clearing the floor.
  `src/lib/labor-actuals.ts` reads `/v2/labor/timecards/search` on that scope in
  production today, and **scheduled-shift reads ride the same one** —
  `/v2/labor/scheduled-shifts/search` was verified against the live grant on
  2026-08-20 (S1b). `TIMECARDS_SETTINGS_READ` is still unread by any code.
  The dormancy REASONING remains the standing rule for any FUTURE scope: they
  were added while exactly one merchant was connected, which freezes the
  re-consent batch at one person forever (consent economics, Gary 2026-08-18).
- **`REPORTING_READ` is PARKED and must not be added.** Square's Reporting API
  overview mandates it while the OAuth Permissions Reference and the
  `OAuthPermission` enum both omit it; a string absent from the enum cannot go
  in a consent URL. Unresolved — see the L-2 blockers.

Scheduled-shift reads need no extra string (Square documents them under
`TIMECARDS_READ`), and wage / job / pay-rate reads are already covered by the
held `EMPLOYEES_READ`.

**FROOT IS READ-ONLY TOWARD SQUARE — ruled by Gary 2026-08-18
(`docs/DECISIONS.md`, "Froot is read-only toward Square; the name write-back
dies"). Froot reads Square and never writes it. The ONLY exception is the OAuth
connect/disconnect plumbing. No write permission will ever be requested from a
merchant, which means an OAuth scope ending in `_WRITE` is never added to
`src/app/api/square/auth/route.ts` — a write scope and a read-only promise
cannot both be true, and the consent screen is where a merchant reads the
promise.**

The ruling has already been enforced once, in the same session that recorded it:
`staff/[id]/square-writeback` and `updateSquareTeamMemberName` were removed
(SQ-WB-1, work commit `0fd414a`). That was the only path in the codebase that
wrote Square business data. `src/lib/square.ts` now issues no such write — the
two `POST`s left in it are `POST /oauth2/token` (OAuth machinery, excepted) and
`POST /v2/team-members/search`, which is a POST-shaped READ. **If you are about
to add a third non-GET Square call, that is the thing this paragraph exists to
stop.** A name that disagrees with Square is a Froot-side preference stored in
Froot; it is never a push.

**The census is APP-WIDE, not just `src/lib/square.ts`** — taken at `0fd414a`,
because a rule that only holds in the client library invites the next write to
be added in a route file instead. Every outbound Square call in `src/` at that
commit, by method:

- `POST /oauth2/token` — `square.ts:70` (refresh), `square/callback/route.ts:42`
  (code exchange). **OAuth machinery — the excepted case.**
- `POST /v2/team-members/search` (`square.ts:138`), `POST /v2/orders/search`
  (`forecasting/day-report/route.ts:77`, `lib/sales-sync.ts:292`) — **reads.**
  Square's search endpoints take a POST body; the method is not the test, the
  effect is.
- `GET` — `/v2/catalog/list` (`square/catalog/sync`, `square/sales-items/sync`),
  `/v2/locations` (`square/locations/route.ts`, `square.ts:209`),
  `/v2/team-members/{id}` (`square.ts:172`).
- `square/disconnect/route.ts` makes **no outbound call at all** — it clears the
  stored tokens locally.
- `webhooks/square/route.ts` is inbound only.

Nothing writes. To keep that true the question to ask of a new Square call is
not "is it a POST" but **"does it change state on Square's side"** — the two
`/search` endpoints above are exactly why.

**Phase 2 Square routes to add:**
- `square/catalog/sync` — sync catalog items → `ItemMetadata`
- `square/inventory/counts` — fetch current IN_STOCK quantities
- ~~`square/inventory/submit`~~ — **DEAD, 2026-08-18.** Submitting a physical
  count writes inventory to Square. Never built; now never to be built.
- ~~`square/inventory/adjust`~~ — **DEAD, 2026-08-18.** Submitting a
  loss/transfer/prep adjustment writes inventory to Square. Never built; now
  never to be built.
- `square/webhooks` — handle `catalog.version.updated`, `oauth.authorization.revoked`

The two dead entries are struck rather than deleted so that the next person to
plan Phase 2 inventory finds the RULING instead of a gap, and does not re-derive
them from the same reasoning that put them here. **The read half of Phase 2
inventory is untouched and still on:** `catalog/sync` and `inventory/counts`
both only read, so Square-sourced counts can still feed variance. What dies is
Froot submitting the corrected count back — a physical count stays a Froot
record, and Square's inventory is corrected in Square. If that ever needs
revisiting it gets its own ruling, its own consent event, and a real feature
behind it (Gary, same entry).

**Shipped (F-4):** `webhooks/square` — order/payment events keep the current day's
sales caches fresh (signature-verified; see `docs/FORECASTING.md` § Square order webhooks).

Square is entirely optional — all features work without it, import buttons only show when connected.

**Before touching Square scopes, `disconnect`, or anything labor-adjacent, read
the seam design and the five DON'Ts in the `L-2` row of `docs/ROADMAP.yaml`.**
Deferred build, live constraints — the two that fire in unrelated sessions are:
never add an OAuth scope opportunistically (every addition re-consents every
merchant), and never name anything a bare `Shift` (the word is already spent on
`LaborDaypart`'s "Shift blocks" UI and on store-view handoff notes; Square
scheduled shifts are `SquareScheduledShift`). Ruling: `docs/DECISIONS.md`
2026-08-05 — a Square labor integration is strictly optional and can never break
forecast-driven labor.

---

## Instagram Integration

Free org-level integration (Square pattern, **not** `activeModules`). Uses the **Instagram API with Instagram Login** (`graph.instagram.com`) — the Basic Display API is dead (Dec 2024). The connected account must be an Instagram **Professional (Business/Creator)** account. Long-lived token (~60 days) on `Organization.instagramAccessToken`, lazily refreshed (`ig_refresh_token`) when within 7 days of expiry; `instagramEnabled` is the admin on/off toggle for the sidebar item, `/instagram` page, and dashboard strip.

**Routes** (`src/app/api/instagram/`): `auth` (admin, OAuth redirect, scope `instagram_business_basic`) · `callback` (code → short-lived → long-lived token + profile, auto-enables on first connect) · `disconnect` (admin, clears all six `instagram*` fields) · `toggle` (admin, flips `instagramEnabled`) · `status` · `feed` (any org user; cached).

Shared service: `src/lib/instagram.ts`. **Never call Instagram on page load** — the feed is cached in-memory ~60 min per org (rate limit ~200 calls/hour/account) with stale-on-error fallback. `media_url` CDN links expire and must never be persisted; `permalink` is the stable link. instagram.com cannot be iframed — the `/instagram` page renders API data.

Multi-tenant caveat: until Meta App Review grants Advanced Access for `instagram_business_basic`, only Instagram accounts with a role on the Meta app can connect.

---

## Database

Schema is at `prisma/schema.prisma`. Schema changes ship as migration files committed with the code — see `docs/MIGRATIONS.md` for the full policy and history.

**Do not use `npx prisma db push`** — retired after the 2026-07-06 staging drift incident.
**`npx prisma migrate dev` is currently broken** — the baseline squash was never done, so shadow-DB replay fails with P3018 (and `.env` has no `SHADOW_DATABASE_URL`).

The working flow for every schema change (timestamp format `YYYYMMDDHHMMSS`):
```bash
# 1. edit prisma/schema.prisma
# 2. diff the schema against the live dev DB to generate the migration SQL:
npx prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma \
  --script -o prisma/migrations/<timestamp>_<name>/migration.sql
# 3. review the SQL, then apply it and record it in the migrations ledger:
npx prisma db execute --file prisma/migrations/<timestamp>_<name>/migration.sql
npx prisma migrate resolve --applied <timestamp>_<name>
# 4. regenerate the client:
npx prisma generate
```

Commit the migration folder with the code that uses it. Staging and production apply it via `prisma migrate deploy` in the Vercel build — never run migrations against those branches by hand.

`npx prisma studio` — GUI to inspect data.

Run `next build` — it runs `prisma generate` automatically (see `package.json` build script).

---

## Environment Variables

**Never run `vercel env pull` in this repo. No exceptions — not staging, not
preview, not production. Database reads for every deployed environment go
through the Neon console.**

No deployed-environment credential is written to disk — not to the working tree,
not to a scratchpad, not to a file you intend to delete afterwards. If a task
needs data from a deployed environment, either derive it from the code paths or
ask Gary to run the query in the Neon console and paste the result. Read-only
access is not an exception: the PERM-7 pre-flight audit was strictly read-only,
produced findings that changed the phase, and was still the wrong method (Gary,
2026-07-28 — `DECISIONS.md`).

**The trap:** `DATABASE_URL` is marked Sensitive in Vercel and pulls as the
literal `[SENSITIVE]`, so production *looks* unreachable from a dev machine.
`DATABASE_URL_UNPOOLED` is **not** Sensitive and pulls a live production
connection string. Vercel will not accept the type change on it — see `DEBT-4`
— so **this rule is the mitigation. There is no platform setting behind it.**

The ban is total by ruling (Gary, 2026-07-28), after a first draft of this
section carved out staging. Staging's `DATABASE_URL` is genuinely not Sensitive
and does pull, which is exactly why the carve-out was tempting and exactly why
it is not allowed: a rule with an exception is one `--environment` flag away
from the thing it forbids. **One narrow exception has since been granted and
recorded — `DECISIONS.md`, "Staging probe exception, schedule payload
discovery" (2026-08-20); it covers that one probe only, and any future need is
its own ruling (corrected 2026-08-20, so the two documents no longer
contradict).**

### Provisioning a secret that will ever be presented by hand

**A Vercel variable marked Sensitive can NEVER be revealed after it is saved —
not in the dashboard, not by the CLI, not by the API. So any secret that will
ever be typed, curled or pasted by a human — `CRON_SECRET` and every manual API
auth value — must be recorded in Gary's password manager AT CREATION, in the
same minute it is saved.** There is no recovery step later; the only remedy for
a value nobody kept is to overwrite it, which means redeploying everything that
holds it. And the ritual for rotating one has an order that matters: **save the
value in the dashboard → redeploy the TARGET branch, reading the branch column
before you click → verify the new deployment's created time POSTDATES the save →
only then fire the request.** A deployment carries the env values that existed
when it was BUILT, so a redeploy that predates the save serves the old secret and
returns a 401 that looks exactly like a wrong value — which is the measured
failure this paragraph comes from: `docs/prompts/CRON-DIAG_findings.md`, where a
staging deployment built 1 h 33 m before the Preview edit spent an afternoon
being diagnosed as a scoping problem. Three of that day's four redeploys also
went to the wrong branch, which is why "read the branch column" is written down
rather than assumed.

Required in `.env`:
```
DATABASE_URL=                  # Neon connection string (pooled) — runtime client
DATABASE_URL_UNPOOLED=         # direct (non-pooled) Neon endpoint — Prisma CLI/migrations only (BUG-3); strip -pooler from the DATABASE_URL host
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=
CLERK_SECRET_KEY=
CLERK_WEBHOOK_SECRET=          # Svix signature for Clerk webhooks
SQUARE_APPLICATION_ID=
SQUARE_APPLICATION_SECRET=
SQUARE_ENVIRONMENT=            # "sandbox" or "production"
NEXT_PUBLIC_APP_URL=           # e.g. https://www.usefroot.com
CRON_SECRET=                   # auth for /api/cron/* (Vercel sends it on cron invocations)
SQUARE_WEBHOOK_SIGNATURE_KEY=  # per-app webhook subscription key (docs/FORECASTING.md § Square order webhooks)
PACE_ALERT_THRESHOLD_PCT=      # optional — behind-pace alert threshold, default 90 (docs/FORECASTING.md § Hardening)
INSTAGRAM_APP_ID=              # Instagram app ID from the Meta app (Instagram API with Instagram Login)
INSTAGRAM_APP_SECRET=
INSTAGRAM_REDIRECT_URI=        # optional — defaults to ${NEXT_PUBLIC_APP_URL}/api/instagram/callback
HR_MODULE_AVAILABLE=           # optional — "true" makes the HR module exist in this environment (staging/preview yes, production unset until launch)
HR_INTERNAL_ORG_IDS=           # optional — comma-separated Clerk org IDs allowed HR in production before launch (dogfooding)
HR_BLOB_READ_WRITE_TOKEN=      # RW token for the PRIVATE froot-hr Blob store (HR documents) — distinct from BLOB_READ_WRITE_TOKEN (public store). Injected by the store connection on Vercel; src/lib/hr-files.ts passes it explicitly on every Blob call.
LABOR_MODULE_AVAILABLE=        # optional — "true" makes the Weekly Labor Model exist in this environment (staging/preview yes, production unset until launch). See docs/LABOR.md.
LABOR_INTERNAL_ORG_IDS=        # optional — comma-separated Clerk org IDs allowed Labor in production before launch (dogfooding), mirrors HR_INTERNAL_ORG_IDS
```

---

## Common Patterns

**Client component fetching data:**
```tsx
"use client"
import { useEffect, useState } from "react"

export function StoreList() {
  const [stores, setStores] = useState([])
  useEffect(() => {
    fetch("/api/stores").then(r => r.json()).then(setStores)
  }, [])
  // ...
}
```

**Zod + React Hook Form:**
```tsx
const schema = z.object({ name: z.string().min(1) })
const form = useForm({ resolver: zodResolver(schema) })
```

**Feature-gated sidebar link:** Show lock icon if module not in `activeModules`. Clicking opens upgrade prompt instead of navigating.

**Upgrade prompt:** Full-page card explaining the feature, current plan, and a "Upgrade Plan" CTA linking to `/settings/billing`.
