Read /Users/garythomas/Claude_Projects/Froot/froot/docs/prompts/DOCS-NOTIFY-PROD_2026-10-23.md and execute it.

# DOCS-NOTIFY-PROD — record the production email flip (2026-10-23)

**TIER 1 — docs only.** No code, no schema, no prisma commands beyond what `npm run build` runs on its own (`prisma generate`; note it in the report, it is not a breach). Commit only. Never push.

## Repo gate (report each result, stop on any surprise)
1. `git rev-parse --abbrev-ref HEAD` → must be `main`.
2. `git status --short` → must be clean.
3. `git log --oneline -3`
4. `git log --oneline main..staging` and `git log --oneline staging..main` → report both. Expected: both empty. If staging has commits not on main, STOP and report.
5. `git stash list` → report only. Do not pop, apply or drop anything.

## What happened (facts to record — Gary did all of this on dashboards)
- **Root cause.** NOTIFY-1 / HR-16 / F-5b / NOTIFY-2a/2b/2c were promoted in `076ccf8` on 2026-09-20, but the production env-var step of that day's sequence was never done. Every email variable stayed scoped to **Preview** only, so production ran `NOTIFY_EMAIL_PROVIDER` unset → console. From 2026-09-20 until 2026-10-23, production composed and logged emails and sent none.
- **Lost emails.** Signed-acknowledgment emails on production were "Logged only / console" and never delivered — at least 2026-10-12 to 2026-10-19 (Alexis Kirk, Ayxa Sevilla, Jason McClellan, Zion Burson, Hayley Schatz, and others on `/settings/notifications` → "Before the notification pipeline"). They will not resend. The signed records themselves are intact.
- **Fix, 2026-10-23.**
  - Production-scope Vercel vars added: `NOTIFY_EMAIL_PROVIDER=resend`; `RESEND_API_KEY` (new Resend key `froot-production`, Sensitive); `NOTIFY_FROM_EMAIL` (same value as Preview, now scoped Production and Preview); `RESEND_WEBHOOK_SECRET` (Sensitive).
  - `NOTIFY_SANDBOX_ALLOWLIST` deliberately left **Preview only** — in production it would block real recipients.
  - Resend webhook endpoint `https://www.usefroot.com/api/webhooks/resend` created — the first webhook in the Resend workspace. **Staging has no webhook**, so staging rows never show "Delivered".
  - Current production deployment redeployed (Vercel "Redeploy of 2J43y72Sb", main tip `2231bc0`), status Ready.
  - Pace alerts and milestone emails were switched OFF on production `/settings/notifications` on 2026-10-22 before the flip; turning them back on is Gary's call.
- **Evidence.** Production milestone sample "Test — 2 new staff milestones" to `gary@kevajuice.com`, 2026-10-23 12:05 PM PT (19:05Z): row on production `/settings/notifications` → Recent emails reads provider **resend**, status **Delivered** (this proves the webhook path end to end). Resend dashboard shows Delivered. Email landed in the Inbox, not Junk. Header reads "on behalf of Keva Juice" with no "(staging)". The 2026-10-21 and 2026-10-22 test rows read "Dry run — not sent / console" (before the fix).
- **Not yet proven on production:** a real signed-acknowledgment send (four recipients, four rows, record link opens). Proven on staging 2026-09-20.

## Edits (read each file first; preserve-and-mark, never delete text)
1. **`/Users/garythomas/Claude_Projects/Froot/froot/docs/DEPLOY_LOG.md`** — add one entry for this environment change. Read the last three entries and match their heading shape. Record: date, "environment change, no code", the vars and scopes above, the webhook, the redeploy, the evidence row, the lost-email window, and that pace/milestone toggles were off at the flip. Report the heading count before and after (must go up by exactly one). Keep it short — under 40 lines.
2. **`/Users/garythomas/Claude_Projects/Froot/froot/docs/ROADMAP.yaml`** —
   - Find every row or note that says production stays on console / production email is off / Production vars still owed (search at least `console`, `Production vars`, `froot-production`, `RESEND_WEBHOOK_SECRET`). Prepend a dated rider `2026-10-23: production now sends via Resend — see DEPLOY_LOG <heading>` to each. Do not rewrite or delete the old text.
   - On the NOTIFY-2b row, add to `open:` (or a rider if `open:` does not fit): staging has no Resend webhook, so "Delivered" never appears on staging.
   - File **one new DEBT row** (read the file for the next free id — never assume): *An environment with `NOTIFY_EMAIL_PROVIDER` unset silently runs console mode, and nothing warns an admin.* Production ran 33 days without sending; the only sign was "Dry run / Logged only" chips deep in Recent emails. Fix idea for later: a banner at the top of `/settings/notifications` when the resolved provider is console on a production deployment; plus a promotion-ritual line to diff Preview vs Production env-var names when a promotion adds a new variable. Status planned. No code now.
3. **`/Users/garythomas/Claude_Projects/Froot/froot/CLAUDE.md`** — required-env block only. Make sure `NOTIFY_EMAIL_PROVIDER`, `RESEND_API_KEY`, `NOTIFY_FROM_EMAIL`, `RESEND_WEBHOOK_SECRET` and `NOTIFY_SANDBOX_ALLOWLIST` are listed, each with its scope: the first four on **both** Preview and Production (separate Resend keys and webhook secrets per environment); `NOTIFY_SANDBOX_ALLOWLIST` **Preview only, never Production**. Add only what is missing; touch nothing else in the file.

No other files. No DECISIONS.md entry (no rulings in this pass).

## Gates before commit
- `grep -c '__' <each edited file>` — report the counts; no `__TOKEN__`-style placeholders may have been introduced (compare to the count before your edit).
- `npm run build` — must pass (the roadmap generator throws on duplicate ids and bad YAML).

## Commit
- `git add` the edited files by path only (never `-A`).
- One commit: `docs(DOCS-NOTIFY-PROD): production email flip 2026-10-23, lost-email window, DEBT row`
- Do not push.

## Report
Repo gate results, heading count before/after, every ROADMAP row touched (id + one line), the new DEBT id, CLAUDE.md lines added, `__` counts, build result, commit SHA, prisma commands run (expect only the `prisma generate` inside the build). Then stop — Gary pushes main and merges main back into staging himself.
