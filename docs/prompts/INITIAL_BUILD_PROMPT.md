# Froot App — Claude Build Prompt

You are an expert full-stack developer and UI/UX engineer. Your task is to build **Froot** as a standalone, independent web application from scratch. I will provide you with screenshots, design tokens, and a detailed feature breakdown of the reference app. You must recreate it with exact pixel-perfect fidelity while ensuring the backend, data models, and third-party integrations are robust and scalable.

This prompt is organized into two phases. **Phase 1** covers the core operational platform (checklists, templates, stores, staff, and reporting). **Phase 2** covers the optional add-on modules (Inventory Management and Nutritional Information), which are gated behind a separate subscription tier. Build Phase 1 completely before beginning Phase 2.

---

## 1. Project Overview & Core Value Proposition

**Froot** (Framework for Routine Operations & Organizational Tasks) is an operational execution and accountability platform designed for multi-store franchises. It assumes staffing and location data may already exist in Square (or can be entered manually) and focuses purely on operational execution and accountability.

**Key Value Propositions:**
- **Multi-Store Execution:** Run daily operations across all locations with consistent standards and real-time visibility.
- **Real-Time Accountability:** Track who did what, when, with photo proof and temperature logs for every critical task.
- **Operational Templates:** Define how work should be done with templates for opening, closing, cleaning, and audits.
- **Audit-Ready Reporting:** Compliance reports, completion trends, and operational insights ready for review anytime.
- **Optional Add-Ons (Phase 2):** Inventory Management and Nutritional Information modules, available as a paid subscription upgrade.

---

## 2. Required Tech Stack

Build this application using the following exact stack. Do not substitute any of these dependencies.

### Framework & Runtime
- **Next.js 16** (React 19) — App Router, server components, API routes under `src/app/api/`
- **TypeScript 5**
- **Tailwind CSS 4**

### Authentication
- **Clerk** (`@clerk/nextjs ^7.5.6`) — handles sign-up, sign-in, session management, and organization (multi-tenant) support.
  - The `clerkOrgId` on each `Organization` record links Clerk orgs to your database tenants.
  - Webhooks are received via **Svix** (`svix` package) for Clerk event validation.
  - Use Clerk's built-in organization features so each Froot customer (e.g., a franchise group) is an isolated tenant.

### Database
- **PostgreSQL** hosted on **Neon** (`@neondatabase/serverless`) — serverless Postgres provider.
- **Prisma 7** as the ORM, using `@prisma/adapter-neon` to connect over Neon's HTTP/WebSocket serverless driver.

