Read /Users/garythomas/Claude_Projects/Froot/froot/docs/prompts/TAB-1.md and run it.

# TAB-1 — Tablet mode: switch, shell, touch sizes, Tasks column

**TIER 2.** Declare the tier before writing anything. No schema, no migrations, no new API routes, no new dependencies. Any of those becoming necessary is a STOP.

## 0. Repo gate

1. Confirm the working directory is the git root `/Users/garythomas/Claude_Projects/Froot/froot` (lowercase `froot`, not the capital-F parent).
2. Confirm the branch is `staging` and the tree is clean.
3. Paste `git log --oneline -5`.

If any check fails, STOP and report.

## 1. Context

Tablet mode is an iPad-optimized layout for Froot, built for a counter iPad shared by the store crew and read from arm's length. It is centered on two things: completing the day's checklist and team messages. This phase builds the switch, the shell, and the Tasks column. TAB-2 does Messages and the stat strip. TAB-3 does the Settings card picker.

**Design reference:** `/Users/garythomas/Claude_Projects/Froot/froot_docs/design/Froot Tablet Mode.pdf` (outside the repo; read it, do not copy it in). Build **Direction 1 · Status Stage**: its three landscape states, plus the portrait artboard. Ignore Directions 2 and 3.

The design was made in Claude Design. It built the large controls from Froot's colours and spacing instead of from the component library, because Froot's components are desktop-sized. In this phase the large controls go into the library as a touch size, so the design is the look and the library is the implementation.

**Gary's rulings, 2026-11-09** (he answered "I agree yes to all" to these leans):

1. Direction: Status Stage.
2. The Tablet/Desktop switch is saved per device. It defaults to Desktop and never switches on its own.
3. Card layout is one per org, set by ADMIN; per-store layouts are deferred. (TAB-3.)
4. Sales, Goal and Labor are off by default in Tablet mode; ADMIN can turn them on. (TAB-2/3. This phase shows none of them.)
5. Messages and Tasks are locked on in Tablet mode.
6. Attribution: v1 checks off and posts as the logged-in account, same as today. Per-person attribution is a planned row.
7. The overdue chip shows this store's count; tapping it opens the existing due list as a bottom sheet.
8. The Settings gear is ADMIN only.

**Implementation note on ruling 2:** store the choice in a cookie (`froot_view`, values `tablet` | `desktop`, one-year expiry, set from the client), not localStorage. It is still per device, but the server can read it in the app layout and render the right shell on first paint with no flash.

## 2. Brief audit

Answer each point in a few lines, then continue unless one hits a STOP.

1. **Shell:** where the app layout renders the sidebar, and where the `froot_view` cookie can be read server-side to swap it.
2. **Component sizes:** how `Button` (and any row or input primitives) declare size variants (cva or otherwise), so a `touch` size can follow the same pattern.
3. **Today's checklist:** how Froot decides which checklists a store has today (daily templates, calendar-generated ones, several per day such as opening/mid-day/closing). Check the Daily Tasks button and Start Daily Checklist for an existing rule.
   - If an existing rule exists, reuse it.
   - Otherwise, the lean is: show the earliest-due checklist for this store today that isn't completed. When all are done, show the Done state with the next upcoming checklist, if any.
   - **STOP** if neither fits the data.
4. **"Start":** whether the data model has a started or in-progress state or a start action. If not, Start just opens the item list and writes nothing. **STOP** if starting would need a new write.
5. **Completion:** which existing endpoint checks off an item, and that STORE, STAFF, MANAGER and ADMIN can all use it where they can today. No permission changes.
6. **Item types:** whether checklist items can carry a value (for example, a temperature). If they can, the value-entry bottom sheet with a number pad from the design is in scope. If not, it's out, so file a ROW.
7. **Store context:** how the dashboard chooses the current store (the store dropdown). Tablet mode uses the same source.
8. **Due feed:** which source feeds the calendar due banner (`/api/calendar/due`, `calendar-due-banner.tsx`). The chip and sheet reuse it.
9. **Home screen:** whether a web manifest or Apple web-app meta tags already exist.

Any fork that isn't covered above: STOP, state it, and give your lean.

## 3. Build

### A. Touch size in the library

Add a `touch` size to `Button`, plus whatever row or input styles the Tasks column needs, following the existing variant pattern:

