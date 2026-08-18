# Froot — session handoff, 2026-08-17

Paste this into a fresh chat. It is self-contained.

---

## Who I am and how we work

I'm Gary, founder and sole developer of **UseFroot** (usefroot.com) — a multi-tenant
store-operations SaaS for Square merchants, anchored by **Keva Juice**, a smoothie chain I
also own and operate. Next.js 16, React 19, TypeScript, Tailwind 4, Prisma 7, Neon Postgres,
Clerk, shadcn/ui, Vercel, Square OAuth.

Repo `github.com/indianathomas-afk/froot`, local `~/Claude_Projects/Froot/froot` — the
lowercase `froot` is the git root; the capitalized parent is a recurring trap and I land in
it regularly.

**Two-tool workflow.** Planning, rulings and architecture happen in this chat. Execution
happens in Claude Code via self-contained TIER-declared prompts saved to `docs/prompts/`.
Rulings are written in my words into `docs/ROADMAP.yaml` — a recommendation is not a ruling
until I have written and ratified it.

**House rules.** No `&&` chains. Additive-only schema. I run all pushes. `--no-ff` merges to
production. DEPLOY_LOG written before push. Two-commit pattern (work, then recorder).
Preserve-and-mark: nothing is deleted from the board, corrections prepend with dates.
Prompts in `docs/prompts/` are never edited after execution — addenda only.

**Evidence rules, absolute.** A database result carries the Neon branch name in the same
output. A browser observation names the org id and Clerk instance. Re-measure rather than
cite from memory. Commit time ≠ push time — they are different events.

**How I want help.** Plain English before technical detail. Smoothie-shop analogies for
complex ideas. A clear lean, not a menu. Push back when warranted. Slow me down when I get
ahead of myself. Don't ask five questions in a row — recommend and let me correct. When you
say "go to the settings page," give me the URL. When you say "open a file," give me the exact
path and the exact command.

---

## What just happened, 2026-08-16 into 08-17

A long session that opened on a false premise and turned into archaeology. The premise was
"BUG-7 is fixed on staging and needs promoting." It had been in production since Aug 14. What
the session actually found was five undocumented fast-forward promotions and a promotion
procedure that never reads the roadmap.

**Closed and verified:**

- **BUG-7** (`salesPeriodCache` write race) → `verified`. Fix `00881dc`: guarded upsert,
  `ON CONFLICT ... WHERE syncedAt < EXCLUDED.syncedAt`, newest *fetch* wins rather than
  newest commit. Verified in production under live webhook load — ~55 `discarded` log lines
  in a 2.5-hour window on Aug 16, including collisions 70ms and 270ms apart. Closed on the
  criterion the row set for itself on Aug 13.
- **F-4** production blocker → resolved. Square production webhook delivering: 34,914 events,
  all 200, nine stores syncing within minutes.
- **DEBT-70a** (PDF body date stamp rendered UTC) → `verified`, commit `623acb6`.
- **DEBT-70b** (22 server-side date displays) → `verified`, commit `cc144dc`.

**Promoted to production 2026-08-17.** Merge commit **`7e77ea6`**, `--no-ff`, two parents,
pushed `06dc830..7e77ea6`. 48 commits. First promotion in seven to leave a revertable merge
artifact. Carried R2/HR-11k, Case A, HR-11n, HR-11o, DOC-1 A/B/C, HR-20…HR-28, DEBT-70a/70b,
and three additive migrations:

- `20260815150000_hr11n_checkpoint_retirement` (three nullable columns)
- `20260816120000_hr_document_version_requires_reacknowledgment` (`NOT NULL DEFAULT false`)
- `20260816180000_organization_timezone` (`NOT NULL DEFAULT 'America/Los_Angeles'`)

All three additive with defaults, none can fail on existing rows.

---

## Facts that were WRONG in the last session — do not reintroduce them

**HR IS LIVE IN PRODUCTION. It is not dark.** `HR_MODULE_AVAILABLE=true` was added to the
Vercel Production scope **2026-07-24** (DEPLOY_LOG, "HR LAUNCH" entry). Org
`cf888f2d-f234-48c7-8097-fd5b44b5b3dd` (Keva Juice) carries
`activeModules = {inventory,labor,hr}` with **5 STORE / 1 MANAGER / 3 ADMIN / 1 STAFF**. Any
note anywhere claiming HR is dark in production is stale by three weeks. This false premise
nearly got written into two roadmap rows.

**Production carries zero wrongly-stamped signed records.** Three `HrSignedRecord` rows exist
on `br-sparkling-block-a620qvg4`, all completed early-afternoon Pacific, `dates_differ` false
on all three. Staging's 3-of-10 does not transfer.

