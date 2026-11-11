# TAB-13 — Gate 0 + Gate 1 audit (read-only)

Session: 2026-11-11. Prompt of record: `docs/prompts/TAB-13.md` (untracked).
Design source: "Froot Tablet — Checklists" PDF (`~/Downloads/Froot Tablet — Checklists.pdf`),
page 4 = "Home · Option 1 — Switcher on the hero", page 3 = "Checklist type key". Pages 1, 2, 5 ignored.
No code written. No DB query run by this session. No browser opened.

Written because the audit turned up three things the prompt did not expect (§ Surprises). Per
CLAUDE.md § Session Tiers, TIER 2 audits write no artifact unless something surprising turns up.

---

## Gate 0 — Preflight

| Check | Result |
|---|---|
| Repo root | `/Users/garythomas/Claude_Projects/Froot/froot` (session opened on `main`; switched to `staging`) |
| Branch | `staging`, up to date with `origin/staging` at `68d3bc5` |
| Working tree | clean except the untracked prompt `docs/prompts/TAB-13.md` (and now this file) |
| Next TAB id | `TAB-13` is free: `docs/ROADMAP.yaml` has TAB-10 (:26265), TAB-11 (:26396), TAB-12 (:26482), no TAB-13 |
| main vs staging | `origin/main` is one merge commit ahead (`c21fe51` "Promote TAB-4, TAB-7, TAB-8, TAB-10, TAB-11, TAB-12"). `git diff staging origin/main` is empty, so the trees are identical. The R1 fast-forward of main back into staging is still owed. That is Gary's push. It does not block this phase. |

How tablet mode works, from TAB-1/TAB-11 and the code:
- The device's `froot_view` cookie, read server-side by `getViewMode()` (`src/lib/view-mode-server`).
- `/dashboard` branches at `src/app/(app)/dashboard/page.tsx:136`: tablet mode renders `TabletHome`. Desktop takes the
  path from :152 on and never imports `tablet-home.tsx`. A change confined to the tablet files cannot reach desktop Home.
- Tablet components live in `src/app/(app)/dashboard/tablet-*.tsx`, with pure logic in `src/lib/tablet-*.ts`, each pinned by
  `scripts/verify-tab*.ts`.

---

## Surprises (why this artifact exists)

1. **The hero is not a launcher. It is TAB-1's inline execution panel.** Start does not navigate. It either instantiates the
   row (POST `/api/checklists`) or flips local state, then the SAME card becomes the task list where staff tick items. Done
   shows in the same card too. R5's "goes where the current Start button goes" therefore means "turns the card into
   the tick list". There is no route to go to. (§ e)
2. **Checklist types are per-org, renameable records that already carry an admin-chosen colour.** `TemplateType{name,
   colorKey}` (`prisma/schema.prisma:685`). The starter set is Opener/orange, Mid-Shift/blue, **Closer**/purple,
   Cleaning/green (`src/lib/template-types.ts:17-22`). There is no "Closing" and no "Management". The design's key fixes
   the colours by name, which conflicts with the colours admins already pick on /templates. (§ c)
3. **No read-only view of a completed checklist exists.** `/store-view/checklist/[id]` locks only Missed rows
   (`checklist-execution-client.tsx:264`), and task-log refuses only closed non-Completed rows
   (`api/checklists/[id]/task-log/route.ts:41`). So a Completed checklist opened there can still be unticked. (§ e)

---

## a. The current pick

**Component.** `TabletHome` (`src/app/(app)/dashboard/tablet-home.tsx:187`) renders `TasksPanel` (:687) in the left column
(:665). `TasksPanel` calls `pickTodayChecklist(rows)` at :767. The function is in `src/lib/tablet-today.ts:56-68`:

1. Sort every entry by `expectedEndAt` ascending. A null end (no window) sorts after every windowed one. Ties break by
   **name**, `localeCompare` (:47-54).
