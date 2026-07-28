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
