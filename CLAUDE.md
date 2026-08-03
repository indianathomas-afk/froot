@AGENTS.md

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

**Update it before the session ends** — see "Session completion rules" in
`docs/WORKFLOW.md`.

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

## Staging Verification — Precondition

**Before verifying anything on staging, confirm the deployed commit SHA matches
local `HEAD`. If it does not, STOP and push first. This is a precondition, not a
checklist item.**

```bash
git rev-parse --short HEAD                      # what you think you are testing
npx vercel inspect <staging-alias> --json | grep -i githubCommitSha
```

If the SHAs differ, every observation is about different code and the entire
pass is void — including the passes, not just the failures.

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

## Browser Evidence — Precondition

**Every observation taken in a browser must name the ORGANIZATION ID it was
taken under, on the same line as the observation. A screenshot or a page reading
without a named org id does not count.** This is the § Database Evidence rule
applied to the other place evidence is gathered: there the under-specified
identifier is the branch, here it is the active Clerk org.

```
org_3FhYUR4l0ue7egug1I0Ig8wxOVn  /staff → nine store cards + Corporate   ← usable
                                 /staff → one Unassigned card            ← not evidence
```

Recorded 2026-08-02 during DEBT-9 Phase 3. Dev holds **two organizations both
named "Keva Juice"** — `org_3FhYUR4l0ue7egug1I0Ig8wxOVn` (9 stores, 6 staff) and
`org_3FhMmIWVjja5HYpsou8n6rVtZn2` (0 stores, 1 staff) — so a session can be on
the wrong one while every visible signal says it is fine.

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

**Phase 2 Square routes to add:**
- `square/catalog/sync` — sync catalog items → `ItemMetadata`
- `square/inventory/counts` — fetch current IN_STOCK quantities
- `square/inventory/submit` — submit physical count via `batch-create`
- `square/inventory/adjust` — submit loss/transfer/prep adjustment
- `square/webhooks` — handle `catalog.version.updated`, `oauth.authorization.revoked`

**Shipped (F-4):** `webhooks/square` — order/payment events keep the current day's
sales caches fresh (signature-verified; see `docs/FORECASTING.md` § Square order webhooks).

Square is entirely optional — all features work without it, import buttons only show when connected.

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
from the thing it forbids.

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
