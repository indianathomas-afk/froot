NEW SESSION — STAFF-1: location filter on /staff — TIER 2

TIER 2: contained. One screen. New UI over data the page already
fetches and already renders. No schema, no migration, no new API
route, no permissions change, no query change. Brief audit, then
build without waiting for approval.

Save this prompt to docs/prompts/STAFF-1_location_filter.md before
starting. If a file already exists at that path, do NOT overwrite —
read it, report what it contains, and stop.

---

REPO GATE — run one at a time, no && chains, paste each result.

pwd
(must end in Froot/froot — lowercase. The capital-F parent is a trap.)

git remote -v
(must show indianathomas-afk/froot)

git status
(must be clean, on staging. Two untracked items are expected and are
NOT yours to touch: "Claude outputs/" and docs/ROADMAP.yaml.bak.
Anything else, stop and report.)

---

WHAT THIS IS

/staff renders one card per store, each with that store's team
members. That grouping is correct and Gary has ruled it stays
exactly as it is. This adds a dropdown that narrows which cards are
on screen. That is the whole feature.

Default is "All locations" — which renders precisely what the page
renders today, unchanged.

EXPLICITLY OUT OF SCOPE — do not do these, do not propose them:
- Do NOT change the grouping key. Members stay grouped by primary
  store. DEBT-13 is not in scope and is not being fixed here.
- Do NOT special-case corporate staff. They render where they
  render today.
- Do NOT change getStaffData or any Prisma query. Every member the
  page fetches today is still fetched.
- Do NOT touch getUserStoreScope or any capability check.
- No localStorage, no URL param, no shared store context. Plain
  component state that resets on reload. UX-2 will unify selectors
  later; do not pre-empt it.

---

PHASE A — brief audit, report as you go, then keep building.

1. Read src/app/(app)/staff/page.tsx in full. Report: the line that
   builds the ordered store list actually rendered (the
   stores.filter(...) around :118 in the 2026-07 line numbering —
   re-verify, do not trust the number), and whether the page is a
   server component.

2. Find the dashboard's store selector — the one rendering "All
   locations" plus each store, with a check on the current choice.
   Start at src/app/(app)/dashboard/dashboard-client.tsx (~:166).
   Report the exact component used and the exact label string. We
   reuse that pattern and that string verbatim; we do NOT write a
   new picker and we do NOT share its storage key.

3. Report which shape fits for holding selection state, and pick
   one: (a) lift the group-rendering JSX into a small client
   component that receives the already-built groups as props, or
   (b) something simpler you find in the file. Say which and why in
   one line, then build it.

PHASE B — build.

- Dropdown options come from THE SAME array the page already
  filters to render cards. Not a fresh store query. This is what
  guarantees a MANAGER's dropdown lists only their stores and
  nothing new can appear.
- Options: "All locations" first, then the stores in the order the
  page already renders them.
- Default: "All locations".
- Selecting a store renders only that store's card. The card, its
  header, its member count and its rows are untouched.
- Placement: left-aligned directly beneath the "Manage team members
  for each store location" subtitle. Do not add a fifth control to
  the header button row.
- If the caller has exactly one store, still render the dropdown.
  Do not add a single-store shortcut.

---

GATE AND COMMIT

Scoped lint on touched files only, then bare npm run build. No
pipes in the gate chain. No bare npm run lint (DEBT-33).

One work commit on staging. Then a second commit adding the
ROADMAP.yaml row for STAFF-1, written from what was actually done,
including a line noting this is a new selector site for UX-2 to
absorb.

DO NOT PUSH. Gary runs every push. Report the unpushed-commits line
explicitly.

---

REPORT BACK

1. The two line references from Phase A, drift called out if the
   numbers moved.
2. Which state shape you used.
3. Files touched.
4. Confirmation that the "All locations" view is byte-identical in
   behavior to today.
5. The two commit SHAs and the explicit unpushed line.
6. Anything found and not fixed, triaged: FIX NOW / RULING NOW /
   COMMENT / ROW. Default to the first three.
