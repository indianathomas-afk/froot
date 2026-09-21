# NOTIFY-2a — Phase 1 audit

**Session:** NOTIFY-2a, TIER 3. Audit phase only — nothing was written to
`src/`, `prisma/` or any database by this pass.
**Date:** 2026-09-20. **Branch:** `staging`, HEAD `5dc7d27`, tree clean apart
from the untracked prompt `docs/prompts/NOTIFY-2a.md`.
**Prisma commands run, verbatim (one, read-only):**

```
npx prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --script
```

Result: `-- This is an empty migration.` — the local **dev** Neon branch matches
`prisma/schema.prisma` exactly, so the 59/59 `migrate deploy` Gary ran at F-5b
is confirmed and nothing is owed before a new migration is generated. The gate
in the prompt ("if it is not empty, STOP") does not fire.

---

## Finding 1 — The two existing surfaces

### HR acknowledgment recipients (HR-16)

| Thing | Location |
|---|---|
| Card wrapper (`hrAvailable &&`) | `src/app/(app)/settings/page.tsx:221-266` |
| Availability gate computed | `src/app/(app)/settings/page.tsx:59-60` |
| Field render (inside the HR module card, `hrActive &&`) | `src/app/(app)/settings/page.tsx:263` |
| Island | `src/app/(app)/settings/hr-actions.tsx:49-126` (`HrAckRecipientsField`) |
| Import | `src/app/(app)/settings/page.tsx:13` |
| Route | `PUT /api/hr/settings` — `src/app/api/hr/settings/route.ts:56-89` |
| Column | `Organization.hrAckRecipients String[] @default([])` — `prisma/schema.prisma:96` |

`HrAckRecipientsField` imports, in full (`hr-actions.tsx:3-7`): `useState`,
`useRouter`, `Switch`, `Button`, `Textarea`. `Switch` belongs to the OTHER
export in that file (`HrModuleToggle`, lines 12-36), not to the recipients
field — the field itself uses only `useState`, `useRouter`, `Button` and
`Textarea`.

**It is a relocation, not a rewrite.** The component takes one prop
(`recipients: string[]`), renders its own bordered container with its own `<h3>`
and help text (lines 89-95), posts free text to the route and re-renders from
what the route returns. It has no dependency on the `/settings` page beyond the
prop and the `mt-4` on its own root div (line 89) — which is the one class that
wants a second look when it stops being a child of the HR module card.

### Behind-pace alerts (F-5b)

| Thing | Location |
|---|---|
| Card (no availability gate) | `src/app/(app)/settings/page.tsx:360-400`, with the ruling comment at `355-359` |
| `paceAlertsActive` computed | `src/app/(app)/settings/page.tsx:76` |
| Island | `src/app/(app)/settings/pace-alerts-actions.tsx:16-40` (`PaceAlertsToggle`) |
| Import | `src/app/(app)/settings/page.tsx:17` |
| Route | `POST /api/pace-alerts/toggle` — `src/app/api/pace-alerts/toggle/route.ts:22-51` |
| Column | `Organization.paceAlertsEnabled Boolean @default(false)` — `prisma/schema.prisma:75` |

`PaceAlertsToggle` imports (`pace-alerts-actions.tsx:3-5`): `useState`,
`useRouter`, `Switch`. One prop (`enabled: boolean`), optimistic flip with
revert on failure, then `router.refresh()` so the card's own Enabled/Disabled
badge follows.

**Also a relocation.** But note where the seam falls: the island is ONLY the
switch. The Enabled/Disabled badge, the icon tile, the title and the help text
all live in the page's JSX (`page.tsx:366-394`), not in the island — so moving
the pace card means moving ~35 lines of the page's own markup, whereas moving
the HR field means moving one `<HrAckRecipientsField …/>` line. That asymmetry
is the main shape of the Phase 2 diff.

### Both routes' gates

- `PUT /api/hr/settings`: `auth()` → **`hrModuleAvailable(orgId)` → 404** →
  `requireAdmin()` → Zod → org lookup (`route.ts:57-77`).
