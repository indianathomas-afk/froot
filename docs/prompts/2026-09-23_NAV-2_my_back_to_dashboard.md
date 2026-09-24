TIER 2 session. Read /Users/garythomas/Claude_Projects/Froot/froot/docs/prompts/2026-09-23_NAV-2_my_back_to_dashboard.md and execute it.

# NAV-2 — /my back to dashboard — TIER 2

Contained UI change. No schema, no permissions, no new routes. Commits only, never pushes.

## Problem (reported again 2026-09-23, from production)
Neesha Hartman (real manager, Carson store) taps her training on the /dashboard
compliance banner and lands on /my. The /my header is logo + help + Sign out;
the tab bar is Home · Messages · Documents. There is no way back to /dashboard
except signing out and back in. STAFF are fine — /my is their home.

A fix was specced 2026-09-18 as `docs/prompts/2026-09-18_NAV-2_my_back_to_dashboard.md`.
Project knowledge (main) contains no trace of it, so it was either never run,
never pushed, or never promoted. Find out which before building.

## Step 0 — where did the 09-18 fix go? (read-only, report before building)
Run and paste results:
- `git log --oneline --all --grep="NAV-2"`
- `git log --oneline main..staging`
- `ls /Users/garythomas/Claude_Projects/Froot/froot/docs/prompts/ | grep -i nav-2`
- `grep -n "NAV-2" /Users/garythomas/Claude_Projects/Froot/froot/docs/ROADMAP.yaml`
- `grep -rn "Dashboard" /Users/garythomas/Claude_Projects/Froot/froot/src/app/\(my\)/my/my-shell.tsx`

Then:
- **Code exists on staging, not on main** → STOP. Report the SHAs. No build; Gary promotes.
- **Code exists on main** → STOP. It is on production but not working — report
  which /my pages render MyShell without the link (see Step 1 grep). That is the bug.
- **No code anywhere** → build below. If the 09-18 prompt file sits untracked,
  commit it with the docs commit as the superseded record; do not delete it.

## Build
1. List every call site: `grep -rn "<MyShell" /Users/garythomas/Claude_Projects/Froot/froot/src`.
   Every one of them must end up showing the link for non-STAFF. Missing a page
   is the most likely way this "fix" fails again.
2. Resolve the viewer's role in ONE place so no page can forget it. Lean: if
   MyShell is a server component, read the role there via the existing
   `getCurrentUser()`; if it is a client component, add a thin server wrapper
   that reads the role and passes `showDashboardLink` down, and point every call
   site at the wrapper. Do not thread a prop through each page by hand.
   Rule: `showDashboardLink = dbUser.role !== "STAFF"` (ADMIN, MANAGER, STORE all get it).
3. When true: the Froot logo becomes a `Link` to `/dashboard`, AND a visible
   "← Dashboard" text link sits in the header beside it (a logo alone is not
   discoverable). ≥44px tap target. Must fit a 380px-wide phone header next to
   help + Sign out without wrapping — if tight, shorten to "← Back" is NOT
   allowed; shrink "Sign out" spacing instead and say so in the report.
4. When false (STAFF): header byte-identical to today.
5. No new bottom-bar tab.

## Verify (Gary tests on staging after push — write the steps into the report)
- `indianathomas` (ADMIN) and Tommy `corporate@keva.com` (STORE): /dashboard →
  tap the training banner → /my shows "← Dashboard" → tap it → lands on /dashboard.
  Repeat from /my/documents and one training page.
- A STAFF login: /my header unchanged, no link.
- Evidence names org ID and Clerk instance.

## Commits
Two-commit pattern (work, docs). `npm run build` gates. `git add` only touched files.
ROADMAP row NAV-2 — read the file for the next free id and state; do not assume.
Stop after commit and report. Gary runs PRE-PUSH-CHECK, pushes, tests on staging,
then promotes — Neesha only sees this once it is on main.
