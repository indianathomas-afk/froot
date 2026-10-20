TIER 2 session. Small display change to MS-5. No schema, no migration. Commit only, never push.

Ruling (Gary, 2026-10-19): "Remove the Milestone report button from the /staff page and leave it on the /staff/milestones page. The reason is that /staff is getting cluttered." Scope: on /staff, ADMINs no longer see the "Milestone report" button (they reach it from /staff/milestones). MANAGERs, who can't open /staff/milestones, keep the "Milestone report" button on /staff as their only route to the report. Each role sees one milestone button.

Repo gate first, one command at a time. Pick a free phase ID (lean MS-5b), save this prompt in docs/prompts/, make the change, update verify-ms5 for both roles (ADMIN: no report button on /staff; MANAGER: report button present), re-run verify-ms5, lint, build, work commit, then a docs commit (ROADMAP row, DECISIONS entry in my words, the prompt). Stop with "Done and committed. Next: PRE-PUSH-CHECK for <ID>."