- `POST /api/pace-alerts/toggle`: `auth()` → `requireAdmin()` → Zod → org
  lookup (`route.ts:23-36`). **No availability gate, deliberately** — the
  route's own comment (lines 18-21) records that there is no
  `PACE_ALERTS_MODULE_AVAILABLE` and the column is the only gate.

Both re-check independently of the page per PERM-2. `settings.access` is
`ADMIN_ONLY` at `src/lib/permissions.ts:273` and is absent from the override
grid, so it cannot be granted down.

---

## Finding 2 — The sub-page precedent (`/settings/labor`)

- **Page:** `src/app/(app)/settings/labor/page.tsx` (141 lines).
- **Layout file: THERE IS NONE.** `find src/app/(app)/settings -type f` returns
  nine files and no `layout.tsx` anywhere under `settings/`. The chrome comes
  from `src/app/(app)/layout.tsx` (the app shell), and the sub-page supplies its
  own header block: a `<Link href="/settings">` with a `ChevronLeft` reading
  "Settings", then `<h1>` and a one-line description
  (`labor/page.tsx:107-120`). That header block is the pattern the new page
  copies.
- **Linked from `/settings`:** `page.tsx:298-304`, an inline text link
  ("Manage labor settings &amp; positions →") inside the Labor module card,
  rendered only while `laborActive`. There is no separate link card today.
- **Also linked from the sidebar:** `src/components/layout/sidebar.tsx:210` —
  `{ href: "/settings/labor", label: "Labor", capability: "labor.access",
  requiresLabor: true }`. The sidebar resolves `/settings` highlighting at
  `sidebar.tsx:342-346`: a more specific visible nav item wins, otherwise
  `/settings*` highlights Settings. **A `/settings/notifications` page with no
  nav item of its own therefore highlights Settings correctly with no sidebar
  change** — that file needs no edit in Phase 2.
- **Gate:** `labor/page.tsx:17-63` — `getCurrentUser()` in a try/catch with
  `redirect("/dashboard")` on throw, then `laborModuleAvailable(org.clerkOrgId)
  && org.activeModules.includes("labor")` → `notFound()`, then
  `can(actor, "labor.manage") && can(actor, "labor.access")` →
  `redirect("/dashboard")`.

The new page copies the SHAPE (server component, `getCurrentUser()` in a
try/catch, redirect on refusal, own back-link header) but not the capability:
NOTIFY-2a is `settings.access` / ADMIN_ONLY per the prompt, matching
`/settings` (`page.tsx:44-51`), not labor's ADMIN||MANAGER pair.

---

## Finding 3 — Threshold today: every read and pass

`src/lib/pace-alerts.ts:18-23`

```ts
export const DEFAULT_PACE_THRESHOLD_PCT = 90
export function paceThresholdPct(): number {
  const n = Number(process.env.PACE_ALERT_THRESHOLD_PCT)
  return Number.isFinite(n) && n > 0 && n <= 100 ? n : DEFAULT_PACE_THRESHOLD_PCT
}
```

**`paceThresholdPct()` has exactly ONE caller in the entire repo** —
`src/app/api/cron/pace-alerts/route.ts:24`, once per run, before the store loop.
Full census of `thresholdPct`:

| File:line | What |
|---|---|
| `src/lib/pace-alerts.ts:18` | `DEFAULT_PACE_THRESHOLD_PCT = 90` |
| `src/lib/pace-alerts.ts:20-23` | env reader, the only `process.env` read |
| `src/lib/pace-alerts.ts:29,32,35` | `evaluatePaceAlert` arg — the pure predicate, `pacePct < thresholdPct` |
| `src/lib/pace-alerts.ts:50` | `processPaceAlertForStore(store, opts)` — `opts.thresholdPct` |
| `src/lib/pace-alerts.ts:79` | passed into `evaluatePaceAlert` |
| `src/lib/pace-alerts.ts:122` | **persisted** on the `PaceAlertLog` row |
| `src/lib/pace-alerts.ts:169` | rendered in the email body: "Alert threshold: N% of MTD goal." |
| `src/app/api/cron/pace-alerts/route.ts:7` | comment naming the env var |
| `src/app/api/cron/pace-alerts/route.ts:24` | **the single resolve**, once per run |
| `src/app/api/cron/pace-alerts/route.ts:57` | passed per store, same value every store |
| `src/app/api/cron/pace-alerts/route.ts:68` | run-log line, `(threshold N%)` |
| `src/app/api/cron/pace-alerts/route.ts:72` | JSON response, one scalar `thresholdPct` |
| `scripts/verify-f5-polish.ts:200-203` | four `evaluatePaceAlert` unit checks, literal `90` |
| `scripts/verify-f5-polish.ts:213,228,231,287,301,332` | six `processPaceAlertForStore` calls, literal `90` |
| `scripts/verify-f5-polish.ts:237` | asserts `logRow.thresholdPct === 90` |
| `prisma/schema.prisma:828` | `PaceAlertLog.thresholdPct Float` (already per-row) |
| `prisma/migrations/20260710220000_…/migration.sql:8` | that column's DDL |