**Two Square developer applications, deliberately.** `Froot` =
`sq0idp-UdjqLfkxl0hlbw7b30IiLA` → production. `Froot Staging` =
`sq0idp-YPgmfGap_oYDRTyYIFG3zw` → staging. This resolves an older doc note about a staging
app pointing at the production domain.

**Neon branches, current.** Production `br-sparkling-block-a620qvg4` (`ep-green-smoke`).
Staging is named **`preview/staging`** in the console, id `br-square-feather-a63z92vz`. Dev
`br-broad-wave-a6vpjdw0`. Two fossils deleted 2026-08-17: `br-purple-rain-a6m62xww` (was
masquerading as `preview/main` — the dead branch my docs say never to query) and
`br-royal-salad-a6njlrww` (`vercel-dev`). Both Vercel-auto-created, zero data.

**Neon storage is at ~82% of the Free plan allowance.** Three real branches all forked from
production. Not urgent, will force a decision.

---

## What I want from this session

Clear the open rulings. They are decisions, not work, and they are cheap to make while
context is fresh. Give me a clear lean on each, one at a time, and stop when I've ruled.

**DEBT-72 — the WORKFLOW promotion gate.** The one that prevents a repeat. Nothing in the
promotion procedure reads `docs/ROADMAP.yaml`, so `00881dc` shipped while its own row said
`in_progress` and "NOT YET VERIFIED ON STAGING". The shape I want ruled: (a) enforce
`--no-ff` so every promotion leaves a revertable artifact, and (b) fail the promotion closed
if any commit in the promoted range maps to a roadmap row marked `in_progress` or `planned`.
Open questions: hard block or overridable warning, which statuses trip it, and where it lives
(script, git hook, or WORKFLOW.md procedure).

**DEBT-73 — the page-1 PDF banner.** "Completed by … on 2026-08-17 02:05:01 UTC" sits on the
same page as the `Date:` stamp DEBT-70a just made store-local. Both are correct; the banner is
labelled. The question is whether a page-1 prose attestation is **evidence** (stays UTC, like
the certificate) or **a field a person reads** (goes store-local, like the stamp DEBT-70a
fixed). Do not change it before I rule.

**The `needs-current` naming problem.** Six surfaces, one string carrying three meanings.
Mine to rule, and I have not written it yet.

---

## Also open, lower priority

- **DEBT-70's client half** — 42 viewer-anchored `format()` call sites. Not defective today:
  they render the viewer's day, correct for anyone in the store's zone. Open as a
  *convergence* problem for a multi-timezone operator. The parent row stays `planned`.
- **DEPLOY_LOG entry for `7e77ea6` is owed.** It was not written before the push. Needs the
  merge SHA, the 48-commit range, the three migrations, the note that
  `20260816180000_organization_timezone` rode `623acb6` (a row titled as a display fix), and
  that this promotion carried signing-behavior and access-control changes onto a live HR
  module with six non-admin principals.
- **Post-promotion production verification is owed.** Confirm the three migrations applied in
  the production build log; spot-check a dashboard load, one HR document render, one
  store-local date display, and `/internal/roadmap` showing BUG-7 under "In production".
- **DEBT-69** — coalescing concurrent Square syncs. Now carries its first measured number
  (~55 discards / 2.5 hours / 9 stores). One transaction emits 3–5 webhook events, each
  firing a full paginated `orders/search` before losing at the write. Real Square quota spent
  on discarded work.
- **BUILD-1's remaining blocker** — no Preview-scoped `DATABASE_URL`, so a preview build from
  any branch other than staging fails at build time. Deliberate fail-closed posture, costs
  nothing while I push only staging and main. Fix when collaboration starts: throwaway Neon
  branch plus both vars Preview-scoped, no branch restriction.
- **DEBT-38** — second recurrence recorded. Mechanism is end-of-work-block pushing with no
  merge artifact to prompt an entry. Four of five promotions moved within an hour of their
  last commit; the fifth sat overnight.
- **Subscription/billing architecture** — location-based pricing under consideration, Stripe
  rather than Clerk billing for base + per-location. Not started.

---

## Lessons from the last session worth carrying

- **The board can be stale about production.** Project knowledge indexes `main` only, and a
  row's status is written by a human who may not have come back. Verify against the repo and
  the database, not the row.
- **The direct proof of a concurrency guard is a success log, not an error log.** Chasing
  `P2002` was chasing a filter that could only return zero — `ON CONFLICT` makes it
  structurally impossible. The `discarded` line was the evidence.
- **Vercel runtime logs retain roughly a day on Pro.** Evidence expires. The database
  equivalent (uuid vs cuid `id` format, since `ON CONFLICT DO UPDATE` never rewrites `id`)
  does not.
- **A branch name is not a branch.** Two of my query results were read as production and were
  actually staging, because the output carried no branch label. Both conclusions were void.
