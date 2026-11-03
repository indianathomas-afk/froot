# STAMP-a00fa1e — promotion stamp for N-3 — TIER 1

TIER 1: docs only, one commit on `staging`. Never commit on `main`. Never push.

Saved as `/Users/garythomas/Claude_Projects/Froot/froot/docs/prompts/STAMP-a00fa1e.md`.

## Repo gate (one command at a time)

`pwd` ends in `Froot/froot` (capital-F: STOP and tell Gary). `git status`: on
`staging`, clean apart from untracked prompts. HEAD `a00fa1e`.
`git log --oneline -3`.

## What happened

Gary promoted N-3 on 2026-11-02: merge `a00fa1e` (`--no-ff`), main
`8c94126..a00fa1e`, staging fast-forwarded. Carried `68571da` (N-3 work),
`e73a60c` (N-3 docs), `12bd2b4` (N-3 PRE-PUSH-CHECK).

Migration `20261103000000_n3_public_menu`: production `finished_at`
2026-11-03 00:09:51.972546+00 (Neon `br-sparkling-block-a620qvg4`, branch id
read from the server in the same output) — 2026-11-02 4:09 PM Pacific.

Staging evidence (before promotion): `/menu/keva-juice-staging` showed Liquid
Olympian Smoothie **S: 60 cal** (Almond Breeze Original, 8 fl oz, Verified),
M / Kids / L "coming soon", item allergens "coming soon" (N3-F7), the
cross-contact notice under the filter, and no prices or ingredients.
Sign-out/sign-in, Settings and HR pages worked with the new app-wide framing
headers. The public menu was left **off** on production.

## Do

Follow `docs/WORKFLOW.md` § 2 and the STAMP precedents
(`docs/prompts/STAMP-bdbeb47-317ce2c.md`, `docs/prompts/PROMO-STAMP_39b7ad2.md`):

1. `docs/DEPLOY_LOG.md`: stamp the UNPROMOTED N-3 entry as promoted in
   `a00fa1e` on 2026-11-02, with the evidence above. Keep it short; verify the
   diff is insertions plus the heading change; heading count unchanged.
2. `docs/MIGRATIONS.md`: fill the N-3 production row with the `finished_at`
   above; mark any "not yet" / "owed" text spent, not deleted.
3. `docs/ROADMAP.yaml`: N-3 row → `shipped` with `a00fa1e` and a dated rider
   carrying the evidence. Preserve-and-mark; nothing deleted. Read the file
   for conventions.
4. Commit this prompt with the docs. `npm run build` must pass. One commit.

## Report and stop

SHA, files touched, diff summary. Do not push.