2. If any entry is `active` or `overdue`, show the first one (:58-59).
3. Otherwise, if any is `completed`, show DONE for the last completed, with the first `upcoming` as "Up next" (:61-65).
4. Otherwise show the first `upcoming` (:66), or NONE (:67).

What the rule never looks at: **whether a checklist is in progress.** A started checklist does not outrank an unstarted one.
Only the lifecycle state and the due time matter. The panel then renders one of three things, picked at :1101-1128:
`NotStartedPanel` (:1319), `InProgressPanel` (:1347), or `DonePanel` (:1494). Nothing on screen names any other
checklist, except the DonePanel's single "Up next" card.

**The Carson case: Home showed CLEANING while MID-SHIFT was also not started.** Status does not enter the rule. So the
case reduces to (i) the two checklists' lifecycle states and (ii) their window ends. Three explanations fit the code. Each
is listed with the evidence that would disprove it, and none is confirmed:

| # | Explanation | Disproved by |
|---|---|---|
| H1 | Mid-Shift was `upcoming` (its start offset had not been reached) and Cleaning was `active`/`overdue`. Rule 2 excludes upcoming. | Mid-Shift has no `startOffsetHours`, or its computed window start was before the moment Carson looked. |
| H2 | Both were due-now and Cleaning's window **end** was earlier, or Cleaning was `overdue`. | Cleaning's `expectedEndAt` is null or later than Mid-Shift's. |
| H3 | Both had **no window end** (blank end offset, `AllDay`, or no phase), so the name tiebreak put "Cleaning" before "Mid-Shift" alphabetically. | Either template has an `endOffsetHours` and a phase that yields an end. |

H3 is the cheapest explanation, but the code makes no explanation more likely than the others. Telling them apart needs
the two templates' offsets, Carson's Wednesday hours, the two rows' frozen windows, and **the time Carson looked**.
Query C below returns all of these except the time. The incident happened on real data, so the decisive branch is
production (Neon console only). Staging may differ if its templates were edited after the branch point.

---

## b. The data source

The hero reads two sources, both already loaded on the page. Tapping a tab needs no new fetch.

| Need | Source today | Notes |
|---|---|---|
| Which checklists, today, this store | GET `/api/stores/[id]/templates` (`tablet-home.tsx:278`). This is the Start Daily Checklist list, `route.ts:15-168`. | It already returns **every** applicable template for the store's business day, including ones with **no row yet**. It drops `missed` (:167). |
| Status | `existingStatus`, `lifecycleState`, `existingChecklistId` (:137-142) | `lifecycleState` is upcoming/active/overdue/completed. In progress = `existingStatus === "In Progress"`, or any task done. TasksPanel already derives this at :1104-1106. |
| Due time | `expectedEndAt` + `timeZone` (:143, :145) | `dueLabel()` at `tablet-home.tsx:1311` already formats "Due 7:00 PM" or "Overdue · was due …". |
| Task count | `taskCount` (:135) | **Caveat:** this counts the template's live tasks without the per-store `excludedStoreIds` skip. The inline list's total comes from `loadTabletData`, which applies the skip (`tablet-data.ts:116`). So the two can disagree. Plan: when a row exists, use the row's section total (the number the tick list shows); use `taskCount` only for a template with no row yet. |
| Done count | `checklistsById` from `loadTabletData` (`tablet-data.ts:60-136`), via `/dashboard` SSR and the TAB-8 re-read | Per-task `done`, plus local tick overrides (`withOverrides`, :785). A template with no row is 0 done. |
| Type | `type: t.templateType?.name ?? t.type` (`route.ts:134`) | **Already on the wire.** The client's `TodayRow` type (`tablet-home.tsx:129`) does not declare it yet. Adding it is a one-line client change, with no API change. `colorKey` is NOT returned. |

**R2 versus "the Checklists page's rule".** `/checklists` (`checklists/page.tsx:85-103`) lists only checklist **rows**
that exist today. The hero's list also includes templates nobody has started yet. If R2 is taken literally, a
not-yet-instantiated Mid-Shift gets **no tab**, which is the Carson problem again. Both lists use the same scope gate
(`getUserStoreScope`; templates `route.ts:32-35`, checklists `page.tsx:55-75`). → RULING NOW 4.

