# Production promotion runbook — PERM-5 + DEBT-50 payload
# Date prepared: 2026-08-04 evening. Run when fresh.
# Everything here is Gary-executed. No Claude Code session needed until the
# final docs commit (and even that can be done by hand).

## What this promotion carries
Staging → production, ~23 commits (de3ba40 → 999cbdc): the F1 cross-org
guard and F4 accept-invite fix (DEBT-53/54, security), the DEBT-50 docs
package, PERM-5 Session B (override machinery + grid + migration
20260804123449), Session C (39-site sweep), and the verification notes.

────────────────────────────────────────────────────────────────────
## STEP 0 — Preconditions (2 min)

    froot
    git log --oneline origin/staging..staging

Expect EMPTY (999cbdc already pushed). If 999cbdc shows, push it first:

    git push origin staging

Then confirm staging is healthy: open the staging URL, sign in, dashboard
renders. (You verified C5 on this exact SHA — this is just "nothing broke
overnight.")

────────────────────────────────────────────────────────────────────
## STEP 1 — Review what's promoting (2 min)

    git fetch origin
    git log --oneline origin/main..origin/staging

Read the list top to bottom. Expect ~23 commits, newest 999cbdc, oldest
5695aab (F1). Nothing in the list should surprise you — if anything does,
STOP and bring it to planning before merging.

────────────────────────────────────────────────────────────────────
## STEP 2 — Merge and push (3 min)

    git checkout main
    git pull origin main
    git merge staging
    git log --oneline -1        # note the SHA — this is the PROMOTION SHA
    git push origin main
    git checkout staging        # go home immediately; never linger on main

Notes:
- If the merge fast-forwards (likely — main hasn't moved since de3ba40),
  the promotion SHA equals 999cbdc. FAST-FORWARD = NO ARTIFACT = the
  DEPLOY_LOG entry in Step 4 is MANDATORY AND MANUAL (DEBT-38).
- If it creates a merge commit, the promotion SHA is the new merge commit.
  Same DEPLOY_LOG obligation.

────────────────────────────────────────────────────────────────────
## STEP 3 — Watch the production deploy (5 min, mostly waiting)

Vercel → froot → Deployments. The new PRODUCTION deployment (branch main)
appears. Open its Build Logs and confirm BOTH:

  [ ] The migration line: "1 migration found" / applying
      20260804123449_perm5_user_denied_capabilities
      → this is production's database receiving the override column,
        via the pipeline. You never run it by hand.
  [ ] Build completes, status Ready.

If the build fails on a P1002 (advisory lock timeout): that is the known
Neon pooler issue, NOT a bad migration — redeploy. (The PERM-5 row's
deferred note points at the same advisory.)

Then confirm the deployed SHA: the deployment's commit must equal the
promotion SHA from Step 2 (full 40-char when comparing; short SHA lookup
returns "No deployments found" and lies).

────────────────────────────────────────────────────────────────────
## STEP 4 — DEPLOY_LOG entry (5 min) — DO NOT SKIP

Open docs/DEPLOY_LOG.md, add at the top, following the file's format:

    ## 2026-08-0X — staging → production, <PROMOTION SHA>
    ~23 commits (de3ba40..999cbdc). Payload: DEBT-53 (cross-org privilege
    escalation guard in getCurrentUser, verified on staging with log
    evidence) and DEBT-54 (accept-invite fails toward sign-in) — both
    security; PERM-5 Sessions B+C — per-user capability overrides:
    User.deniedCapabilities via migration 20260804123449 (applied to
    production by the pipeline's migrate deploy this promotion), the
    can() override seam, the Edit User capability grid (20 rows), the
    39-site inline-check migration, deniable-list rule; DEBT-50 docs
    package (rows 53-57, DECISIONS.md mechanism + F3 rulings); DEBT-55
    site 1/21 (layout.tsx org guard). Fast-forward: <yes/no>. Smoke
    test: <fill after Step 5>.

Commit it on staging (yes, staging — docs live there and ride the next
promotion; this matches how de3ba40's entry was handled):

    git add docs/DEPLOY_LOG.md
    npm run build > /tmp/build.log 2>&1 && git commit -m "docs: DEPLOY_LOG entry for <PROMOTION SHA> promotion"
    git push origin staging

────────────────────────────────────────────────────────────────────
## STEP 5 — Production smoke test (10 min)

On www.usefroot.com. Record the org id once. In order:

  [ ] Sign in as gary@kevajuice.com (ADMIN). Dashboard renders with real
      Carson data. Nav complete.
  [ ] /users renders — all 5 members + device accounts listed.
  [ ] Edit User on kevajuice06 → the capability grid renders, ~20 rows,
      everything ON or locked-off per MANAGER baseline, footer visible
      without scrolling. CLOSE WITHOUT SAVING (Cancel — confirm no
      discard prompt fires when nothing changed).
  [ ] DO NOT deny anything on a production account today. The machinery
      is staging-proven; production day one is observation only.
  [ ] /staff, /forecasting, /inventory/reports each render normally as
      admin (spot-check that the migrated checks admit the baseline).
  [ ] Vercel → Logs (production) → search "cross-org": expect ZERO lines.
      Any line names a stale-org row the SQL said doesn't exist — that
      would be a finding; screenshot and stop.
  [ ] If a device iPad is reachable (South Reno / Las Brisas): glance
      that its session still works. If not reachable tonight, note it
      and check within a day or two — the regression proof says zero
      denials = byte-identical behavior, so risk is minimal.

Fill the smoke-test line in the DEPLOY_LOG entry (amend is fine before
pushing, or a follow-up commit after — your call, note which).

────────────────────────────────────────────────────────────────────
## STEP 6 — Flip the row (5 min)

docs/ROADMAP.yaml, PERM-5 row: status in_progress → shipped. Replace the
"production has not applied migration" deferred entry with:

    SHIPPED <date>: promoted in <PROMOTION SHA>; migration 20260804123449
    applied to production via migrate deploy (build log confirmed); smoke
    test passed <date> — grid renders on production, zero cross-org log
    lines, baselines unchanged at zero denials. DEPLOY_LOG entry same
    date. Still explicitly excluded from this phase: HR migration, the
    ungoverned surfaces (operational inventory, /messages, /store-view,
    /labor), Users/Settings view/manage splits, Settings toggle APIs,
    per-user-per-store granularity, the square.manage baseline ruling.

Commit + push on staging (two-commit SHA pattern not needed — this row
edit references the promotion SHA, not its own).

────────────────────────────────────────────────────────────────────
## Abort criteria — stop and bring it to planning if:
- Step 1's commit list contains anything unexpected.
- The production build fails on anything OTHER than P1002.
- Any smoke-test box fails, especially a cross-org log line or a
  degraded admin session.
- The migration line is ABSENT from the production build log (would mean
  the column didn't land — the grid will error on every Edit User open).

Rollback posture if needed: Vercel → promote the previous production
deployment (de3ba40) back to current. The migration is additive and can
stay — an unused column harms nothing. Then bring the failure here.
────────────────────────────────────────────────────────────────────
