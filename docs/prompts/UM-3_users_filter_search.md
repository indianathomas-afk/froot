NEW SESSION — UM-3: location filter and search on /users — TIER 2

TIER 2: contained. One screen. New UI over data the page already
fetches and already renders. No schema, no migration, no new API
route, no permissions change, no Prisma query change. Brief audit,
then build without waiting for approval.

Save this prompt to docs/prompts/UM-3_users_filter_search.md before
starting. If a file already exists at that path, do NOT overwrite —
read it, report what it contains, and stop.

---

REPO GATE — run one at a time, no && chains, paste each result.

pwd
(must end in Froot/froot — lowercase. The capital-F parent is a trap.)

git remote -v
(must show indianathomas-afk/froot)

git status
(must be clean, on staging. Pre-existing untracked items are not
yours to touch. Anything else, stop and report.)

grep -n "id: UM-" docs/ROADMAP.yaml
(UM-3 must NOT already exist. If it does, stop and report — do not
pick another id yourself.)

---

WHAT THIS IS

/users renders one card, "Organization Members", with two tables:
accepted members (User rows with storeAssignments) and pending
invitations (PendingInvite rows with storeIds). This adds, directly
beneath the "Invite users and control which locations they can
access" subtitle, left-aligned, in this order:

  1. a location dropdown — the same component and the same
     "All locations" label the /staff filter reuses from the
     dashboard (STAFF-2, docs/prompts/STAFF-1_location_filter.md —
     the prompt is saved under the briefed name; the roadmap id is
     STAFF-2). Do not write a new picker. Do not share its storage
     key.
  2. a text input, placeholder "Search by name or email".

Default state is "All locations" and an empty search — which renders
precisely what the page renders today, unchanged.

FILTER RULES (both tables, AND-combined):

- Location: a member matches when any of their storeAssignments is
  the selected store. A pending invite matches when its storeIds
  include the selected store.
- ADMIN members have no storeAssignments by design ("Admins have
  access to all locations automatically"). They match EVERY
  location selection, because that is their actual access. Do not
  hide admins when a store is selected.
- Search: case-insensitive substring over the rendered name and the
  email, for members and for pending invites. Trim the input. A
  device account whose name slot shows its email still matches on
  that email.
- When a filter is active and a table has no matching rows, render
  a single quiet row "No matches" in that table. Do not reuse the
  existing empty-org state.
- Header counts ("52 members · 15 pending") stay the org totals.
  When any filter is active, append " · showing N" for the members
  table only, where N is the filtered member count.

EXPLICITLY OUT OF SCOPE — do not do these, do not propose them:
- Do NOT touch the Clerk-membership sync block in
  src/app/(app)/users/page.tsx (the upsert loop around :65-98 in the
  2026-07 numbering — DEBT-17's territory). Not one character.
- Do NOT change any Prisma query, the Clerk calls, or the invite
  fetch. Every row the page fetches today is still fetched.
- Do NOT touch requireAdmin, getUserStoreScope, or any capability.
- Do NOT touch user-actions.tsx (Edit / Invite / Delete dialogs).
- No localStorage, no URL param, no shared store context. Plain
  component state that resets on reload. UX-2 unifies selectors
  later; do not pre-empt it.
- Dropdown options come from the store array the page ALREADY has
  in scope for the chips (storeById / the store list it maps
  storeIds against). Not a fresh store query.

---

PHASE A — brief audit, report as you go, then keep building.

1. Read src/app/(app)/users/page.tsx in full. Report: whether it is
   a server component; the exact lines of the sync block you will
   not touch; the line where the store list used for chips is built;
   where the members array and the pendingInvites array are
   finalised before rendering.

2. Open src/app/(app)/staff/page.tsx and the client component
   STAFF-2 introduced. Report the component's file path and the
   picker component + label string it reuses. We mirror that shape.

3. Pick the state shape and say why in one line: lift the two-table
   JSX into a small client component that receives the already-built
   members, pendingInvites and stores arrays as props, unless you
   find something simpler already in the file. Then build it.

PHASE B — build.

- Options: "All locations" first, then stores in the order the page
  already uses for chips.
- Filtering is pure client-side over the props. Row markup, chips,
  role badges, the "Device at X" badge, dates and action buttons are
  untouched — the action buttons keep working on filtered rows.
- Both tables filter from the same two controls.

---

GATE AND COMMIT

Scoped lint on touched files only, then bare npm run build. No
pipes in the gate chain. No bare npm run lint (DEBT-33).

One work commit on staging, scoped `git add` on touched files only
(no `git add -A`). Then a second commit adding the ROADMAP.yaml row
for UM-3 (track: platform, size: S, status: staging, quoted short
SHA of the work commit), written from what was actually done,
including a line noting this is a new selector site for UX-2 to
absorb.

DO NOT PUSH. Gary runs every push. Report the unpushed-commits line
explicitly.

---

REPORT BACK

1. Phase A line references, drift called out if numbers moved.
2. Which state shape you used and the client component's path.
3. Files touched.
4. Confirmation the default view is byte-identical in behavior to
   today, and that the sync block diff is empty.
5. The two commit SHAs and the explicit unpushed line.
6. Anything found and not fixed, triaged: FIX NOW / RULING NOW /
   COMMENT / ROW. Default to the first three.