---

## c. The type field

- **Structured field:** `Template.typeId → TemplateType` (`prisma/schema.prisma:616`, relation at Template line 45;
  model at :685). There is a legacy free-text `Template.type`, which nothing reads while `typeId` is set.
- `TemplateType` is **per org**: `@@unique([organizationId, name])`. Admins can rename it, delete it, and choose its
  colour from 8 `BADGE_PRESETS` keys (`src/lib/badge-presets.ts`, `templates/type-manager-dialog.tsx`). It is not an
  enum. The only stable identity across orgs is the **name**.
- Starter set (`src/lib/template-types.ts:17-22`, mirrored by the frozen TPL-1a migration):
  Opener/orange · Mid-Shift/blue · **Closer**/purple · Cleaning/green.
- The design key's names: OPENER · MID-SHIFT · CLEANING · **CLOSING** · **MANAGEMENT**. Neither "Closing" nor
  "Management" is a starter name.
- **Values in use:** NOT measured. This session holds no staging credentials and does not pull them. Query B below is
  for the Neon console.

So R4's condition ("if no structured field exists → RULING NOW") does **not** fire literally, because a structured field
exists. But the field is an org-defined, renameable name with its own colour, so a fixed name→colour map is still a
product decision. → RULING NOW 2.

---

## d. Icons and tokens

- Icons: `lucide-react` **1.21.0** (`package.json`). Verified present: `Sunrise`, `Sun`, `Sparkles`, `Moon`,
  `Briefcase`, `ClipboardCheck`. `tablet-home.tsx:5` already imports from it. No new dependency.
- Tokens: the tablet uses `var(--color-*)` arbitrary values throughout, e.g. `bg-[var(--color-primary)]`
  (`tablet-home.tsx:1322`).
  - In `globals.css`: `--color-primary` (:20), `--color-cal-ordering` (:54), `--color-cal-cleaning` (:55), and
    `--color-cal-other` (:58).
  - `--color-amber-400`, `--color-amber-950` and `--color-slate-800` are Tailwind 4's built-in theme variables. They are
    reachable as `bg-amber-400` and similar, or as `var(--color-amber-400)`.
- **Tailwind-4 trap** (documented at `badge-presets.ts:1-11`): the map must hold **literal** class strings. A class name
  interpolated from a key is never generated.

---

## e. Navigation

| Button | Today |
|---|---|
| Start, no row yet | POST `/api/checklists {templateId, storeId}` (`tablet-home.tsx:957-988`), the same write Start Daily Checklist makes. Then the card becomes `InProgressPanel`. **No navigation.** |
| Start, row exists | Adds the id to local `started` (:952-955), then `InProgressPanel`. Writes nothing. |
| Continue | Does not exist. An in-progress checklist goes straight to `InProgressPanel` (:1107-1122), the inline tick list. |
| Done / View | `DonePanel` (:1494) renders in the card. Its only link, "Review checked items", goes to `/store-view/checklist/[id]` (:1587-1595). That page is **editable** on a Completed row (Surprise 3). |

---

## f. Change plan (pending rulings)

No API, prisma, permission or desktop file is touched. TIER 2 holds.

