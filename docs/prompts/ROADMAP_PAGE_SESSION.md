# Session: Live /roadmap page — the self-updating development dashboard

**Save to:** `docs/prompts/ROADMAP_PAGE_SESSION.md`
**Size:** M (new route + first YAML dependency + a client component)
**Done criterion:** `next build` passes, `/internal/roadmap` renders the current
`docs/ROADMAP.yaml`, and its "last updated" timestamp is derived from git — not a
hardcoded value. `package-lock.json` committed with the new dependency.

---

## Why this exists

There's a static HTML dashboard (`froot-roadmap-dashboard.html`) that renders the
roadmap, but it's a hand-generated snapshot — its "last updated" date is typed in,
so it goes stale the moment anything changes. This session replaces it with a live
in-app page that reads `docs/ROADMAP.yaml` on every deploy and times itself from
git, so it can never silently fall out of date.

The static HTML is the **visual spec** — match its layout and behavior. It's in
the repo owner's Downloads folder; if it's not available to you, the design is
described below in full.

---

## Audit first — edit nothing yet

Report back before any changes:

1. **Route location & auth.** Where do sidebar/app pages live (`src/app/(app)/…`)?
   How is an ADMIN-only page gated today — is there a `requireRole`/`requireAdmin`
   helper in `src/lib/auth.ts`, or how do existing admin-only routes protect
   themselves? I want `/internal/roadmap` gated to ADMIN.
2. **YAML parsing.** No YAML parser is a dependency yet. Confirm, and propose one
   (`yaml` is the clean choice). This is the FIRST dependency change — flag that
   `package-lock.json` must be committed with it.
3. **Reading the file at runtime.** Confirm a server component can read
   `docs/ROADMAP.yaml` from disk at request/build time in this Next 16 setup
   (path from repo root, `fs`/`path`, Node runtime — not edge). If the file won't
   be on the serverless filesystem at runtime, propose reading it at build time
   instead (e.g. import-as-string or a small generate step) and tell me which.
4. **Git timestamp.** I want the "last updated" shown on the page to be the git
   commit date of `docs/ROADMAP.yaml`, captured at build. Check what's feasible on
   Vercel: can a build step run `git log -1 --format=%cI -- docs/ROADMAP.yaml` and
   write the result somewhere the page can read? If git isn't available at build,
   propose the best fallback (Vercel's commit env var, or `meta.updated` from the
   YAML as a last resort) and say which you'll use.
5. **Design tokens.** Confirm the app's existing color tokens / status colors so
   the page matches the app, not the standalone HTML's inline palette.
6. **Schema/config.** Confirm this needs NO Prisma change and NO env var. (It
   shouldn't — it's a read-only file render behind an ADMIN gate.)

Present the plan — route path, dependency, file-read strategy, timestamp
strategy, and the server/client split. **Wait for approval.**

---

## Task — build `/internal/roadmap`

Follow the app's page convention: a **server component** reads and parses the
YAML and resolves the git timestamp, then passes plain data to a **client
component** (`*-client.tsx`) that renders the interactive board.

**Server component:**
- ADMIN-gated (same mechanism existing admin pages use). Non-admins get the
  standard not-authorized behavior, not a blank page.
- Reads `docs/ROADMAP.yaml`, parses it, passes `phases`, `debt`, `bugs`, and the
  resolved `lastUpdated` (git commit date of the file) to the client component.
- Add `export const metadata = { robots: { index: false, follow: false } }` and
  confirm the route is disallowed in `robots.ts`/`robots.txt`. (Auth is the real
  protection; noindex is belt-and-suspenders.)

**Client component — mirror the static HTML spec:**
- **Header:** title + a freshness line showing `lastUpdated` and a computed
  "updated N days/hours ago". Because it's derived from git, it's always true.
- **Summary strip:** counts of In production (`shipped`+`verified`), In staging,
  Planned, and Open blockers (phases with a non-empty `blockers`).
- **Blockers & gates panel:** every phase with `blockers`, sorted high→med→gate,
  each showing phase id, severity, what, why.
- **Staging → Production pipeline:** phases with `status: staging` in the left
  lane (with their gate shown), a note on the right that everything else is live.
- **Board:** three columns — Planned, In staging, In production — cards colored by
  track, showing id, title, badges (shipped date, blocker count, deferred count),
  expandable to notes/blockers/deferred/commits/keywords.
- **Search box:** filters cards across id, title, track, notes, and a `keywords`
  field (if present on the phase). Show a result count.
- **Track filter chips.**
- Keep the palette in the app's own tokens.

**Retire the static file:** in `docs/prompts/` or wherever it's referenced, leave
a one-line note that `/internal/roadmap` is now the live dashboard and the
downloaded HTML is deprecated. Do not delete anything outside the repo.

---

## Constraints

- App code + one dependency. Additive only. No Prisma change, no env var.
- **Commit `package-lock.json`** with the YAML dependency — this is the known
  trap; `npm ci` in CI fails without it.
- Read-only render: the page must never write to `ROADMAP.yaml` or the DB.
- Don't touch `../froot_docs/`.
- Stay in scope: a roadmap viewer. Note anything else you spot as text.

---

## After this session (so it stays honest)

- Confirm the session-completion rule in `docs/WORKFLOW.md` already requires
  updating the touched phase in `ROADMAP.yaml` each session. If it doesn't
  explicitly say to bump `meta.updated`, add that — though once the page reads the
  git date, the timestamp self-maintains regardless.

## Report back

1. Route path, dependency added, and the file-read + git-timestamp strategy you used.
2. Whether the git commit date resolves correctly on a Vercel build (and the
   fallback if not).
3. Confirmation `package-lock.json` is committed and `npm ci` would pass.
4. `next build` result and the URL to view it on staging.
