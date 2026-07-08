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

**See `ROADMAP.md` for the current phase table — it is the single source of truth for build status.**

At the end of every phase: update `ROADMAP.md` (status, commit hash, one-line notes) and commit it with the phase's code. Do not track phase status here.

Phase 2 modules are gated behind `activeModules` on the `Organization` record.

**Before building any module-gated route, call:**
```ts
import { requireModule } from "@/lib/auth"
await requireModule("inventory") // or "nutrition"
```

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

Square is entirely optional — all features work without it, import buttons only show when connected.

---

## Database

Schema is at `prisma/schema.prisma`. Schema changes ship as migration files committed with the code — see `MIGRATIONS.md` for the full policy and history.

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

Required in `.env`:
```
DATABASE_URL=                  # Neon connection string
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=
CLERK_SECRET_KEY=
CLERK_WEBHOOK_SECRET=          # Svix signature for Clerk webhooks
SQUARE_APPLICATION_ID=
SQUARE_APPLICATION_SECRET=
SQUARE_ENVIRONMENT=            # "sandbox" or "production"
NEXT_PUBLIC_APP_URL=           # e.g. https://www.usefroot.com
CRON_SECRET=                   # auth for /api/cron/* (Vercel sends it on cron invocations)
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