| File | Change |
|---|---|
| `src/lib/checklist-types.ts` **(new)** | The shared type map, as pure data. `checklistTypeStyle(typeName)` returns `{ key, label, fill, ink, softChip, Icon }`, with **literal** class strings. The match is case-insensitive and ignores punctuation, with aliases (see RN-2). Unmapped names get `cal-other` and `ClipboardCheck`. The Checklists-page phase imports it as is. |
| `src/lib/tablet-today.ts` | Add `orderTodayChecklists(entries, inProgress)` implementing the ratified R3. It returns the ordered list (tab order) and the auto-pick (first). `pickTodayChecklist` stays for the DonePanel "Up next" path. |
| `scripts/verify-tab13-switcher.ts` **(new)** | A pure fixture in the verify-tab1-today style. It pins R3 order, the tie order, the type map (incl. the Closer alias and unmapped → gray), and the three Carson hypotheses as cases. |
| `src/app/(app)/dashboard/tablet-checklist-switcher.tsx` **(new)** | `ChecklistTabs` (tablist; 84px tabs with icon chip, uppercase name, "X of Y"/"Done"; selected = filled; sideways scroll beyond 4) and `ChecklistHero`, the Option 1 card: icon chip, Due/Completed chip, type name, "N tasks · status", "X of Y done" bar, and the Start/Continue/View button. This keeps `tablet-home.tsx` (1,922 lines) from growing. |
| `src/app/(app)/dashboard/tablet-home.tsx` | Changes inside `TasksPanel` only: `TodayRow` gains `type`; local `selectedId` state (manual ?? auto); render the tabs when there are ≥2 entries; `ChecklistHero` **replaces `NotStartedPanel`** and fronts the in-progress and done states per RN-1; `InProgressPanel` and `DonePanel` are kept. The panel is already keyed `${store.id}:${shownDay}` (:670), so a store or day change remounts it and drops the manual pick for free. |

Not touched: `page.tsx`, `tablet-data.ts`, every `/api` route, the Messages column, the strip, the header, the overdue
chip, the desktop dashboard, and `/checklists`.

**Gate 3 note.** TAB-5/TAB-8 re-read the panel on their own timer (`tablet-home.tsx:306-400`). When checking "tab tap
makes no network request", watch the Network tab around the tap itself. A re-read that happens to land then is the
timer, not the tap.

---

## RULING NOW

**RN-1 — What the hero's button does, given that the hero is an inline tick list (Surprise 1).**
Recommend **A**:
- The Option 1 card is what the selected checklist shows *before it is opened*. **Start** behaves as today (create
  the row if needed) and opens the inline `InProgressPanel` in the same card. **Continue** opens the same panel. **View**
  shows the existing `DonePanel` in the card. The tab row stays above in every state.
- Tapping a tab while a tick list is open returns the card to that tab's summary. Local ticks are kept, since they live
  in panel state.
- There is no navigation anywhere, which also satisfies R3's "no URL change".
- Cost: on load, an in-progress checklist shows its summary card first, so Continue is one more tap than today.

Alternatives:
- **B:** in-progress checklists skip the summary and show the tick list directly under the tabs. This matches today's
  behaviour, but the selected tab no longer shows the mock's hero.
- **C:** Start, Continue and View navigate to `/store-view/checklist/[id]`. This retires TAB-1's on-Home ticking and is
  not recommended.

Also: should `InProgressPanel`'s dark banner take the type colour? Recommend **no**. It is outside the mock and outside R1.

**RN-2 — The type map's source (Surprise 2).**
- **(a) Recommended.** Use R4's fixed design map, keyed on the `TemplateType` name, case-insensitive. Aliases:
  `Closer`→Closing, and `Mid Shift`/`Midshift`→Mid-Shift. No API change. The cost is that the tablet ignores an
  admin's chosen `colorKey`, so the /templates badge (Mid-Shift blue) and the tablet (Mid-Shift orange) disagree.
- **(b)** Use the admin's `colorKey`. This needs one additive read field on `/api/stores/[id]/templates` and gives up
  the design's colours.
- **(c)** Use the design map for known names and fall back to `colorKey` instead of gray. Needs the same field.

Query B's results should confirm the alias list before build.

**RN-3 — R3's order loses the "window not open yet" state the current rule respects.** Taken literally, R3 picks a
not-started Closing that is due at 10 PM (window not yet open) over an active, no-due Cleaning. Recommend this order:
1. In progress, earliest due first.
2. Not started and due now (active or overdue), earliest due first, no-due last.
3. Not started and upcoming, earliest due first.
4. Completed.

Ties go by name, the list's own order. Also, while nobody has tapped a tab, should the auto-pick follow the live data
as re-reads land? Recommend **yes**. A manual pick holds until reload, store change or day change. After a submit, the
existing Done-then-"Up next" flow is unchanged.

