# DOCS-3 — Clear PERM-6/PERM-7's invite-gate blocker

NEW SESSION — DOCS-3: clear PERM-6/PERM-7's invite-gate blocker.
ROADMAP.yaml only. No code, no schema, no database, no env changes.

Save this prompt to docs/prompts/DOCS-3_perm6_gate_cleared.md before
starting any work. If a file already exists at that path, do NOT
overwrite it — read it, report what it contains, and ask me where
this goes.

Read before doing anything: docs/ROADMAP.yaml rows PERM-6 and
PERM-7 IN FULL (including the blocker text and everything DOCS-2
added to them today), plus DEBT-17 and DEBT-16; CLAUDE.md;
docs/WORKFLOW.md § Session completion rules.

WHAT HAPPENED, 2026-08-01 evening — this is the evidence, and it is
mine, not yours to re-derive. Verify only what is checkable in the
repo; do not attempt to reproduce the run.

PERM-6 carries this blocker: "SINGLE PROMOTION UNIT WITH PERM-7 —
NEITHER PHASE REACHES MAIN UNTIL ONE REAL INVITE RUNS START TO
FINISH ON STAGING." Both phases reached main in 746c1be on
2026-07-29 WITHOUT that gate confirmed — DOCS-2 recorded that
honestly rather than clearing it. The gate has now been run.

THE RUN, on staging (froot-git-staging-…vercel.app), org
org_3GO2wO4QlVVSWppi8aqlnSZnsDa:
1. /users → Invite, indianathomas@gmail.com, role MANAGER
   (deliberately non-admin), location University Village.
2. Clerk logged organization_invitation.created at 19:22:47 PDT,
   source backend-api, event 019fc047-ee89-7d77-8b99-5c8512eeb9cd.
3. Email delivered — landed in Gmail's Junk folder, not lost.
   Worth one line in the record: Clerk DEVELOPMENT-instance mail
   gets spam-filtered, and the next person testing an invite should
   check Junk before concluding delivery failed. I concluded that
   myself for several minutes.
4. Invitation accepted, account created.
5. VERIFIED, admin view: /users members table shows
   indianathomas@gmail.com as MANAGER
