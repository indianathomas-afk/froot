TIER 2 session. Small display change to MS-3a. No schema, no migration. Commit only, never push.

Ruling (Gary, 2026-10-17): "Get rid of the 'Raise in progress' badge on the staff page. Leave it only on the Milestone page. Managers should be directed by us to the Milestone page. I don't want 'Raise in progress' self-governed." Scope confirmed: hide ONLY the amber "Raise in progress" compact badge on the /staff list. Keep green "Raise eligible" and red "Raise blocked" on the list. The Milestones tab on /staff/[id] is unchanged and still shows every state.

Repo gate first (pwd, git status, git log --oneline -5), one command at a time.

Then:
1. Read docs/ROADMAP.yaml for a free phase ID (lean: MS-3c). Save this prompt as docs/prompts/2026-10-17_<ID>_hide_amber_raise_badge.md.
2. Make the change on the /staff list only. The amber state should render nothing there, the same way cooldown already does.
3. Update verify-ms3 (and verify-ms3b if it pins the compact badge) for the new rule: amber → no compact badge; green and red unchanged; tab unchanged. Run verify-ms1, verify-ms2, verify-ms3 and verify-ms3b on dev.
4. Lint, then build.
5. Work commit (scoped git add), then a docs commit: the ROADMAP row, a DECISIONS entry with my words above quoted exactly, and the saved prompt.

Report the commits, fixture counts and build result, then stop with: "Done and committed. Next: PRE-PUSH-CHECK for <ID>."