**RN-4 — R2's list.** Recommend amending R2 to "the list the hero already reads": the Start Daily Checklist list, GET
`/api/stores/[id]/templates`. It includes templates nobody has started yet. The literal `/checklists` rule shows only
existing rows, which would hide an unstarted Mid-Shift. No new query and no new permission logic either way.

**RN-5 — "View" for a completed checklist (Surprise 3).** No read-only view exists. Recommend that View shows the
existing `DonePanel` in the card. It already lists sections n/n and the "Review checked items" link. Building a
read-only execution view is out of scope, and could be a row of its own if wanted.

**Smaller ratifications (no strong lean needed):**
- R6, one checklist: no tab row, but the hero still takes its type colour. Recommend yes. "Looks as it does now"
  would otherwise keep a hard-coded orange for one-checklist stores.
- R8: the mock's 15px "12 of 31" on a filled tab becomes 19px bold. On unfilled tabs, sub-text keeps muted ink on the
  card colour, which passes at 15–16px. This is a stated choice.

---

## Queries for Gary — Neon console only (no credentials leave the console)

Run each on the branch chosen in the console's dropdown. The first column reports the branch the server actually ran
on (CLAUDE.md R4). There is no typed label. Timestamps are **UTC** (`TIMESTAMP(3)` without zone). PST is UTC−8.

**B — type names in use (staging):**
```sql
SELECT current_setting('neon.branch_id', true) AS neon_branch,
       o."clerkOrgId", tt.name AS type_name, tt."colorKey", tt."sortOrder",
       count(t.id) FILTER (WHERE t."isActive" AND NOT t."isArchived") AS live_templates
FROM "TemplateType" tt
JOIN "Organization" o ON o.id = tt."organizationId"
LEFT JOIN "Template" t ON t."typeId" = tt.id
GROUP BY o."clerkOrgId", tt.name, tt."colorKey", tt."sortOrder"
ORDER BY o."clerkOrgId", tt."sortOrder";
```
Plus any live template with no type:
```sql
SELECT current_setting('neon.branch_id', true) AS neon_branch, o."clerkOrgId", t.name, t.type AS legacy_type
FROM "Template" t JOIN "Organization" o ON o.id = t."organizationId"
WHERE t."typeId" IS NULL AND t."isActive" AND NOT t."isArchived";
```

**C — the Carson case** (run on production for the incident; staging for comparison). Please also give the time
Carson's Home showed Cleaning:
```sql
SELECT current_setting('neon.branch_id', true) AS neon_branch,
       s.name AS store, s.timezone, t.name AS template, COALESCE(tt.name, t.type) AS type_name,
       t.frequency, t."availabilityType", t."operationalPhase", t."startOffsetHours", t."endOffsetHours",
       c.id AS checklist_id, c.status, c."expectedStartAt", c."expectedEndAt"
FROM "Store" s
JOIN "Template" t ON t."organizationId" = s."organizationId" AND t."isActive" AND NOT t."isArchived"
LEFT JOIN "TemplateType" tt ON tt.id = t."typeId"
LEFT JOIN "Checklist" c ON c."templateId" = t.id AND c."storeId" = s.id AND c.date = TIMESTAMP '2026-11-11 00:00:00'
WHERE s.name ILIKE 'Carson%'
ORDER BY s.name, t.name;
```
```sql
SELECT current_setting('neon.branch_id', true) AS neon_branch, s.name, h."dayOfWeek", h."openingTime", h."closingTime", h."isClosed"
FROM "StoreHours" h JOIN "Store" s ON s.id = h."storeId"
WHERE s.name ILIKE 'Carson%' AND h."dayOfWeek" = 3;
```
(`dayOfWeek` 3 = Wednesday: `hoursForDate` matches on `jsDayOfWeek`, 0 = Sun … 6 = Sat, `checklist-lifecycle.ts:129-131, 232-234`.)
