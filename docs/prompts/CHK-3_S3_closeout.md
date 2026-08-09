# CHK-3 (S3) CLOSE-OUT — REVERT INSTRUMENTATION, RECORD VERIFICATION, FILE THE SAGA'S FINDINGS

**Repo:** `~/Claude_Projects/Froot/froot` — branch: `staging`

## WHAT THIS SESSION IS

S3's engine is verified on staging. This session closes the books:
revert the temp instrumentation, record the verification with its
evidence, commit the diagnostic artifacts, and file everything the
afternoon's secret saga surfaced. Mostly docs; one revert commit.

**Verification evidence (Gary, 2026-08-09, staging — the cron's own
response bodies are the record):**
- First sweep (22:43 UTC): 12 stores, 24 days closed, `markedMissed 2`
  (Las Brisas 08-08, Carson 08-07), `materialized 88`, `errors 0`,
  `raced 0`; every store `dayCloseSource: no-hours` (only Carson has
  hours — expected, the fallback surfaced visibly as designed);
  per-store timezone close instants correct (Denver 09:00Z, LA
  10:00Z); `strandedOpen` 4 rows across Meadowood/Las Brisas reported
  and untouched.
- Second sweep (22:45 UTC): `markedMissed 0`, `materialized 0`,
  `alreadyClosed` 3-4 per store per day, stranded counts identical —
  **idempotency proven**.
- Auth verified end-to-end: 401 without header, 401 with wrong/empty
  token, 200 with the provisioned secret.
- The temp instrumentation (df96e9b) never fired — no rejection
  occurred once the client-side variable was loaded correctly.

## STEP 0 — LOCATION AND ANCHOR

```
cd ~/Claude_Projects/Froot/froot
pwd; git branch --show-current   # staging
git status --short               # expect ONLY untracked docs/prompts files
git fetch origin                 # confirm level with origin/staging
git rev-parse HEAD               # expected df96e9b or a descendant
```

Untracked files expected and handled below:
`docs/prompts/CRON-DIAG_findings.md`,
`docs/prompts/CRON-DIAG-2_runbook.md`, and this prompt file.
STOP on anything else unexpected. Never push.

## STEP 1 — REVERT THE INSTRUMENTATION (its own commit, first)

```
git revert --no-edit df96e9b
```

Then prove it left nothing behind:
```
git grep -n "CRON-DIAG-2" -- ':!docs/prompts'
```
Must return nothing. `npm run build` gates the revert commit.

## STEP 2 — DOCS COMMIT (one commit, everything below)

**2a. CHK-3 rider**, prepended, org context stated: verification ran
against staging (instance verified-snapper-7); the cron's response
bodies are quoted-by-summary per the evidence block above, with both
timestamps. State plainly: the engine acted on first contact and
changed nothing on second — R1's missed-is-written and the
idempotency requirement both proven by the machine's own receipts.
Remaining S3 spot-checks (Weekly-not-materialized, pre-deploy rows
untouched, the two 409s) are substantially evidenced by the bodies
(`frequencySkipped` field present, stranded rows untouched) — list
any not independently query-confirmed as OPEN CHECKS on the rider
rather than claiming them. CHK-3 status → staging, commits
["d089a7c"] plus the revert SHA noted.

**2b. Commit the diagnostic artifacts**: both CRON-DIAG files and the
session prompt files ride this commit per the audit-artifact rule.

**2c. THE SECRET-PROVISIONING LESSON** — one paragraph in CLAUDE.md's
environment/secrets section (create the subsection if none fits):
a Vercel var marked Sensitive can NEVER be revealed after save; any
secret that will ever be presented by hand (cron triggers, manual
API auth) must be recorded in Gary's password manager AT CREATION.
The operational ritual for rotating one: save dashboard value →
redeploy the TARGET branch (read the branch column) → verify the
alias's created-time postdates the save → fire. Cite CRON-DIAG's
findings file for the measured failure this rule comes from.

**2d. RULING RECORDED (Gary, 2026-08-09): the Hobby-plan claim is
stale.** Wherever ROADMAP.yaml (F-1 area) claims the account is on
Hobby with cron caps: dated correction, preserve-and-mark — plan is
Pro (measured via `vercel` billing metadata during CRON-DIAG),
hourly crons legal. Note that Hobby-derived caution elsewhere in the
file deserves re-reading; do NOT hunt and edit them all — one line
flagging it.

**2e. FILE THE ROW: main is red.** Three dashboard-initiated
redeploys of 7ab7106 failed on 2026-08-09, all
`npm run vercel-build` exit 1 at the migrate step ("datasource.url
property is required"). Production SERVES fine (an earlier Ready
deployment), but the NEXT PROMOTION IS BLOCKED until understood.
Known context for the row: dashboard redeploys of main may not
attach env vars the way git-push deploys do (the BUILD-1 scoping
class); the original git-pushed production deploy of the same
commit built clean. Trigger: before any S3/CHK promotion. Next
DEBT id per the board.

**2f. CRON_SECRET ROTATION chore row or checklist line** (session's
judgment per triage rules — likely COMMENT-level on the CHK-3 row
rather than a new row): the current value transited a chat
transcript; rotate before production promotion, using the 2c
ritual, updating the password manager entry.

`npm run build` gates the commit. Committed, **NOT pushed** — Gary
pushes both commits together.

## STEP 3 — REPORT

SHAs (revert + docs); the CHK-3 rider verbatim; the CLAUDE.md
paragraph verbatim; the new row verbatim; the grep-clean proof;
confirmation the roadmap parses and the panel renders; triage
counts (FIX NOW / RULING NOW / COMMENT / ROW — RULING NOW stops
the session).

## HOUSE RULES

Everything in CLAUDE.md; never push; short SHAs quoted in YAML; no
secret values anywhere; exclude `src/generated/` from greps; do not
touch `../froot_docs/`; `preview/main` is a fossil — never query it.
