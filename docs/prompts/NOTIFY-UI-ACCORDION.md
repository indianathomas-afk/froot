# NOTIFY-UI-ACCORDION — TIER 2

TIER 2: contained UI change. No schema, no migration, no new route, no new
dependency, no change to any save route or email. Plan briefly, build, two
commits, STOP. Never push — Gary runs all pushes.

Working name for this file is NOTIFY-UI-ACCORDION. The ROADMAP row id is NOT
assumed: read /Users/garythomas/Claude_Projects/Froot/froot/docs/ROADMAP.yaml
and take the next free NOTIFY-n (DEBT-84 rule — always read the file).

## Repo gate (one command at a time, paste each result before the next)

pwd                      → must end in Froot/froot (lowercase froot)
git status               → on staging, tree clean
git log --oneline -5     → paste it; this is the HEAD the session works from

If the gate fails, STOP and report. Do not fix it.

## What Gary asked for (his words, condensed)

1. On /settings: rename "Behind-pace alerts and signed-acknowledgment emails"
   to "Message Center Settings", and rename "Email Notifications" to
   "Email Notification Settings".
2. On /settings/notifications: make the page collapsible so an admin sees only
   the settings they need. Accordion chosen (over a hamburger menu), with an
   Expand all option.

## Step 1 — locate the strings (read-only, report before editing)

Grep src/ and docs/guide/ for both strings, case-insensitive:
- "Behind-pace alerts and signed-acknowledgment emails"
- "Email notifications" / "Email Notifications"

Planning chat's reading: the /settings link card added by NOTIFY-2a has a title
("Email notifications →") and a description line ("Behind-pace alerts and
signed-acknowledgment emails"). Title becomes "Email Notification Settings";
description becomes "Message Center Settings". The hub page h1 (and its page
metadata title, if any) also becomes "Email Notification Settings" so the door
and the room carry the same name.

RULING NOW — STOP and report the exact current strings and their file:line if
ANY of these is true: a string is not found; it appears somewhere other than
the link card / hub header; the card at HEAD no longer carries the description
line. Do not guess a mapping.

Help articles in docs/guide/ that name the page get the new name; the help
generator runs at build, so npm run build covers it. Do not rewrite article
prose beyond the name.

## Step 2 — accordion on /settings/notifications

Every top-level card on the page becomes a collapsible section — each email
type's card, the contacts/address-book card, and Recent emails. Nothing is
removed or reordered.

- Section header: the card's existing title plus a one-line status summary
  built ONLY from data the page already loads (e.g. "On · Weekly, Mon 8 AM",
  "Off", "3 contacts", "Last 50 sends"). No new queries. If a card has no
  honest one-line summary, show the title alone — never invent one.
- Chevron button per header: a real <button>, aria-expanded, aria-controls,
  keyboard operable.
- One control at the top of the page: "Expand all" / "Collapse all" (one
  button whose label follows state: if any section is collapsed it reads
  Expand all).
- Default on first visit: all collapsed. The open/closed state per section is
  remembered per browser in localStorage under one key, read and written in
  try/catch; empty or unreadable storage = all collapsed. Follow the CAL-2c
  pattern in /Users/garythomas/Claude_Projects/Froot/froot/src/components/calendar-due-banner.tsx
  (repo lints react-hooks/set-state-in-effect — read storage where CAL-2c
  does, not in a bare effect).
- Animation: hand-rolled measured height, as CAL-2c did. Do NOT use the
  accordion-down/accordion-up keyframes in globals.css (dead CSS, need a Radix
  var) and do NOT install Radix Accordion/Collapsible.
- LOAD-BEARING: collapsing a section must never discard unsaved edits. Keep
  collapsed content MOUNTED (visually hidden, inert to tab order), not
  unmounted. Typing a threshold, collapsing, and re-expanding shows the typed
  value.
- Prefer one small shared component (e.g. src/components/settings/collapsible-section.tsx)
  over per-card edits. Card bodies are untouched.

Draft ruling for docs/DECISIONS.md (marked DRAFT — ratified only by Gary at
PRE-PUSH-CHECK): "Sections on /settings/notifications start collapsed, remember
their state per browser, and collapsing never discards an unsaved edit."

## Step 3 — verify

npm run build → must pass; paste the tail. Confirm no error line above it.
Lint does not gate (DEBT-33).

Gary does not test locally. Write the staging test list into the ROADMAP row:
1. /settings shows "Email Notification Settings" with "Message Center
   Settings" beneath it.
2. /settings/notifications header reads "Email Notification Settings"; all
   sections collapsed on first visit; headers show status lines.
3. Expand all / Collapse all works; individual chevrons work.
4. Type a pace threshold, collapse, expand → value still there; Save works.
5. Reload → open/closed state survives.
6. Same on phone width.

## Step 4 — commits (scope git add to files this session touched; never -A)

Commit 1 (work): the component, page and string changes.
Commit 2 (docs): ROADMAP row (status in_progress, work SHA as a quoted short
SHA, staging test list), the DRAFT DECISIONS entry, and this prompt file
docs/prompts/NOTIFY-UI-ACCORDION.md if not already committed. No meta.updated
key. Preserve-and-mark: nothing deleted.

## Step 5 — report and STOP

Report: the two SHAs, files touched, the before/after strings with file:line,
and any FIX NOW / RULING NOW / COMMENT / ROW findings. Do not push. Do not
start other work.
