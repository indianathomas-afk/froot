TIER 2 — CHK-VIDEO-LINKS: only real web links can be saved or shown as a task's training video

Repo: /Users/garythomas/Claude_Projects/Froot/froot
House rules: /Users/garythomas/Claude_Projects/Froot/froot/CLAUDE.md applies in full — evidence standards, build gate, commit only, never push.

## Why
Task.videoUrl is free text. The template editor saves whatever is typed, and the desktop checklist page (checklist-execution-client.tsx, around lines 600–645) turns it straight into a "Watch Training Video" link. A value like javascript:… becomes a clickable link for every team member. TAB-15 already hides non-http(s) links on the tablet. This phase closes the same gap everywhere else: validate on save, and never render anything that isn't http(s).

## Step 0
Read /Users/garythomas/Claude_Projects/Froot/froot/docs/ROADMAP.yaml and take the next free CHK id for this phase's row and commit messages. Report which id you used.

## Step 1 — short audit (report it, then keep going; stop only for a RULING NOW)
Answer each with file:line:
a. Every place videoUrl is written: template create and edit, template import (/api/templates/import), and anything else that sets it.
b. Every place it's rendered as a link or embed: the desktop execution page, print views, template detail/preview pages, the tablet (TAB-15), and anything else.
c. The http(s) check TAB-15 added for the tablet: where it lives, and whether it can be reused as is.
If a schema change or a data change looks necessary, that's a RULING NOW — STOP.

## Step 2 — build
1. One shared helper in src/lib that the whole app uses. It takes the typed value, trims it, and returns a clean http(s) URL or null. A value with no scheme that looks like a web address (www.youtube.com/watch?v=…) gets https:// added. Anything with any other scheme (javascript:, data:, file:, etc.) returns null.
2. Saving in the template editor: an invalid link is refused with an inline message under the field: "Use a web link that starts with https://". The editor keeps what was typed so it can be fixed. The server route enforces the same rule, so a hand-made request can't get around it.
3. Template import: an invalid link doesn't stop the import. The task imports without the link, and the import result lists which tasks had their link dropped.
4. Rendering: every site from audit (b) runs the value through the helper and shows nothing when it returns null. TAB-15's tablet check switches to the shared helper with no change in behaviour.
5. No backfill and no data change. Existing bad values simply stop rendering.

## Fixture
A small pure-function check in scripts/ (same style as verify-tab9-cards.ts) for the helper: https and http pass unchanged; a bare www. address gets https://; javascript:, JAVASCRIPT:, " javascript:", data:, file:, mailto:, an empty string and whitespace all return null.

## Done when
- npm run build passes; two commits per CLAUDE.md (work, then docs citing the work SHA); a ROADMAP row under the CHK id from Step 0.
- Report: audit answers with file:line, files changed, the fixture result, and out-of-scope findings classified FIX NOW / RULING NOW / COMMENT / ROW.
- Staging test list for Gary:
  1. Template editor: save javascript:alert(1) as a video link → refused with the inline message.
  2. Save www.youtube.com/watch?v=… (no https) → saves as https://www.youtube.com/watch?v=… and plays on the tablet.
  3. An existing working video link still shows "Watch Training Video" on desktop and "Watch" on the tablet.
  4. Import a template with one bad link → the import succeeds and names the task whose link was dropped.
