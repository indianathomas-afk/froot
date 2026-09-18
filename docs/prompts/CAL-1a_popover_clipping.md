<!-- RECONSTRUCTED 2026-09-18 in the CAL-1a PRE-PUSH-CHECK session, verbatim from Gary's pasted message: this file did not exist when the build session ran, which that session should have caught and did not. Never edited after. -->

TIER 1 session. Read docs/prompts/CAL-1a_popover_clipping.md and execute it. Repo gate first, one command at a time.

# CAL-1a — Calendar create/detail popover clips off-screen — TIER 1

Cosmetic. One work commit, one docs commit. No schema, no routes, no
capability changes. You never push.

## Repo gate
pwd must end in Froot/froot. git status: on staging, clean.

## Defect
On /calendar, clicking a day in the top rows of the grid opens the
create popover anchored to the cell; the top of the form sits above the
viewport and cannot be scrolled into view. Observed on staging
2026-09-18 by Gary. The detail popover (click on an item) has the same
anchoring and the same exposure.

## Fix
Replace the anchored popover for BOTH the create-reminder form and the
occurrence detail view with the existing shadcn Dialog component:
centered, max-height bounded to the viewport with internal scroll,
Escape and backdrop-click to close. Keep the Event | Reminder tab strip
and every field exactly as they are. No drag behaviour. No new
dependency. Reuse whatever Dialog the app already uses (check
/users Edit User for the pattern).

## Gates
npm run build exit 0, read without a pipe. Scoped eslint on touched
files, no pipe.

## Docs
ROADMAP: CAL-1a row, TIER 1, citing the work SHA; prepend a one-line
rider to CAL-1 noting the fix. No DECISIONS entry (no ruling). No
DEPLOY_LOG entry (rides CAL-1's unpromoted entry — add one line to it).

Report the SHAs and stop. Do not suggest further work.
