# NOTIFY-13b — Contacts card to the top of /settings/notifications

**TIER 1 — cosmetic reorder. No audit, no schema, no route changes, no ROADMAP row, no DEPLOY_LOG entry.**

Repo: `/Users/garythomas/Claude_Projects/Froot/froot`
Branch: `staging` (confirm with `git branch --show-current` before editing; stop if it is anything else)

## What to change

On `/settings/notifications`, move the **Contacts** card so it is the **first card on the page** — directly under the back-link and h1, above the **Signed-acknowledgment emails** card. Every other card keeps its current relative order.

Why: Contacts is the address book the "Also send to" pickers on every email card draw from. Add people first, then assign them — the page should read top to bottom in that order.

## Where

The page is under `/Users/garythomas/Claude_Projects/Froot/froot/src/app/(app)/settings/notifications/` — find the file that renders the cards (likely `page.tsx`) and confirm before editing. Move the Contacts card's JSX block as a unit; do not restructure it.

## One wording fix that rides along

The Contacts description currently ends: "…then choose them under **Also send to** on any email above." Once the card is on top, the email cards are *below* it. Change **"above"** to **"below"**. Nothing else in the copy changes.

## Watch for

- The HR acknowledgment card has three states (absent when HR isn't available, disabled when the org has HR inactive, live otherwise). Contacts must sit first in **all three** — don't nest it inside any HR conditional.
- Keep the spacing between cards consistent; if the first card has a different top margin than the others (e.g. a root margin carried from the old layout), make Contacts match whatever the first card had.
- No changes to any component's props, data fetching, or the contacts route.

## Done means

1. `npm run build` passes (it runs `prisma generate` — that's expected, not a migration).
2. `git add` only the file(s) you touched — no `git add -A`.
3. One commit on `staging`: `NOTIFY-13b: Contacts card first on /settings/notifications`
4. **Do not push.** Report the short SHA, the file path(s) changed, and the new card order top to bottom.

Gary verifies on staging after he pushes.