Docs that state the env-var rule and will need the Phase 3 edit:
`docs/FORECASTING.md:105`, `docs/DECISIONS.md:119`, `docs/ROADMAP.yaml:4052`
(the F-5b `deferred` entry), `CLAUDE.md` § Environment Variables.

**Two observations that bear on Phase 2:**

1. `PaceAlertLog.thresholdPct` is already a per-row `Float`, so the log, the
   email body line (`pace-alerts.ts:169`) and the audit trail become correct
   per-org for free the moment the cron passes a per-org value. Nothing in
   `src/lib/pace-alerts.ts` needs to change — the prompt is right that the work
   is confined to the cron's store loop.
2. **The cron's store query does not load the organization**
   (`route.ts:40-42`) and `processPaceAlertForStore` is typed `store: Store`, so
   attaching a relation would change that type. The clean shape is to keep the
   query as-is and resolve a `Map<organizationId, number|null>` from a
   `prisma.organization.findMany({ where: { paceAlertsEnabled: true }, select:
   { id: true, paceAlertThresholdPct: true } })` — which also REPLACES the
   existing `prisma.organization.count(...)` at `route.ts:43` (`orgsEnabled`
   becomes that array's length), so the query count does not grow.
3. `thresholdPct` in the JSON response (`route.ts:72`) is a single scalar today.
   Per-org it must become either a per-result field or a map; the prompt asks
   for per-org reporting in both the log line and the JSON, so this is a
   response-shape change. Nothing reads that response programmatically — it is
   read by a human in the Vercel function log — so the change is safe, but it
   IS a change and is named here rather than made silently.

---

## Finding 4 — The `hrAckRecipients` route gate

`PUT /api/hr/settings` is behind `hrModuleAvailable(orgId)` and returns **404**
when HR does not exist in this environment (`src/app/api/hr/settings/route.ts:60-62`).
`hrModuleAvailable` (`src/lib/auth.ts:35-44`) is `HR_MODULE_AVAILABLE === "true"`
OR the org id appearing in `HR_INTERNAL_ORG_IDS`.

Note there are **two different gates** in play on `/settings` today, and the
prompt's F2 conflates them slightly:

- `hrAvailable` — the ENV gate. The whole HR card is hidden when false
  (`page.tsx:221`), and the route 404s.
- `hrActive` — `activeModules.includes("hr")`, the per-org purchase. The
  recipients field is hidden when false (`page.tsx:263`) **but the route does
  not check it** — `PUT /api/hr/settings` has no `activeModules` check, so an
  admin of an HR-available-but-inactive org can still write the column by hand.
  That is not a defect (the column is inert while HR is off, and the existing
  comment at `page.tsx:258-262` says the value is deliberately preserved across
  a toggle), but it means F2's "when the HR module is off" has two readings and
  the answer may differ between them.

Which half is live depends on an env value this session cannot read (no
`vercel env pull` in this repo, by rule). If `HR_MODULE_AVAILABLE` is set in
Production — HR was promoted for launch in July — then the env half of F2 never
fires for Keva and the only reachable case is the `hrActive` half.

---

## Finding 5 — Migration state

- 59 migration folders in `prisma/migrations/`, newest five:
  `20260906022810_hr33_lesson_external_link`,
  `20260917143000_cal1_calendar`,
  `20260918180000_cal2_scheduled_checklists`,
  `20260920120000_hr16_ack_recipients`,
  **`20260920190000_f5b_pace_alerts_toggle`** — as the prompt expected.
- Read-only diff (command verbatim at the head of this file): **empty**. Dev is
  in sync at 59/59. No STOP.

---

## Finding 6 — Does the `email.sent` audit row record the provider?

**NO.** `src/lib/hr-ack-notification.ts:228-238` writes:

```ts
metadata: { kind: AUDIT_KIND, ...extra }
```

where `extra` is typed `{ recipients: string[]; resendId?: string | null;
error?: string }` (`hr-ack-notification.ts:222`). The `email.sent` call site
(`hr-ack-notification.ts:211`) passes `{ recipients, resendId: id ?? null }`.
So a stored row carries `kind`, `recipients` and `resendId` — and **nothing
naming the channel that carried it**.

`resendId` is not a usable proxy. The console sender returns `{}`
(`src/lib/notify.ts:54`), so console mode stores `resendId: null` — but so does
a REAL Resend 2xx whose body failed to parse (`notify.ts:112-117`, which
deliberately keeps the send successful and loses the id). A null therefore means
"console" or "Resend, id lost", and the row cannot tell them apart. That is
exactly the confusion the prompt wants stopped.

**The fix is one field and one import.** `emailProviderName()` is already
exported from `src/lib/notify.ts:44-46` and deliberately reports the resolved
string without validating it. Phase 2 adds `provider: emailProviderName()` to
the metadata at `hr-ack-notification.ts:237` (or to both call sites' `extra`),
and the `email.failed` rows get it for free.

---

## Forks for Gary — presented, NOT resolved

**F1 — Threshold storage.** `Organization.paceAlertThresholdPct Int?` (null =
fall back to env/90) vs non-null `@default(90)` with the env var retired.

Evidence bearing on it, neutral: the column is read in exactly one place
(the cron), and `PaceAlertLog.thresholdPct` already records what was actually
used per send, so the historical record is correct either way. `Int?` matches
`hrAckRecipients`' "empty is a legitimate value" shape and keeps the F-5b
deploy behaviour byte-identical; `@default(90)` removes a two-source read but
requires a decision about what `PACE_ALERT_THRESHOLD_PCT` means afterwards in
every deployed environment that already sets it. **Note the type narrowing
either way:** the env reader accepts any finite value in `(0,100]` including
fractions (`pace-alerts.ts:22`), while the prompt's input is an integer 50–100.
A column typed `Int` cannot represent an env value of `87.5`. Nothing sets a
fractional value today, but the two validators would no longer agree, and with
F1's null-fallback option they would coexist.

**F2 — HR card when the HR module is off.** Hide vs show-disabled. See finding
4: please rule against whichever gate you mean — `hrAvailable` (env; the card
and the route both already vanish) or `hrActive` (the per-org toggle; the live
case, and the one where the page could show a disabled card with "Turn the HR
module on in Settings to use this").

**F3 — What stays on `/settings`.** One "Email notifications →" link card
replacing both, vs leaving the pace toggle in both places. No new evidence
against the prompt's lean; the mechanical note is that the pace card's badge and
help text live in the page rather than the island (finding 1), so "leave it in
both places" means duplicating that markup or extracting it — it is not a
one-line `{...}` reuse.

---

## One thing the prompt does not mention

`docs/ROADMAP.yaml:17836-17839`, the NOTIFY-2 row's SCOPE NOTE, reads: *"the
page is a READ surface. Editing recipients stays on /settings under HR-16's
field; a second place to set them is the thing this row must not become."*
NOTIFY-2a inverts that — the page becomes the WRITE surface and `/settings`
loses the field. That is Gary's 2026-09-20 ruling and needs no re-litigation,
but the Phase 3 row rewrite must say so explicitly rather than let a future
reader find the two statements side by side and assume one of them is a
mistake. The distinction that makes both true: 2a moves the CONTROLS (one
place to set each thing, which is what the old note wanted); 2b adds the
READER (the send log), which is what the old note was describing.
