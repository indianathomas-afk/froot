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

### Phase 1 — Complete ✅
All core pages are built and deployed:
- `/dashboard` — KPI cards, quick action links
- `/checklists` — list with store/date filters, status badges
- `/templates` and `/templates/[id]/edit` — template list + task builder
- `/stores` — store cards, Square import modal
- `/users` — role management table
- `/staff` — staff list grouped by store, Square import modal
- `/reports` — store performance table with filters
- `/store-view` — staff-facing checklist execution (mobile-optimized)
- `/settings` — Square connection, org info, billing stubs
- `/print/template/[id]` — print/PDF page, auto-fires `window.print()` on load
- Square OAuth: connect, callback, disconnect, locations import, team members import
- Clerk webhook handler at `/api/webhooks/clerk`

### Phase 2 — Not Started ❌
These modules are gated behind `activeModules` on the `Organization` record. All Phase 2 DB models exist in the schema for forward compatibility, but no application code reads/writes them yet.

**Inventory module** (`activeModules.includes("inventory")`):
- `/inventory` — dashboard with sitting value, COGS, chart
- `/inventory/items` — catalog item manager (synced from Square)
- `/inventory/storage-areas` — custom physical locations per store
- `/inventory/counts/new` — physical count workflow
- `/inventory/history` — completed count list
- `/inventory/expected` — theoretical vs actual stock report
- `/inventory/cogs` — COGS report with CSV export
- `/inventory/adjustments` — loss, transfer, prep deduction

**Nutrition module** (`activeModules.includes("nutrition")`):
- `/nutrition/menu` — menu item manager
- `/nutrition/menu/[id]` — nutrition facts editor with live label preview
- `/menu/[orgSlug]` — public nutrition page (SSR, no auth, embeddable via iframe)

**Before building any Phase 2 route, call:**
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

Schema is at `prisma/schema.prisma`. Key commands:
```bash
npx prisma migrate dev      # create and apply a migration
npx prisma db push          # push schema without migration (for fast iteration)
npx prisma generate         # regenerate client after schema changes
npx prisma studio           # GUI to inspect data
```

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
