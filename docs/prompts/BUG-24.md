Read /Users/garythomas/Claude_Projects/Froot/froot/docs/prompts/BUG-24.md and follow it.

# BUG-24 — Deletes blocked by history crash with a 500

**TIER 2** (contained API changes, no schema). Declare the tier before writing anything.
Branch: `staging`. Commit only — never push. Stage only the files you touch.
Gate: staging and main must both be at `8845365`. If they aren't, STOP.

## The bug (filed in `1b598c6` during BUG-23)
Under `@prisma/adapter-neon`, a delete blocked by an `ON DELETE RESTRICT` foreign key throws a `DriverAdapterError` carrying Postgres `23001`. It is NOT a Prisma `P2003`. Any route that deletes a row that history still points at, without checking first or catching that error, returns a raw 500. BUG-23 fixed this for templates. `template-types/[id]/route.ts:127-135` measured the same gap on 2026-08-08 and chose not to catch it. This phase sweeps everything else.

## Phase 1 — Audit (read-only), then STOP
1. **Every RESTRICT FK.** Read them from `/Users/garythomas/Claude_Projects/Froot/froot/prisma/migrations/0_init/migration.sql`, which now holds the whole schema in one file. List each child → parent pair.
2. **Every delete path that can hit one.** Grep `src/` for `.delete(`, `.deleteMany(`, raw `DELETE` and `$executeRaw`. Also include deletes of a parent whose CASCADE reaches a child that something RESTRICT-references. Keep only paths that delete a model on the parent side of a RESTRICT FK, directly or through a cascade.
3. **Classify each path.** Give the route and method, what the UI calls it, and one of four classes:
   - **Guarded:** a history check runs first.
   - **Caught:** a catch that matches `23001` or `23503`.
   - **Unguarded:** it will 500.
   - **Unreachable:** no route or UI calls it.

   For each Unguarded path, say whether its caller shows the route's `error` text or swallows it.
4. **Each Unguarded path gets a lean:**
   - **(a) Refuse with 409.** One plain sentence naming what blocks it, e.g. "This vendor has purchase orders — it can't be deleted." This is the default.
   - **(b) Like BUG-23**, where an Archive/inactive control already exists for that model. Name it.

   Never pick a lean that silently does something other than delete.

Report it as one table, then STOP. Gary picks which rows to fix.

## Draft rulings (Gary ratifies at PRE-PUSH-CHECK)
- **R1:** A delete blocked by history never returns a 500. It returns 409 with one plain sentence naming what blocks it, and the UI shows that sentence.
- **R2:** This phase makes no product changes. Where Archive should replace Delete (like BUG-23), file a ROW instead of building it here.
- **R3:** One shared matcher for restrict violations (`P2003` OR raw `23001`/`23503`), used everywhere.

## Phase 2 — Build (only the rows Gary approves)
1. Move BUG-23's matcher out of `src/app/api/templates/history.ts` into a shared `src/lib/db/restrict-violation.ts`. Leave a re-export so BUG-23's fixture and route still import it unchanged.
2. Fix each approved route:
   - wrap the delete and map the matcher → 409 with that row's sentence;
   - leave any other error as 500, with a `console.error` line;
   - add a cheap pre-check only where it is one `exists`-style query.
3. Where a caller swallows the error text, make the smallest change that shows it: reuse the caller's existing toast or error line, with no new UI.
4. Fixture `/Users/garythomas/Claude_Projects/Froot/froot/scripts/verify-bug24.ts`, run against dev:
   - the matcher against a real caught `23001`;
   - for each fixed route, a real blocked delete returns the 409 sentence and the row survives;
   - an unblocked delete still succeeds.

   Clean up every row it creates and assert zero leftovers.
5. Make a work commit and a docs commit. The docs commit carries:
   - the BUG-24 row, `planned` → `in_progress`, with nothing deleted;
   - a DECISIONS.md draft of R1–R3;
   - a short UNPROMOTED DEPLOY_LOG entry;
   - one ROW per Archive-should-replace-Delete case found.

Classify out-of-scope findings as FIX NOW / RULING NOW / COMMENT / ROW. Report the prisma commands run (verbatim; `npm run build` runs `prisma generate`), the SHAs and `git log --oneline @{u}..`.

## Staging test (Gary, after PRE-PUSH-CHECK and push)
For two of the fixed routes, delete something that has history (e.g. a vendor with a PO). You should see a plain message, not "Something went wrong", and the item should still be there. Then delete a brand-new unused one; it should go.
