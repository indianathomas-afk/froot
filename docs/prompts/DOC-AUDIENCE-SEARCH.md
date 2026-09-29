# DOC-AUDIENCE-SEARCH — search box for Individuals in "Who is this document for?"

**TIER 2** — contained UI change. No schema, no migration, no API change, no permission change. Brief audit, then build. Declare the tier before writing anything.

Repo: `/Users/garythomas/Claude_Projects/Froot/froot` (branch `staging`). Commit only — never push.

## What Gary wants

On `/hr/documents`, the audience dialog ("Who is this document for?" → "Choose stores or people") lists every staff member under **Individuals** with no way to find one person except scrolling. Add a search box so an admin can type a name and tick that person.

## Brief audit (report in a few lines, then build — do not stop)

1. Find the audience dialog component under `/Users/garythomas/Claude_Projects/Froot/froot/src/` (search for the string `Who is this document for?`). Report its full path.
2. Confirm the Individuals list is already fully loaded client-side. If it is paged or fetched per keystroke from an API, STOP and report — that would make this a different change.
3. Check whether a search/filter input pattern already exists nearby (e.g. the HR-34 bulk assign dialog, the `/staff` list). Reuse its component and styling if one exists; otherwise use the shadcn `Input` already in the repo.

## Build

- Search input directly under the **Individuals** heading, above the list. Placeholder: `Search people`. Search icon on the left, clear (×) button on the right when non-empty.
- Filters the Individuals list as you type: case-insensitive, substring match on the displayed name, whitespace trimmed. Match first or last name ("sol" finds Adam Solin).
- **Filtering never changes selection.** A ticked person stays ticked when the search hides them. Show a small `N selected` count next to the Individuals heading so hidden selections aren't invisible.
- Empty state when nothing matches: `No one matches "<query>"` inside the list box.
- Pressing Enter in the search box must NOT save the dialog or submit anything.
- Search text resets each time the dialog opens. No autofocus (Stores sits above it).
- The Stores list is unchanged (short list, no search).
- Nothing about who the audience reaches, how it saves, or the "reaches N" counts changes.

## Out of scope

Any change to audience rules, corporate-staff handling, the save route, or other dialogs. File anything else you notice as FIX NOW / RULING NOW / COMMENT / ROW per house rules before the report.

## Docs

- `/Users/garythomas/Claude_Projects/Froot/froot/docs/ROADMAP.yaml`: add one row for this phase. Read the file for the next free DOC id — never assume. Status `in_progress` (PRE-PUSH-CHECK flips it).

## Verify before committing

- `npm run build` passes; lint clean on touched files.
- No `__` tokens or `[PASTE` placeholders in touched files.

## Commits

- One work commit (code), one docs commit (ROADMAP). Stage only the files this session touched — no `git add -A`.

## Report

Tier, component path, whether an existing search pattern was reused, files touched, commit SHAs, build result, any findings with their classification, and the staging test steps below.

## Staging test (Gary, after PRE-PUSH-CHECK and push)

1. `/hr/documents` → Key Agreement → people icon → "Choose stores or people".
2. Type `sol` → only Adam Solin shows. Tick him.
3. Clear, type `bravo` → tick Alexander Bravo. Count reads `2 selected`.
4. Clear the search → both still ticked. Type `zzz` → empty-state line shows.
5. Press Enter in the search box → dialog stays open.
6. Save audience → the document badge reads `2 people`. Reopen → search is empty, both still ticked.