- buttons at least 56px tall, with the primary Start up to about 96px as in the design
- checklist rows 64–76px tall with the whole row tappable
- text 18px or larger

Colours come from the existing CSS variable tokens. No raw hex, and no Tailwind palette colours for brand surfaces.

### B. The view switch

- Cookie `froot_view` as described in section 1, defaulting to `desktop` when absent.
- A Tablet/Desktop switch in the desktop sidebar footer and in the tablet rail, available to every role.
- Switching sets the cookie and refreshes into the other shell.
- Nothing ever switches automatically.

### C. The tablet shell

When the cookie is `tablet`, the app layout renders the slim icon rail instead of the sidebar:

- **Rail:** Home (`/dashboard`), Checklists, Messages, Calendar; the store name; the switch; and a Settings gear shown to ADMIN only.
- **Other pages:** render their existing content inside the rail shell, unchanged.
- **Header on `/dashboard`:** store name, date, and the overdue chip with this store's count. Tapping the chip opens a bottom sheet listing the same items the due banner lists. In Tablet mode the full-width due banner does not render on `/dashboard`.

### D. Tablet home on `/dashboard`

- **Landscape:** two columns at about 60/40. **Portrait (narrow width):** stacked, as on the portrait artboard.
- **Scrolling:** each column scrolls on its own and the page itself does not. Use `overscroll-behavior: contain` on each column and light `scroll-snap` on section headers.
- **Left column, the Tasks panel, in three states:**
  - **Not started:** a solid orange panel with the checklist name as a bold uppercase banner (for example, OPENING CHECKLIST), the due time, and one large Start button.
  - **In progress:** a dark sticky banner reading `<NAME> · n of N` with a progress bar. Remaining items appear as full-row tap targets under sticky section headers. Completed items collapse into an "N done" summary that expands.
  - **Done:** a calm green completed state, with the next upcoming checklist shown if there is one.
  - Checking the last item moves the panel to Done. Data and writes go through the existing endpoints only.
- **Right column:** the existing Team Messages card, unchanged. TAB-2 replaces it.
- No Sales, Goal or Labor cards in this phase.

### E. Add to Home Screen

Add a web manifest and the Apple web-app meta tags so that "Add to Home Screen" on an iPad opens Froot full screen. Use the existing `public/logo.png`. Skip anything that already exists.

## 4. Rules

- No schema change and no migrations. The only Prisma command is the `prisma generate` that `npm run build` runs; report it as that, not as a breach.
- No new dependencies and no new API routes. Either one is a STOP.
- `npm run build` and lint must be green.
- Stage only the files this session touches (no `git add -A`).
- Commit, never push.
- If the today's-checklist rule ends up as new code, add a characterization check in the style of the existing `scripts/verify-*.ts` fixtures and run it.

## 5. Commits

1. **Work commit:** the code.
2. **Docs commit:**
   - `docs/ROADMAP.yaml`: read the file for its conventions and the next free ids; never assume them. Add:
     - TAB-1, at the status the file's conventions give a built-but-unchecked phase
     - TAB-2 (Messages column + stat strip) and TAB-3 (Settings card picker, schema), both planned
     - one planned row for per-person attribution on shared tablets (ruling 6)
     - a ROW for value entry if audit point 6 ruled it out
   - `docs/DECISIONS.md`: a DRAFT entry with rulings 1–8, the cookie note, and the today's-checklist rule as applied. It must be clearly marked as awaiting Gary's ratification at PRE-PUSH-CHECK.

## 6. Report

Include:

- the tier
- both SHAs
- the files touched
- the audit answers
- any FIX NOW / RULING NOW / COMMENT / ROW findings
- the staging test list below, unchanged

**Staging test list (Gary, after push):**

1. Desktop with no cookie: everything looks exactly as before.
2. Switch to Tablet: the rail and tablet home appear. Reload and it stays in Tablet. Switch back to Desktop and it stays in Desktop.
3. As Tommy (STORE) on a store with today's checklist: Not started → Start → check items → "N done" expands → the last item moves the panel to Done.
4. Overdue chip: shows that store's count and opens the sheet. No full-width banner in Tablet mode.
5. Safari Develop → Enter Responsive Design Mode → iPad at 1180×820 and 820×1180, plus a real iPad if one is available.
6. Add to Home Screen on an iPad. iOS gives home-screen web apps their own storage, so expect to sign in again and to set Tablet again inside the home-screen app.