### Third-Party Integrations
- **Square** — Location, Team Member, Catalog, and Inventory data via the [Square Developer API](https://developer.squareup.com/us/en). The **single Square OAuth connection** established in Phase 1 is reused by Phase 2. No second OAuth flow is needed.
- **Square Billing** — `squareCustomerId`, `squareSubscriptionId`, `subscriptionStatus`, and `activeModules` fields on the `Organization` model for subscription and feature-flag management.

### Data Processing & Forms
- **React Hook Form** + **Zod** for all form validation.
- **PapaParse** — CSV parsing support (for inventory imports and exports).
- **xlsx** — Excel file support (for data exports/imports).

### Dev Tooling
- `prisma studio` / `prisma migrate dev` / `prisma db push` for schema management.
- `ts-node` for seed scripts.
- **ESLint 9** with `eslint-config-next`.
- **shadcn/ui** components, **Lucide** icons.

---

## 3. Design System & UI Tokens

The app uses a clean, modern, slightly warm color palette. Replicate these tokens exactly.

### Color Palette (`tailwind.config.ts`)
```ts
export default {
  theme: {
    extend: {
      colors: {
        background:          'oklch(97% .02 65)',   // Warm off-white — page background
        foreground:          'oklch(18% .03 50)',   // Dark warm text
        card:                'oklch(99% .01 65)',   // White card surfaces
        cardForeground:      'oklch(18% .03 50)',
        popover:             'oklch(99% .01 65)',
        popoverForeground:   'oklch(18% .03 50)',
        primary:             'oklch(65% .2 35)',    // Brand orange-red — buttons, icons, accents
        primaryForeground:   'oklch(98% .01 65)',
        secondary:           'oklch(93% .02 65)',
        secondaryForeground: 'oklch(25% .03 50)',
        muted:               'oklch(90% .02 65)',
        mutedForeground:     'oklch(45% .03 50)',
        accent:              'oklch(90% .02 65)',
        accentForeground:    'oklch(18% .03 50)',
        destructive:         'oklch(57.7% .245 27.325)', // Red — errors, critical tasks
        destructiveForeground: 'oklch(98.5% 0 0)',
        border:              'oklch(85% .02 65)',
        input:               'oklch(85% .02 65)',
        ring:                'oklch(65% .2 35)',
        // Semantic status colors
        success: {
          DEFAULT: '#25ba3b',
          bg:     'hsl(143, 85%, 96%)',
          border: 'hsl(145, 92%, 87%)',
          text:   'hsl(140, 100%, 27%)',
        },
        warning: {
          DEFAULT: '#efa201',
          bg:     'hsl(49, 100%, 97%)',
          border: 'hsl(49, 91%, 84%)',
          text:   'hsl(31, 92%, 45%)',
        },
        info: {
          DEFAULT: '#0081f2',
          bg:     'hsl(208, 100%, 97%)',
          border: 'hsl(221, 91%, 93%)',
          text:   'hsl(210, 92%, 45%)',
        },
      },
      borderRadius: {
        lg: '0.65rem',
        md: 'calc(0.65rem - 2px)',
        sm: 'calc(0.65rem - 4px)',
      },
    },
  },
}
```

### Typography
- **Font Family:** `ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif`
- **Weights used:** 400 (Normal), 500 (Medium), 600 (Semibold), 700 (Bold).

### Layout
- Fixed left sidebar navigation (collapsible on mobile).
- Main content area with a comfortable max-width container.
- Cards with subtle `border` and `shadow-sm` for data presentation.

---

## 4. Database Schema (Prisma)

Design the Prisma schema to support all Phase 1 and Phase 2 models. All models belong to an `Organization` (multi-tenant isolation via Clerk). Phase 2 models are clearly marked — include them in the initial schema migration so the database is forward-compatible, but the application code that reads/writes them must be gated behind the `activeModules` feature flag check.

```prisma
// ─── CORE (Phase 1) ──────────────────────────────────────────────────────────

model Organization {
  id                   String    @id @default(cuid())
  clerkOrgId           String    @unique
  name                 String
  squareCustomerId     String?
  squareSubscriptionId String?
  subscriptionStatus   String?   @default("inactive")
  activeModules        String[]  @default([])  // e.g. ["inventory", "nutrition"]
  squareAccessToken    String?   // Encrypted
  squareRefreshToken   String?   // Encrypted
  squareTokenExpiresAt DateTime?
  createdAt            DateTime  @default(now())

  stores               Store[]
  users                User[]
  staff                StaffMember[]
  templates            Template[]
  checklists           Checklist[]
  // Phase 2 relations
  storageAreas         StorageArea[]
  inventoryCounts      InventoryCount[]
  itemMetadata         ItemMetadata[]
  menuItems            MenuItem[]
}

model User {
  id               String   @id @default(cuid())
  clerkUserId      String   @unique
  organizationId   String
  email            String
  name             String?
  role             Role     @default(STAFF)
  createdAt        DateTime @default(now())

  organization     Organization          @relation(fields: [organizationId], references: [id])
  storeAssignments StoreUserAssignment[]
  taskLogs         TaskLog[]
}

model Store {
  id               String   @id @default(cuid())
  organizationId   String
  squareLocationId String?  @unique  // Square Location ID if imported
  storeNumber      String?
  name             String
  brand            String?
  address          String?
  city             String?
  state            String?
  zip              String?
  timezone         String   @default("America/Los_Angeles")
  contactEmail     String?
  phoneNumber      String?
  isActive         Boolean  @default(true)
  createdAt        DateTime @default(now())

  organization        Organization              @relation(fields: [organizationId], references: [id])
  hours               StoreHours[]
  userAssignments     StoreUserAssignment[]
  staffAssignments    StoreStaffAssignment[]
  templateAssignments TemplateStoreAssignment[]
  checklists          Checklist[]
  // Phase 2 relations
  storageAreas        StorageArea[]
  inventoryCounts     InventoryCount[]
}

model StoreHours {
  id          String  @id @default(cuid())
  storeId     String
  dayOfWeek   Int     // 0=Sun … 6=Sat
  openingTime String? // "07:00"
  closingTime String? // "20:00"
  isClosed    Boolean @default(false)

  store       Store @relation(fields: [storeId], references: [id], onDelete: Cascade)
}

model StoreUserAssignment {
  id      String @id @default(cuid())
  userId  String
  storeId String
  user    User   @relation(fields: [userId], references: [id], onDelete: Cascade)
  store   Store  @relation(fields: [storeId], references: [id], onDelete: Cascade)
  @@unique([userId, storeId])
}

model StaffMember {
  id                 String   @id @default(cuid())
  organizationId     String
  squareTeamMemberId String?  @unique
  displayName        String
  fullName           String?
  email              String?
  createdAt          DateTime @default(now())

  organization     Organization           @relation(fields: [organizationId], references: [id])
  storeAssignments StoreStaffAssignment[]
  taskLogs         TaskLog[]
}

model StoreStaffAssignment {
  id            String      @id @default(cuid())
  staffMemberId String
  storeId       String
  staffMember   StaffMember @relation(fields: [staffMemberId], references: [id], onDelete: Cascade)
  store         Store       @relation(fields: [storeId], references: [id], onDelete: Cascade)
  @@unique([staffMemberId, storeId])
}

model Template {
  id               String   @id @default(cuid())
  organizationId   String
  name             String
  description      String?
  type             String   // "Opener" | "Closer" | "Mid-Shift" | "Cleaning" | "Audit"
  frequency        String   @default("Daily")
  availabilityType String   @default("StoreHours")
  operationalPhase String?
  startOffsetHours Int?
  endOffsetHours   Int?
  isActive         Boolean  @default(true)
  createdAt        DateTime @default(now())

  organization     Organization              @relation(fields: [organizationId], references: [id])
  storeAssignments TemplateStoreAssignment[]
  tasks            Task[]
  checklists       Checklist[]
}

model TemplateStoreAssignment {
  id         String   @id @default(cuid())
  templateId String
  storeId    String
  template   Template @relation(fields: [templateId], references: [id], onDelete: Cascade)
  store      Store    @relation(fields: [storeId], references: [id], onDelete: Cascade)
  @@unique([templateId, storeId])
}

model Task {
  id                   String   @id @default(cuid())
  templateId           String
  sectionName          String
  description          String
  estimatedTimeMinutes Int?
  requiresPhoto        Boolean  @default(false)
  requiresTemp         Boolean  @default(false)
  isCritical           Boolean  @default(false)
  orderIndex           Int      @default(0)
  excludedStoreIds     String[]

  template   Template  @relation(fields: [templateId], references: [id], onDelete: Cascade)
  taskLogs   TaskLog[]
}

model Checklist {
  id             String    @id @default(cuid())
  organizationId String
  templateId     String
  storeId        String
  date           DateTime
  status         String    @default("Pending")
  startedAt      DateTime?
  completedAt    DateTime?
  completionRate Float?    @default(0)

  organization   Organization @relation(fields: [organizationId], references: [id])
  template       Template     @relation(fields: [templateId], references: [id])
  store          Store        @relation(fields: [storeId], references: [id])
  taskLogs       TaskLog[]
}

model TaskLog {
  id                 String      @id @default(cuid())
  checklistId        String
  taskId             String
  completedByUserId  String?
  completedByStaffId String?
  completedAt        DateTime    @default(now())
  photoUrl           String?
  temperatureValue   Float?
  notes              String?

  checklist        Checklist    @relation(fields: [checklistId], references: [id], onDelete: Cascade)
  task             Task         @relation(fields: [taskId], references: [id])
  completedByUser  User?        @relation(fields: [completedByUserId], references: [id])
  completedByStaff StaffMember? @relation(fields: [completedByStaffId], references: [id])
}

model AuditLog {
  id             String   @id @default(cuid())
  organizationId String
  userId         String?
  action         String
  entityType     String
  entityId       String?
  metadata       Json?
  createdAt      DateTime @default(now())
}

enum Role {
  ADMIN
  MANAGER
  STAFF
  STORE
}

// ─── PHASE 2: INVENTORY MODULE ────────────────────────────────────────────────
// These models are included in the schema from day one for forward compatibility.
// All application code that reads/writes these models MUST check:
//   organization.activeModules.includes("inventory")
// before executing. If the module is not active, return a 403 or redirect to the upgrade page.

model StorageArea {
  id             String   @id @default(cuid())
  organizationId String
  storeId        String
  name           String   // e.g. "Two Door Freezer", "Back of House"
  sortOrder      Int      @default(0)
  createdAt      DateTime @default(now())

  organization      Organization           @relation(fields: [organizationId], references: [id])
  store             Store                  @relation(fields: [storeId], references: [id], onDelete: Cascade)
  itemMappings      ItemStorageMapping[]
  countLines        InventoryCountLine[]
}

model ItemStorageMapping {
  id                  String @id @default(cuid())
  storageAreaId       String
  squareCatalogObjId  String // Square CatalogItemVariation ID
  sortOrder           Int    @default(0)

  storageArea         StorageArea @relation(fields: [storageAreaId], references: [id], onDelete: Cascade)
  @@unique([storageAreaId, squareCatalogObjId])
}

model ItemMetadata {
  id                  String   @id @default(cuid())
  organizationId      String
  squareCatalogObjId  String   // Square CatalogItemVariation ID — the single source of truth for item identity
  vendorName          String?
  glCode              String?
  parLevel            Float?
  unitCostOverride    Float?   // Overrides Square's price if set
  unitOfMeasure       String?  // e.g. "oz", "case", "each"
  notes               String?
  updatedAt           DateTime @updatedAt

  organization        Organization @relation(fields: [organizationId], references: [id])
  @@unique([organizationId, squareCatalogObjId])
}

model InventoryCount {
  id                  String    @id @default(cuid())
  organizationId      String
  storeId             String
  startedAt           DateTime  @default(now())
  finalizedAt         DateTime?
  completedByUserIds  String[]
  sittingInventoryVal Float?    // Calculated on finalization
  status              String    @default("Draft") // "Draft" | "Finalized"

  organization        Organization         @relation(fields: [organizationId], references: [id])
  store               Store                @relation(fields: [storeId], references: [id])
  lines               InventoryCountLine[]
}

model InventoryCountLine {
  id                 String  @id @default(cuid())
  inventoryCountId   String
  storageAreaId      String?
  squareCatalogObjId String
  itemName           String
  unitOfMeasure      String?
  quantityCounted    Float
  unitCost           Float?
  lineValue          Float?  // quantityCounted × unitCost
  usageVariance      Float?  // previousCount + deliveries − currentCount

  inventoryCount     InventoryCount @relation(fields: [inventoryCountId], references: [id], onDelete: Cascade)
  storageArea        StorageArea?   @relation(fields: [storageAreaId], references: [id])
}

// ─── PHASE 2: NUTRITION MODULE ────────────────────────────────────────────────
// All application code that reads/writes these models MUST check:
//   organization.activeModules.includes("nutrition")
// before executing.

model MenuItem {
  id             String   @id @default(cuid())
  organizationId String
  // Optionally linked to a Square catalog item — null if manually created
  squareCatalogObjId String?
  name           String
  description    String?
  category       String?
  isActive       Boolean  @default(true)
  createdAt      DateTime @default(now())

  organization   Organization      @relation(fields: [organizationId], references: [id])
  nutrition      MenuItemNutrition?
  allergens      MenuItemAllergen[]
}

model MenuItemNutrition {
  id              String  @id @default(cuid())
  menuItemId      String  @unique
  servingSize     String? // e.g. "16 oz"
  calories        Int?
  totalFatG       Float?
  saturatedFatG   Float?
  transFatG       Float?
  cholesterolMg   Float?
  sodiumMg        Float?
  totalCarbG      Float?
  dietaryFiberG   Float?
  totalSugarsG    Float?
  addedSugarsG    Float?
  proteinG        Float?
  vitaminDMcg     Float?
  calciumMg       Float?
  ironMg          Float?
  potassiumMg     Float?

  menuItem        MenuItem @relation(fields: [menuItemId], references: [id], onDelete: Cascade)
}

model MenuItemAllergen {
  id         String  @id @default(cuid())
  menuItemId String
  allergen   String  // "Milk" | "Eggs" | "Fish" | "Shellfish" | "Tree Nuts" | "Peanuts" | "Wheat" | "Soybeans" | "Sesame"
  menuItem   MenuItem @relation(fields: [menuItemId], references: [id], onDelete: Cascade)
  @@unique([menuItemId, allergen])
}
```

---

## 5. Square API Integration

**Important:** There is a single Square OAuth connection per Organization. The same access token and the same `squareAccessToken` / `squareRefreshToken` fields on `Organization` are used by both Phase 1 (locations/team members) and Phase 2 (catalog/inventory). Do not create a second OAuth flow for Phase 2. Simply add the additional scopes to the initial authorization request so they are granted at first connect.

### 5a. Square OAuth Flow (Unified)
Implement a standard Square OAuth 2.0 Authorization Code Flow:
1. Admin navigates to **Settings → Integrations → Square**.
2. Clicking "Connect Square" redirects to Square's OAuth authorization URL.
3. After authorization, Square redirects back to `/api/square/callback`.
4. The server exchanges the code for tokens and stores them (encrypted) on the `Organization` record.
5. The Settings page shows a "Connected" badge with the Square merchant name.

**All required OAuth scopes (Phase 1 + Phase 2 combined):**

| Scope | Used By |
|---|---|
| `MERCHANT_PROFILE_READ` | Phase 1 — merchant name |
| `EMPLOYEES_READ` | Phase 1 — team member import |
| `TEAM_MEMBERS_READ` | Phase 1 — team member import |
| `PAYMENTS_READ` | Phase 1 — billing |
| `ITEMS_READ` | Phase 2 — catalog sync |
| `ITEMS_WRITE` | Phase 2 — catalog updates |
| `INVENTORY_READ` | Phase 2 — inventory counts |
| `INVENTORY_WRITE` | Phase 2 — submit counts, adjustments |
| `ORDERS_READ` | Phase 2 — COGS calculation |

Request all scopes at initial connection even if Phase 2 is not yet active. This avoids requiring the user to re-authorize when they upgrade.

### 5b. Token Refresh
Access tokens expire after 30 days. Implement a middleware function that automatically refreshes the token when it is within 24 hours of expiry. Handle the `oauth.authorization.revoked` webhook event to clear tokens and mark the org as disconnected.

### 5c. Import Locations from Square
After connecting Square, the user can navigate to **Stores** and click **"Import from Square"**. This calls `GET /v2/locations` and presents a selection modal. On confirm, create `Store` records mapping:

| Square Field | Froot Field |
|---|---|
| `location.id` | `squareLocationId` |
| `location.name` | `name` |
| `location.address.address_line_1` | `address` |
| `location.address.locality` | `city` |
| `location.address.administrative_district_level_1` | `state` |
| `location.address.postal_code` | `zip` |
| `location.timezone` | `timezone` |
| `location.phone_number` | `phoneNumber` |
| `location.business_hours.periods` | `StoreHours[]` |

Stores already imported (matched by `squareLocationId`) show an "Already imported" badge and are skipped on re-import.

### 5d. Import Team Members from Square
After connecting Square, the user can navigate to **Staff** and click **"Import from Square"**. This calls `GET /v2/team-members` and presents a selection modal. On confirm, create `StaffMember` records mapping:

| Square Field | Froot Field |
|---|---|
| `team_member.id` | `squareTeamMemberId` |
| `team_member.display_name` | `displayName` |
| `team_member.given_name + family_name` | `fullName` |
| `team_member.email_address` | `email` |

### 5e. Manual Entry Fallback
**Square is entirely optional.** If a user does not use Square or chooses not to connect it, all "Import from Square" buttons are hidden or replaced with a "Connect Square to enable import" prompt. All data can be created and managed manually. No Square connection is required to use any feature of the app.

### 5f. Square API Route Structure
```
src/app/api/square/
  auth/route.ts                    — Initiates OAuth redirect (all scopes)
  callback/route.ts                — Handles callback, stores tokens
  disconnect/route.ts              — Revokes token, clears org fields
  status/route.ts                  — GET: connection status for the org
  locations/route.ts               — GET: fetch locations from Square
  locations/import/route.ts        — POST: import selected locations to DB
  team-members/route.ts            — GET: fetch team members from Square
  team-members/import/route.ts     — POST: import selected team members to DB
  // Phase 2 — only callable when "inventory" module is active
  catalog/sync/route.ts            — POST: sync catalog items from Square to ItemMetadata
  inventory/counts/route.ts        — GET: fetch current IN_STOCK counts from Square
  inventory/submit/route.ts        — POST: submit physical count to Square
  inventory/adjust/route.ts        — POST: submit loss/transfer/prep adjustment to Square
  webhooks/route.ts                — POST: handle Square webhook events
```

---

## 6. Subscription & Feature Gating

Froot uses a tiered subscription model. Phase 2 features are optional add-ons.

### 6a. Subscription Tiers

| Tier | Modules Included | `activeModules` Value |
|---|---|---|
| **Core** | Checklists, Templates, Stores, Staff, Reports | `[]` |
| **Core + Inventory** | All Core features + Inventory Management | `["inventory"]` |
| **Core + Nutrition** | All Core features + Nutritional Info | `["nutrition"]` |
| **Full Suite** | All modules | `["inventory", "nutrition"]` |

### 6b. Feature Gate Implementation
Create a reusable server-side helper:

```ts
// src/lib/feature-gate.ts
import { auth } from '@clerk/nextjs/server'
import { prisma } from '@/lib/prisma'

export async function requireModule(module: 'inventory' | 'nutrition') {
  const { orgId } = await auth()
  if (!orgId) throw new Error('Unauthorized')

  const org = await prisma.organization.findUnique({
    where: { clerkOrgId: orgId },
    select: { activeModules: true },
  })

  if (!org?.activeModules.includes(module)) {
    throw new Error(`MODULE_NOT_ACTIVE:${module}`)
  }
}
```

All Phase 2 API routes and server actions must call `requireModule('inventory')` or `requireModule('nutrition')` at the top before any logic executes.

### 6c. Upgrade Prompt UI
When a user navigates to a Phase 2 page without the required module active, display a full-page upgrade prompt card instead of the page content. The card should:
- Describe the feature and its benefits.
- Show the current plan and what the upgrade includes.
- Include a "Upgrade Plan" CTA button that links to `/settings/billing`.

### 6d. Sidebar Navigation Gating
Phase 2 sidebar links (Inventory, Nutrition) should be visible to all users but display a lock icon badge if the module is not active. Clicking a locked link shows the upgrade prompt.

---

## 7. Phase 1 — Core Pages & Features

I will provide screenshots for all of these pages. Recreate their layouts and functionality exactly.

### A. Navigation & Shell
- Fixed left sidebar with links: Dashboard, Checklists, Templates, Stores, Users, Staff, Reports, Store View, Settings.
- User profile section at the bottom of the sidebar (Clerk `<UserButton>`).
- Clerk `<OrganizationSwitcher>` in the sidebar header for multi-tenant switching.

### B. Dashboard (`/dashboard`)
- KPI Cards: Active Stores, Today's Checklists, Completed, Compliance Rate.
- Quick action cards linking to: Manage Stores, Checklist Templates, Daily Checklists.

### C. Store View (`/store-view` & `/staff/:id`)
- **Store Selector:** Dropdown to preview what staff see at a specific location.
- **Available Checklists:** List of checklists generated for the day based on templates and store hours. Shows task count and estimated time. "Start Checklist" button.
- **Checklist Execution View:**
  - Header with checklist name, store, shift type, estimated time, and overall progress (e.g., "0 / 31").
  - Tasks grouped by `sectionName` (e.g., Restocking, Cleaning, Sanitation).
  - Each section shows progress (e.g., "0 of 5 completed").
  - Task items are clickable rows with a checkbox, description, and time estimate.
  - Critical tasks display a "⚠️ CRITICAL" badge.
  - Tasks requiring photos show a "Take Photo" button.
  - Bottom sticky bar with a "Submit" button showing current progress.
  - Fully mobile-optimized with large tap targets (minimum 44px).

### D. Templates Management (`/templates` & `/templates/:id/edit`)
- **List View:** Table showing Name, Type, When it runs, Status, and actions (View, Edit, Duplicate, Delete).
- **Create/Edit View:** Name, Description, Frequency, Availability, Operational Phase, Start/End offsets, Store Assignment, and a dynamic Task Builder with per-task toggles.

### E. Checklists Overview (`/checklists`)
- List of all generated checklists across all stores for a given day.
- Filters for Store and Date. Status badges: Not Started, In Progress, Completed, Non-Compliant.

### F. Stores Management (`/stores`)
- Store location cards with address, hours, timezone, contact email, and "Has Account" badge.
- Actions: Edit Hours, Edit Store, Delete.
- "Import from Square" button in the page header (visible only if Square is connected).

### G. Users & Staff (`/users`, `/staff`)
- **Users:** Table with inline role-change dropdowns.
- **Staff:** Grouped by Store with location pill badges. "Import from Square" button if Square is connected.

### H. Reports (`/reports`)
- KPI Cards: Completed, In Progress, Pending, Non-Compliant.
- Filters: Store, Date range.
- Store Performance Table: Store Name, Total, Completed, Pending, Rate %.

### I. Settings (`/settings`)
- **Integrations tab:** Square connection card (status, merchant name, Connect/Disconnect).
- **Organization tab:** Org name, plan overview, active modules.
- **Billing tab:** Subscription management, module upgrades.

---

## 8. Phase 2 — Inventory Management Module

> **This entire section is gated behind `activeModules.includes("inventory")`.**
> Build Phase 1 completely before starting Phase 2.
> The Square OAuth connection, token storage, and `Store` records from Phase 1 are reused directly — do not duplicate them.

### 8a. Catalog Sync
When the Inventory module is first activated, trigger a catalog sync:
1. Call Square's `SearchCatalogItems` to retrieve all item variations, categories, and pricing.
2. For each `CatalogItemVariation`, upsert an `ItemMetadata` record using `squareCatalogObjId` as the key.
3. Store the item name, category, and Square price in `ItemMetadata` as defaults (the user can override `unitCostOverride` and `unitOfMeasure`).
4. Register a webhook listener for `catalog.version.updated` to keep local metadata in sync.

**Do not duplicate location data.** The `Store` records already exist from Phase 1. Use `store.squareLocationId` to scope all Square Inventory API calls.

### 8b. Inventory Dashboard (`/inventory`)
Displays per-location metrics for the currently selected store:
- Days since last physical count.
- Total sitting inventory value (sum of `IN_STOCK` quantity × unit cost for all items).
- Total usage (COGS) for the most recent inventory period.
- A line chart of sitting inventory value and usage over the past 6 months.
- Quick-action panel: Start New Count, Record Adjustment, Export COGS Report.

### 8c. Item & Category Manager (`/inventory/items`)
- Pulls all catalog items from `ItemMetadata` (synced from Square).
- Displays: Item Name, Brand, Category, Vendor, Unit of Measure, Unit Cost, GL Code, Par Level.
- Users can edit `vendorName`, `glCode`, `parLevel`, `unitCostOverride`, `unitOfMeasure`, and `notes` — these fields are stored locally in `ItemMetadata` and never pushed back to Square.
- Bulk-assign items to storage areas.
- Category tree mirrors Square's catalog categories.

### 8d. Storage Areas (`/inventory/storage-areas`)
- Users define custom physical locations per store (e.g., "Two Door Freezer", "Back of House", "Production Area").
- These are stored in `StorageArea` — Square has no equivalent concept.
- Drag-and-drop interface to assign catalog items to storage areas and set shelf order.

### 8e. Physical Inventory Count Workflow (`/inventory/counts/new`)
1. User initiates a new count — creates a `Draft` `InventoryCount` record.
2. Items are presented grouped by storage area, showing: item name, vendor, unit of measure, previous count quantity, and an input field for the new count.
3. Each storage area shows a completion tracker (e.g., "7/7 items counted").
4. A search bar allows quick-adding items not yet assigned to a storage area.
5. On finalization, the app calculates usage variance per item (`previousCount + deliveries − currentCount`) and displays a summary.
6. On confirm, call `POST /v2/inventory/changes/batch-create` with `type: "PHYSICAL_COUNT"` for each item, using `store.squareLocationId` as the `location_id`. Save the finalized `InventoryCount` and all `InventoryCountLine` records to the database.

```json
// Example Square API call — submit physical count
POST https://connect.squareup.com/v2/inventory/changes/batch-create
{
  "idempotency_key": "{UNIQUE_KEY}",
  "changes": [{
    "type": "PHYSICAL_COUNT",
    "physical_count": {
      "catalog_object_id": "{ITEM_VARIATION_ID}",
      "location_id": "{SQUARE_LOCATION_ID}",
      "quantity": "48",
      "occurred_at": "2026-06-25T19:00:00Z"
    }
  }]
}
```

### 8f. Inventory History (`/inventory/history`)
- Chronological list of completed inventory periods.
- Each period shows: date range, staff who completed it, sitting inventory value, total COGS.
- Drill-down to item-level detail: starting count, deliveries, ending count, usage per item.

### 8g. Expected Inventory Report (`/inventory/expected`)
- Calculates theoretical stock: `Last Physical Count + Deliveries − Sales (Square Orders API)`.
- Highlights items where actual stock is likely to deviate significantly from expected.

### 8h. COGS Report (`/inventory/cogs`)
- User selects an inventory period (from one finalized count to the next).
- Table columns: Item, Starting Count, Deliveries, Ending Count, Unit Usage, Unit Cost, Total COGS, Reported Losses.
- Grouping by category. Export to CSV via PapaParse.

### 8i. Adjustments (`/inventory/adjustments`)
Three adjustment types, all submitted via `POST /v2/inventory/changes/batch-create`:
- **Loss (Waste):** Moves quantity from `IN_STOCK` to `WASTE`. Captures reason and responsible staff member.
- **Transfer:** Moves stock between two locations — deduction from source, addition to destination.
- **Prep Deduction:** Deducts ingredient quantities consumed when preparing a batch recipe, using stored recipe ratios.

```json
// Example — record a loss
{
  "type": "ADJUSTMENT",
  "adjustment": {
    "catalog_object_id": "{ITEM_VARIATION_ID}",
    "from_state": "IN_STOCK",
    "to_state": "WASTE",
    "quantity": "3",
    "location_id": "{SQUARE_LOCATION_ID}",
    "occurred_at": "2026-06-25T19:00:00Z"
  }
}
```

### 8j. Phase 2 Inventory API Route Structure
```
src/app/api/inventory/
  dashboard/route.ts          — GET: sitting value, COGS, days since last count
  items/route.ts              — GET/PATCH: item metadata CRUD
  storage-areas/route.ts      — GET/POST/PATCH/DELETE: storage area management
  storage-areas/assign/route.ts — POST: assign items to storage areas
  counts/route.ts             — GET: list counts | POST: create draft count
  counts/[id]/route.ts        — GET: count detail | PATCH: update lines
  counts/[id]/finalize/route.ts — POST: finalize and submit to Square
  history/route.ts            — GET: completed count history
  expected/route.ts           — GET: expected inventory report
  cogs/route.ts               — GET: COGS report for a period
  adjustments/route.ts        — POST: submit loss/transfer/prep to Square
```

---

## 9. Phase 2 — Nutritional Information Module

> **This entire section is gated behind `activeModules.includes("nutrition")`.**
> Build after Phase 1 is complete. Phase 2 Inventory and Nutrition modules are independent — a subscriber can have one without the other.

### 9a. Menu Item Manager (`/nutrition/menu`)
- Displays all `MenuItem` records for the organization.
- Each item can optionally be linked to a Square catalog item via `squareCatalogObjId`. If linked, the item name and category are pulled from the Square catalog sync. If not linked, the item is manually created.
- Users can create, edit, and delete menu items regardless of Square connection status.

### 9b. Nutritional Data Editor (`/nutrition/menu/:id`)
- Form to enter or edit the full FDA-standard nutrition facts for a menu item:
  - Serving Size, Calories, Total Fat, Saturated Fat, Trans Fat, Cholesterol, Sodium, Total Carbohydrates, Dietary Fiber, Total Sugars, Added Sugars, Protein, Vitamin D, Calcium, Iron, Potassium.
- Allergen toggles: Milk, Eggs, Fish, Shellfish, Tree Nuts, Peanuts, Wheat, Soybeans, Sesame.
- Live preview of the rendered Nutrition Facts label (FDA standard format) as the user types.

### 9c. Embeddable Nutrition Page (Public Webpage)

This is a key deliverable of the Nutrition module. Each subscribing organization gets a **publicly accessible, embeddable nutrition information webpage** that they can embed into their Square website or any other website using a standard `<iframe>` tag.

**Public URL format:** `/menu/[organizationSlug]`

**Page behavior:**
- No login required — fully public.
- Displays all active `MenuItem` records for the organization with their nutrition facts.
- Filterable by category.
- Each item shows a clickable card that expands to reveal the full Nutrition Facts panel and allergen list.
- The page is styled to match the organization's brand (uses the Froot design system by default, but allows a custom accent color set in Settings).

**Embed code generation:**
In the Nutrition settings page (`/settings/nutrition`), provide a ready-to-copy embed snippet:
```html
<iframe
  src="https://app.frootapp.com/menu/[organizationSlug]"
  width="100%"
  height="800"
  frameborder="0"
  style="border-radius: 8px;"
  title="[Organization Name] Nutrition Information"
></iframe>
```

**Square Website Integration Note:** Square Online websites support embedding custom HTML via the "Embed Code" block. The embed snippet above can be pasted directly into a Square Online page. Document this in the UI with a short instructional tooltip.

### 9d. Nutrition API Route Structure
```
src/app/api/nutrition/
  menu/route.ts               — GET/POST: list and create menu items
  menu/[id]/route.ts          — GET/PATCH/DELETE: menu item detail
  menu/[id]/nutrition/route.ts — GET/PUT: nutrition facts for an item
  menu/[id]/allergens/route.ts — GET/PUT: allergen list for an item

// Public routes — no auth required
src/app/menu/[orgSlug]/
  page.tsx                    — Public nutrition info page (SSR, cacheable)
```

---

## 10. Multi-Tenancy Architecture

Every database query **must** be scoped to the current `organizationId`. Follow this pattern in all server actions and API routes:

```ts
import { auth } from '@clerk/nextjs/server'

export async function getStores() {
  const { orgId } = await auth()
  if (!orgId) throw new Error('Unauthorized')

  return prisma.store.findMany({
    where: { organization: { clerkOrgId: orgId } },
  })
}
```

Never return data across organization boundaries. The public nutrition page at `/menu/[orgSlug]` is the only intentional exception — it reads only `MenuItem`, `MenuItemNutrition`, and `MenuItemAllergen` records for the specified org slug, and only returns items where `isActive = true`.

---

## 11. Build Execution Order

### Phase 1
1. **Project scaffold** — Next.js 16, all dependencies, Tailwind tokens, shadcn/ui.
2. **Clerk auth** — Middleware, sign-in/sign-up, org creation, Svix webhook handler at `/api/webhooks/clerk`.
3. **Neon + Prisma** — Full schema migration (including Phase 2 models for forward compatibility).
4. **App shell** — Sidebar, layout, Clerk `<UserButton>` / `<OrganizationSwitcher>`.
5. **Stores & Staff** — Manual CRUD first, then Square import flow.
6. **Square OAuth** — Connect/disconnect, Locations + Team Members import modals.
7. **Templates** — Template list and task builder form.
8. **Checklist generation** — Daily generation logic based on templates and store hours.
9. **Store View & Checklist Execution** — Mobile-first staff-facing UI.
10. **Dashboard & Reports** — KPI aggregation and store performance table.
11. **Settings page** — Square status, org settings, billing, module upgrade CTAs.

### Phase 2
12. **Feature gate infrastructure** — `requireModule()` helper, upgrade prompt component, sidebar lock badges.
13. **Catalog sync** — Square catalog → `ItemMetadata` upsert, `catalog.version.updated` webhook.
14. **Storage Areas** — CRUD and drag-and-drop item assignment.
15. **Physical Count workflow** — Draft → count entry → finalization → Square submission.
16. **Inventory History, Expected Inventory, COGS Report** — Read-only reporting views.
17. **Adjustments** — Loss, Transfer, Prep Deduction forms.
18. **Inventory Dashboard** — Metrics and chart.
19. **Menu Item Manager & Nutrition Editor** — CRUD with live Nutrition Facts preview.
20. **Public Nutrition Page** — SSR page at `/menu/[orgSlug]` with embed code generator.

---

## 12. Key UX Requirements

- The **Checklist Execution view** is the most critical Phase 1 screen — used on mobile phones. Tap targets must be at least 44px, progress updates must be instant (optimistic UI), and the submit flow must be unambiguous.
- The **Physical Count workflow** is the most critical Phase 2 screen — also used on mobile. Input fields must be large, the storage area progress tracker must be prominent, and the finalization confirmation must clearly show the usage variance summary before the user commits.
- Use **skeleton loaders** for all async data fetches, never spinners.
- All **destructive actions** require a confirmation dialog.
- **Empty states** must be informative with a clear call-to-action (e.g., "No menu items yet. Add your first item or link items from your Square catalog.").
- The **Square import modals** must handle partial failures gracefully — show which records succeeded and which failed.
- The **public nutrition page** must be fast (SSR + caching), accessible (WCAG AA), and embeddable without CORS issues.

---

I will now provide the screenshots for Phase 1. Please use them as the visual reference to match the design, spacing, typography hierarchy, and component layout exactly. Confirm you are ready to begin.
