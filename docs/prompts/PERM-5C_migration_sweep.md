# PERM-5 Session C — The migration sweep (inline checks → can())

**Track:** PERM (permissions)
**Branch:** staging
**Type:** Implementation (call-site migration + registry + grid rows). No schema.
**Size:** M (mechanical but wide: ~45 sites; the risk is coverage, not design)
**Prerequisites:** PERM-5B verified on staging 2026-08-04 (commits 5119a6b,
24eb289; grid live; acceptance passed with gary@keva.com). The machinery this
session extends — the can() seam, actorFor(), ENFORCED_CAPABILITIES — is the
substrate; do not modify the seam itself.
**Created:** 2026-08-04

---

## The point of this session, in one sentence

Make these two sentences true, which the PERM-5A audit proved false:
(a) "Gary Thomas (MANAGER) keeps /inventory but loses /staff entirely."
(b) "Gary Thomas keeps /staff read access but cannot edit employees."
Everything below serves those two acceptance tests.

## Opening commit (before the sweep)

Apply the PERM-5B verification note to the PERM-5 row in docs/ROADMAP.yaml
(Gary will paste the text into the session or point at it). House pattern:
work commit, then SHA-recording commit — but since this is docs-only it can
be one commit at the start; record its SHA in your report.

## RULINGS ALREADY MADE — do not reopen

1. Restrict-only, structural, via the can() seam — unchanged from B.
2. **The PERM-2 discipline is the definition of done per area:** a capability
   is migrated only when denying it kills the nav entry, the page, AND every
   API route together. A hidden nav with an answering API, or a 403ing API
   behind a rendering page, is the named bug class — do not create either,
   even transiently between commits (migrate an area atomically per commit).
3. **No new inline role checks anywhere.** Migrations replace
   requireAdmin/requireManagerOrAdmin with can() checks that preserve the
   CURRENT role baselines exactly — this session changes who ENFORCES, never
   who is ALLOWED. Any place where the registry's baseline disagrees with
   the inline check being replaced: STOP, report the disagreement, do not
   pick a side silently.
4. **Grid rows are added by appending to ENFORCED_CAPABILITIES** — including
   promoting templates.manage and inventory.po.manage (named in B's comment
   as C's first two appends) once their APIs are migrated.
5. HR stays out (its own future phase). The ungoverned surfaces from the
   audit (/dashboard's missing guard aside, operational inventory pages,
   /messages, /store-view, /labor) stay out — they are module-gate-only BY
   DESIGN pending their own rulings; this session migrates existing role
   checks, it does not invent new restrictions.

## Task C1 — Staff (the headline, ~18 sites)

Per the audit: /staff/layout.tsx:6, staff/[id]/page.tsx:87,
api/staff/access.ts:29, api/staff/[id]/{route, reactivate, resync-square,
terminate, invite, square-writeback}, notes/access.ts:34,:47,
notes/[noteId]/route.ts:62 — plus wiring staff.documents.manage and
staff.notes.use (both currently zero-reference) into the notes chain.
Re-derive the exact list from HEAD before editing; the audit ran at eabf779
and the tree has moved.

Tiering decision to make and report: which sites gate on staff.view (read
surfaces: layout, list, detail page, GET routes) vs staff.manage (write
surfaces: PATCH, terminate, reactivate, invite, resync, writeback) vs the
notes/documents capabilities. The registry already tiers staff.view /
staff.manage at MANAGE baseline — preserve those baselines per ruling 3.

## Task C2 — The five coarse areas (cheap, per the audit's site counts)

- Users: users/page.tsx:237 + 7 API sites → users.manage (8)
- Templates: 7 requireAdmin() sites in api/templates/* → templates.manage (7)
- Stores: stores/layout.tsx:6 + 4 /api/stores sites → stores.view/manage (5)
- Settings: settings/page.tsx:23, settings/labor/page.tsx:28 →
  settings.access (2)
- Dashboard: dashboard/page.tsx:33 canSeeCounts (PERM-3 finding #13) +
  a dashboard.view page guard (2)
- Reports: reports/layout.tsx:6 → reports.view (1)
Re-derive each list from HEAD. Same atomic-per-area commit rule.

## Task C3 — Registry splits (decision + report before implementing)

The audit found two areas where one capability fuses view and manage with no
tier: **Users** (users.manage = see the list + invite + change roles +
remove) and **Settings** (settings.access = see the page + toggle every
module). Propose whether to split them (e.g. users.view/users.manage,
settings.view/settings.manage) or migrate them coarse for now. Consider:
a split is a registry change with baseline choices Gary must approve; coarse
migration is honest ("denying Users removes all of it") and splittable
later. Recommend one, with the trade named. WAIT for Gary's call on this
before implementing C2's Users and Settings entries.

## Task C4 — Self-lockout, now that users.manage is load-bearing

B deferred this with a comment. Once /users and its PATCH route ask
can(users.manage), verify — by reading the code, and state the chain in
your report — that no sequence of override edits can leave the org with
zero users-capable admins. The expected argument: the PATCH route refuses
self-edits (route.ts:56), so an admin can never deny themselves; an admin
who denies another admin retains the capability; a denied admin cannot
reach the PATCH to retaliate. If the argument fails anywhere, propose the
minimal guard; if it holds, write it as a comment at the route and no guard.

## Task C5 — Acceptance (staging checklist for Gary)

Principal: gary@keva.com (MANAGER, Carson) on the staging org, as in B.
1. Example (a): deny staff.view (and staff.manage if your tiering requires
   both for "entirely"). As gary@keva.com: Staff gone from nav, /staff and
   /staff/[id] bounce, every /api/staff/* route refuses, /inventory
   untouched. Include exact URLs and expected statuses.
2. Example (b): clear (a); deny only the write tier. As gary@keva.com:
   /staff renders and lists, detail pages render WITHOUT edit affordances,
   PATCH/terminate/invite/writeback refuse.
3. Spot-check two coarse areas: deny users.manage on a second principal
   (NOT the acting admin) and confirm the page bounces and APIs refuse;
   deny reports.view and confirm the same.
4. The grid: new rows appear for every migrated area; templates and PO
   rows no longer carry the page-only caveat.
5. Regression: an untouched MANAGER and an ADMIN behave exactly as before
   this session — no baseline changed (ruling 3's proof).
6. End with all principals at zero denials. Org id on every browser
   observation.

## Constraints

- The can() seam, actorFor(), and the storage shape are FROZEN — extend
  call sites, never the machinery.
- next build green per commit; chained, no pipes. Commit per area
  (staff / users / templates / stores / settings / dashboard / reports),
  so a bad area reverts alone.
- npm run lint is not a gate (DEBT-33). Never push. No schema changes —
  if you believe one is needed, STOP and say so.
- Do not touch ../froot_docs/. Out-of-scope findings: FIX NOW / RULING
  NOW / COMMENT / ROW triage before the report; a row is the last resort;
  give counts.

## Explicitly NOT in scope

HR (own phase). Operational-inventory/messages/store-view/labor governance
(own rulings). DEBT-55's remaining 20 lookup sites. DEBT-57 fossils. UM-2.
DEBT-49. The invite guard. Anything touching PendingInvite.

## Report back

1. SHA before/after; the opening docs commit; per-area commit list.
2. The re-derived site lists vs the audit's, with any drift explained.
3. C3's split recommendation and Gary's ruling as applied.
4. C4's lockout argument, verified or the proposed guard.
5. Any baseline disagreements found under ruling 3 (expect none; say so).
6. The C5 checklist ready for Gary.
7. Triage buckets with counts; explicit unpushed-commits line.
