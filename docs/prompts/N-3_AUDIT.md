# N-3 — Phase 1 audit (read-only)

Session: TIER 3, 2026-11-02. Prompt: `docs/prompts/N-3.md`.
Repo gate: `/Users/garythomas/Claude_Projects/Froot/froot`, branch `staging`,
clean apart from untracked `docs/prompts/N-3.md`, HEAD `8c94126` (Merge branch
'staging'). Nothing written outside this file. No staging or production database
was connected to. One read-only measurement ran against **dev**
(`neon.branch_id = br-broad-wave-a6vpjdw0`, printed by the query itself) from a
scratch script outside the repo. Two `curl -I` header reads went to
`https://www.usefroot.com` (public, unauthenticated GETs).

---

## Summary (one screen)

1. **`/menu(.*)` is already public** in `src/proxy.ts:11` (since the Phase 1
   commit `1cfdf76`). `src/app/menu/` exists and is **empty**. Nothing renders
   there today; production answers `/menu/does-not-exist` with a plain 404.
   No other public page shows org data. The route has been used as the
   "temp-preview hook" by earlier sessions — N-3 takes it over for real.
2. **RULING NOW — there is NO framing protection anywhere today.** No
   `X-Frame-Options`, no `Content-Security-Policy`, in `next.config.ts`,
   `src/proxy.ts`, or `vercel.json`, and production confirms it (headers on
   `/sign-in` measured below: only HSTS + cache-control). The prompt's "every
   other route keeps its current framing protection" rests on a false premise:
   every authenticated page can be iframed by any site right now. N-3 either
   (a) adds `frame-ancestors *` to `/menu/*` only and leaves the rest as it is
   (unprotected), or (b) also adds `X-Frame-Options: DENY` +
   `frame-ancestors 'none'` to every other route — a one-block `headers()` in
   `next.config.ts`, but an app-wide behaviour change. **Lean: (b), in N-3,
   because the public page is the moment the distinction starts to matter.**
3. **Verified test exists and is pure:** `itemVerification()`
   (`src/lib/nutrition-proof.ts:120`) over `proofState()` (`:52`). Stale
   (≥ 12 months) already counts as not verified; recipe errors → NOT_VERIFIED;
   no food ingredients → NO_FOOD. **Three gaps the public page must decide**
   (new forks F6–F8 below): a VERIFIED item can have incomplete nutrients; its
   "Contains:" line can include allergens from not-food and PREPARED
   ingredients that nothing verifies; verification is per **size** (each
   variation has its own recipe), not per item.
4. **Caching:** Next 16.2.9 without `cacheComponents` → `unstable_cache` keyed
   by org id + tag `public-menu:<orgId>`, `revalidate` short, and
   `revalidateTag(tag, "max")` from the publish-settings write and the nutrition
   writes. The full invalidation surface is ~40 inventory write routes, so the
   time window must carry recipe/ingredient edits (lean 5 min). No rate limiter
   exists in the app; lean: rely on the cache.
5. **Schema (smallest):** one `PublicMenu` row per org (enabled, slug @unique,
   disclaimer, cross-contact text) + two child tables (included categories by
   `SquareCategory.id`, hidden items by `squareItemId`). Do **not** reuse
   `Organization.slug` (Clerk-written, HR-14 rename bug) or the `MenuItem*` stub
   (DEBT-124).
6. **Menu groups** = the Square category NAME of the item's first category,
   copied onto `SalesItem.menuGroup` by `square/sales-items/sync`. The
   production query is in § F. Dev's list (fork-era, no recipes on dev) is shown
   for orientation only.

---

## A. Public routes today

**Mechanism.** `src/proxy.ts` (Next 16's renamed middleware) runs
`clerkMiddleware`; every request not matched by `isPublicRoute` calls
`auth.protect()`. Public matchers: `/`, `/sign-in(.*)`, `/sign-up(.*)`,
`/accept-invite(.*)`, `/api/webhooks(.*)`, `/api/cron(.*)`, **`/menu(.*)`**.

- `/menu(.*)` has been public since `1cfdf76` (the initial build) and is
  already recorded in `docs/PERMISSIONS_INVENTORY.md:63` (§ 1a).
- `src/app/menu/` is an empty directory (mtime 2026-11-02 14:06 local — a
  temp-preview page was created and removed there earlier). No `page.tsx`, no
  `route.ts`.
- Production, signed out: `GET /menu/does-not-exist` → `HTTP/2 404`,
  `cache-control: public, max-age=0, must-revalidate`, `x-clerk-auth-status:
  signed-out` (www.usefroot.com, 2026-11-02).
- Note the matcher's shape: `/menu(.*)` also matches `/menus`, `/menu-x`.
  Harmless today (nothing lives there); the build should tighten it to
  `/menu/(.*)` or keep it and say why. **COMMENT.**

**"Public-store routes" mentioned by N-1b's audit:** there is no other public
page that shows org data. The other public surfaces are the sign-in/up pages,
`/accept-invite` (invitation router — reads a Clerk ticket, shows nothing of
the org beyond what the invite already carries), webhook and cron handlers
(self-authenticating). **So N-3 is the first public page that reads org rows;
there is no precedent serializer to copy.**

**How public pages avoid leaking today:** they don't read org data. The only
precedent for "a dedicated public payload" is in spirit: `serializeIngredient`
(`src/lib/nutrition-record.ts:55`) builds an app-side shape — it includes
`sourceUrl`, `labelFileUrl` and so must NOT be reused.

**Clerk on the public page.** The root layout (`src/app/layout.tsx`) wraps
everything in `<ClerkProvider>`, so `/menu/*` will load clerk-js and call the
Clerk frontend API, including inside a keva.com iframe (third-party context).
Nothing is exposed by it (signed-out), but it is a third-party script on an
embeddable page and adds weight. Moving `/menu` out from under the root layout
means restructuring into multiple root layouts — out of proportion for N-3.
**COMMENT** — accept and note; revisit with N-4.

**Module gate.** The app gates nutrition on `activeModules` including
inventory AND nutrition (`nutritionActive`, `src/lib/nutrition-access.ts:18`).
The public page has no session, but it should still 404 when the org's
nutrition module is off, exactly as when the menu is off. Lean: yes — folded
into "menu off → 404". Listed under RULING NOW (R-2).

## B. Framing headers

**Measured: none.**

- `next.config.ts` — only `serverExternalPackages: ["unpdf"]`; no `headers()`.
- `src/proxy.ts` — sets no headers.
- `vercel.json` — `crons` only.
- `grep -rniE "x-frame-options|frame-ancestors|content-security-policy"` over
  `src`, `next.config.ts`, `vercel.json`, `docs/*.md` → zero hits.
- Production, `curl -sI https://www.usefroot.com/sign-in` (2026-11-02):
  `HTTP/2 200`, `cache-control: private, no-cache, no-store, max-age=0,
  must-revalidate`, `strict-transport-security: max-age=63072000`,
  `x-clerk-auth-*`. **No `x-frame-options`, no `content-security-policy`.**

**Consequence:** every authenticated page (dashboard, HR signing ceremony,
settings) can be framed by any origin today — a clickjacking exposure that
predates N-3. The prompt's "every other route keeps its current framing
protection" has nothing to keep. → **RULING NOW R-1.**

**How to scope it (Next 16 `headers()` in `next.config.ts`,
`node_modules/next/dist/docs/01-app/03-api-reference/05-config/01-next-config-js/headers.md`):**

```ts
async headers() {
  return [
    // every route EXCEPT /menu/* — negative lookahead in source
    { source: "/((?!menu/).*)", headers: [
      { key: "X-Frame-Options", value: "DENY" },
      { key: "Content-Security-Policy", value: "frame-ancestors 'none'" },
    ] },
    { source: "/menu/:path*", headers: [
      { key: "Content-Security-Policy", value: "frame-ancestors *" },  // or the F5 list
    ] },
  ]
}
```

(Exact path-to-regexp syntax to be confirmed against the doc at build time —
AGENTS.md. If both rules matched one path, the later header with the same key
wins; the lookahead keeps them disjoint so that never arises.) `X-Frame-Options`
must NOT be sent on `/menu/*`: it has no "allow all" value, and a browser that
honours it ignores the CSP. A CSP containing only `frame-ancestors` restricts
nothing else, so no script/style breakage.

Option (a) — headers on `/menu/*` only — is the literal prompt and is safe for
the menu, but leaves the existing exposure. Option (b) is the lean.

Risk check for (b): does anything frame the app's own pages? `grep -rn
"<iframe\|<embed\|<object" src` → three hits, all **outbound YouTube embeds**
(`(app)/messages/messages-client.tsx:929`,
`components/hr/training-module-view.tsx:266`,
`components/hr/document-instructions.tsx:77`, each
`src={https://www.youtube.com/embed/…}`). `frame-ancestors` governs who may
frame Froot, not what Froot frames, so none is affected. No `<iframe` points
at an app route. Print pages open as their own page, not a frame. Clerk's
hosted components render inline, not framed. Re-run the same grep at build
time before the header lands.

## C. The Verified test

**The function:** `itemVerification(item, proofOf)` —
`src/lib/nutrition-proof.ts:120-128`:

```ts
if (item.error) return "NOT_VERIFIED"
if (ids.length === 0) return "NO_FOOD"
return ids.every((id) => proofOf(id) === "VERIFIED") ? "VERIFIED" : "NOT_VERIFIED"
```

fed by `proofState(record, now)` (`:52-58`): NONE (no basis), ESTIMATED,
STALE (VERIFIED with no date or `now ≥ verifiedAt + 12 months`), VERIFIED.
Verified requires an uploaded label document (N1D-F2, `verifyRefusal :67`).
`foodIngredientIds` comes from the engine (`computeRecipeNutrition`,
`src/lib/recipe-nutrition.ts:133`) and walks through sub-recipes and PREPARED
ingredients to their raw food ingredients. Callers today: Menu Nutrition page
(`(app)/nutrition/menu/page.tsx:42`), `loadItemLabelData`
(`src/lib/nutrition-serving.ts:77`), the label preview and print.

- **Stale handling:** `proofState` is evaluated with a `now` passed at graph
  load (`loadNutritionGraph(orgId, now = new Date())`). A cached public payload
  freezes `now` at compute time, so an ingredient crossing its 12-month line
  shows Verified until the cache refreshes — bounded by the revalidate window
  (§ D). The fixture should pin "stale-verified counts as unverified" through
  the serializer, as the prompt asks.
- **No food ingredients (N-1b F8):** returns `NO_FOOD`; the N-2 label marks it
  `estimated: true` (N2 F4: "banner on any item not fully Verified, including
  items with no food ingredients"). For the public page: NO_FOOD is **not**
  Verified → "coming soon" under the F1 lean. **Fork F8a below** — it means a
  bottled water or a Red Bull resale item with only not-food lines can never
  show anything.
- **Errors (N-2 F4):** an engine error makes totals all-null and
  `itemVerification` returns NOT_VERIFIED before looking at ingredients;
  `buildLabel` returns `{ ok: false }`. Public: treated as unverified.

**Gaps found — the public page cannot rely on `itemVerification` alone:**

1. **VERIFIED ≠ complete.** `verifyRefusal` requires a basis and a document,
   not every nutrient. A verified ingredient whose label omits, say, vitamin D
   leaves the item's vitamin D total `null`; the N-2 label prints "—" (the
   staging evidence in the prompt itself shows "vitamins shown '—'"). On a
   public FDA-style panel, "—" is not a legal declaration. If **calories** are
   null the list has no number at all. → **Fork N3-F6.**
2. **"Contains:" on a VERIFIED item includes unverified allergen sources.**
   The engine unions allergens from **not-food (`nutritionExempt`) lines**
   (`recipe-nutrition.ts:233-235`, deliberately: "an allergen an admin recorded
   is never dropped") and from a **PREPARED ingredient's own allergen list**
   (`:208`). Neither can be Verified (`verifyRefusal` refuses both). In practice
   this only ADDS allergens, which errs safe; but "allergens only for fully
   Verified items" is strictly about ingredients that went through
   verification. → **COMMENT / ruling in N3-F1's wording:** lean — show the
   union as is (adding an allergen is never the dangerous direction), and never
   use a not-food/prepared-only allergen to make an item look allergen-free.
3. **Verification is per SIZE.** `SalesItem` is one row per Square
   **variation** (`name` = item, `variationName` = size; `displayName` =
   `"Item (Size)"`), and each variation has its own `Recipe`. So "Mango Tango"
   can be Verified in M and not in L. → **Fork N3-F7.**

## D. Caching

**Version:** `next` 16.2.9, `@clerk/nextjs` ^7.5.9. `cacheComponents` is
**not** enabled (`next.config.ts`), and nothing in `src/` uses
`unstable_cache`, `revalidateTag`, `revalidatePath`, `"use cache"` or a
segment `revalidate` today (grep: zero hits). Available per
`node_modules/next/dist/docs/01-app/02-guides/caching-without-cache-components.md`:

- `unstable_cache(fn, keyParts, { tags, revalidate })` — caches a DB-backed
  function across requests and instances (Vercel data cache).
- `revalidateTag(tag, "max")` — stale-while-revalidate on next visit;
  `revalidateTag(tag, { expire: 0 })` for immediate expiry. **The one-argument
  form is deprecated in 16** (`revalidateTag.md:22,55`). `updateTag` exists for
  Server Actions; this app writes through route handlers, so `revalidateTag`.

**Proposed shape:**

- `getPublicMenu(slug)` → resolves slug → org (one indexed lookup, uncached or
  separately cached) → `unstable_cache(() => buildPublicMenuPayload(orgId),
  ["public-menu", orgId], { tags: [`public-menu:${orgId}`], revalidate: 300 })`.
  The cached value is the **serialized public payload only**, never the graph.
  Key includes the org id so one org can never be served another's payload.
- **Invalidate on:** the publish-settings PUT (immediate — `{ expire: 0 }` so
  "turn off" takes effect at once; the 404 must not wait 5 minutes), nutrition
  writes (`nutrition/ingredients/[id]` PUT/DELETE, `.../verify`, `.../label`
  PUT/DELETE, `import/apply`, `bulk-exempt`, `settings`, `items/[id]/serving`)
  → `"max"`.
- **NOT individually invalidated:** recipe, ingredient, merge, sales-item and
  Square-sync writes — **~40 inventory write routes** change the recipe graph
  (listed by `find src/app/api/inventory -name route.ts` with a write export).
  Wiring all of them is a sweep that will miss the next one (§ Verifying a
  guard). The `revalidate` window carries them, and the 12-month stale line.
  Lean: **300 s**. Recommendation, not a ruling — Gary may want shorter.
- **Off/unknown slug:** the slug lookup must read `enabled` fresh (or be
  invalidated with `expire: 0`) so off → 404 is immediate.
- **Rate limiting:** no limiter exists in the app (the only one counts
  `AuditLog` rows for label reads — `label/read/route.ts:82`, unsuitable for
  anonymous traffic). With the payload cached, a request costs one slug lookup
  plus a cache read. Lean: **no per-IP limiter in N-3**; rely on caching plus
  Vercel's platform protection. A negative-cache for unknown slugs is cheap to
  add if needed.

**Estimate for Keva (not measured — see why):**

- Dev measurement (`br-broad-wave-a6vpjdw0`, org
  `cf888f2d-f234-48c7-8097-fd5b44b5b3dd`, 2026-11-02): 1,179 non-deleted
  `SalesItem` rows, **0 recipes, 8 ingredients** — the dev fork predates the
  recipe build, so compute time and payload size **cannot be measured on dev**.
  Graph load (queries only) took 512–649 ms from a dev machine.
- Estimate from structure: ~454 recipes; the engine is memoized, linear in
  lines (`computeAllRecipeNutrition`), so compute is tens of ms; the cost is the
  queries (`loadCostGraph` + ingredients + serving settings ≈ 0.5–1.5 s cold).
  That is acceptable once per 5 minutes, not per request — which is the
  argument for the cache.
- Payload: per size ~ name + size + calories + 2 label columns × 15 nutrients
  as short strings + allergens ≈ 1.2–1.8 KB JSON; × ~450 sizes ≈ **0.5–0.8 MB
  raw if every label ships in the page**, ~60–100 KB gzipped. Lean: ship the
  list (name, sizes, calories, allergens) in the page (~60 KB raw) and the full
  label values in the same payload but rendered on tap — or fetch labels per
  item from a public route. **COMMENT** for build; measure on staging and record
  it (a figure from staging, not this estimate).

## E. Schema — smallest addition

Additive only. Names avoid `MenuItem*` (DEBT-124 stub) and a bare `Menu`.

```prisma
model PublicMenu {
  id                 String   @id @default(cuid())
  organizationId     String   @unique
  enabled            Boolean  @default(false)      // F3: off until an ADMIN turns it on
  slug               String   @unique              // global uniqueness across orgs
  disclaimer         String?                       // null = the default text
  crossContactNotice String?                       // null = the default text (F4)
  updatedByUserId    String?
  updatedAt          DateTime @updatedAt
  organization       Organization @relation(...)
  categories         PublicMenuCategory[]
  hiddenItems        PublicMenuHiddenItem[]
}
model PublicMenuCategory {          // included menu groups — none by default (F3)
  publicMenuId     String
  squareCategoryId String           // SquareCategory.id (the row), NOT the name
  @@id([publicMenuId, squareCategoryId])
}
model PublicMenuHiddenItem {
  publicMenuId String
  squareItemId String               // the Square ITEM, hiding every size
  @@id([publicMenuId, squareItemId])
}
```

Decisions inside the shape (recommendations):

- **Separate `slug`, not `Organization.slug`.** That column is written by the
  Clerk webhook (`webhooks/clerk/route.ts:52,92`, `org.slug ?? slugify(name)`),
  is used in a download filename, and carries HR-14's rename bug (a Clerk
  rename never rewrites it). A public URL the ADMIN edits must not be
  overwritten by a webhook. Validation: lowercase `[a-z0-9-]`, 3–60 chars, a
  small reserved list. Case-folded on write so `@unique` is effective.
- **No row = off.** The page creates the `PublicMenu` row on first save; an org
  with no row 404s. `enabled` default false covers F3 twice over.
- **Include by `SquareCategory.id`, not by name.** `SalesItem.menuGroup` is a
  name copy; renaming a Square category would silently drop a group from the
  public menu if keyed on name. `SalesItem.squareCategoryId` already holds the
  FK. Items with no category (dev: 88 variations, 12 items) cannot be included
  — **COMMENT:** acceptable, or add an "Uncategorized" pseudo-group later.
- **Hide by `squareItemId` (item), not by `SalesItem.id` (size).** The public
  page groups by item; hiding a size alone is not a requested feature.
  `squareItemId` survives catalog re-syncs (SalesItem rows are upserted on
  variation id).
- **Not `@@unique` on organizationId + slug** — slug is globally unique;
  `organizationId @unique` makes it one menu per org.
- Draft default texts live in code, not in the column, so improving the default
  later reaches every org that never edited it.
- **Writes:** one PUT `api/nutrition/publish` (ADMIN, `nutrition.manage`,
  `requireNutrition`), Zod-validated, one `AuditLog` row
  (`nutrition.publish.settings`, from → to) in the transaction — the NU-9
  pattern (`api/nutrition/settings/route.ts`). Invalidates the cache.

## F. Menu groups

**Where `menuGroup` comes from:** `src/app/api/square/sales-items/sync/route.ts:84-121`
— the Square catalog is listed (`ITEM,CATEGORY`), every category upserted into
`SquareCategory` (row id ↔ `squareCategoryId`, name, isDeleted), and each
variation's `SalesItem.menuGroup` set to the **name of the item's first
category** (`itemData.categories?.[0]?.id ?? itemData.category_id`), with
`squareCategoryId` set to the `SquareCategory` row id. Items in several Square
categories land in the first one only. Only an ADMIN sync refreshes it.

**Production query for Gary (Neon console → production branch, SQL editor).**
Read-only. The branch id comes from the server, not a typed label (R4):

```sql
SELECT
  current_setting('neon.branch_id', true)                       AS branch_id,
  COALESCE(si."menuGroup", '(no menu group)')                   AS menu_group,
  si."squareCategoryId"                                         AS square_category_row_id,
  COUNT(DISTINCT si."squareItemId")                             AS items,
  COUNT(*)                                                      AS sizes,
  COUNT(DISTINCT si."squareItemId") FILTER (WHERE r.id IS NOT NULL) AS items_with_recipe,
  COUNT(r.id)                                                   AS sizes_with_recipe
FROM "SalesItem" si
LEFT JOIN "Recipe" r ON r."salesItemId" = si.id
WHERE si."organizationId" = 'cf888f2d-f234-48c7-8097-fd5b44b5b3dd'
  AND si."isDeleted" = false
GROUP BY si."menuGroup", si."squareCategoryId"
ORDER BY items_with_recipe DESC, menu_group;
```

Expected shape: one row per group; `branch_id` should read the production
branch (`br-sparkling-block-a620qvg4` per CLAUDE.md § Browser Evidence). A
group appearing twice means two Square categories share a name — that is
exactly why inclusion keys on the row id.

**Dev, for orientation only** (`br-broad-wave-a6vpjdw0`, org
`cf888f2d-f234-48c7-8097-fd5b44b5b3dd`, 2026-11-02; NO recipes on dev, so
`with_recipe` is 0 everywhere and the counts are fork-era): 54 groups + 88
uncategorized variations. Largest: Keva Coffee (50 items / 136 sizes), Fresh
Fruit Bouquets & Chocolate Strawberries (58/58), Season Specials (15/59),
Retail (34/46), Blend Ins (28/28), Gourmet Dipped Strawberries (21/36), Fruit
Bouquets (25/28), Archived (19/47). Names the "suggested set" should exclude:
Archived, Fruit Bouquet Archived, Retail, Palomino T-Shirts, Keva Shirts, Mugs
and Drinkware, Bouquets / Fruit Bouquets / *Bouquets and Strawberries* (4
groups), Services, Fundraising, Supplements, Misc Items, Events * (4 groups).
Note "Blend Ins" (28 single-size add-ons) — these are modifiers sold as items;
N-5 territory, likely excluded.

---

## Forks — chat's leans; Gary rules

Prompt forks, unchanged:

- **N3-F1 Unverified items** — lean: show the item and its sizes with
  "Nutrition coming soon", no numbers, **no allergens**. Alt: hide entirely.
- **N3-F2 List calories** — lean: whole item as sold, per size; per-serving in
  the full label.
- **N3-F3 Defaults** — menu off until turned on; no menu groups until ticked.
- **N3-F4 Cross-contact notice** — lean: always shown with allergens and the
  filter, wording editable.
- **N3-F5 Embedding** — lean: `frame-ancestors *` on `/menu/*` only. Alt: an
  allowed-origins list per org.

New forks from this audit:

- **N3-F6 Verified but incomplete.** A VERIFIED size can have null nutrients
  (label prints "—"). Options: (a) public shows VERIFIED only when also
  `complete` — otherwise "coming soon"; (b) show the label with "—" lines;
  (c) require calories + the 2016 mandatory panel nutrients, allow "—" only
  for the four micronutrients. **Lean: (a)** — the public rule is "numbers we
  stand behind", and a panel with dashes is not one. Measure how many Keva
  sizes it costs on staging before committing to it.
- **N3-F7 Per-size verification.** Options: (a) per size — Verified sizes
  show calories, others in the same item show "coming soon"; the tap-through
  label offers only Verified sizes; (b) per item — the item shows numbers only
  when every size is Verified. **Lean: (a)**, but allergens are shown at item
  level only if **every** size is Verified (the filter acts on items; a
  partial allergen set at item level is the risky direction). Gary's call.
- **N3-F8 NO_FOOD items** (only not-food lines — e.g. resale cans) and
  **items with no recipe** in an included group. Lean: NO_FOOD → "coming
  soon"; no recipe (UNMAPPED) → "coming soon"; `recipeStatus = NON_RECIPE` →
  left off the public menu entirely.

## RULING NOW

- **R-1 Framing protection for the rest of the app** (§ B). Today there is
  none. (a) N-3 adds headers to `/menu/*` only, exactly as prompted; or
  (b) N-3 also sends `X-Frame-Options: DENY` + `frame-ancestors 'none'` on
  every non-`/menu` route. **Lean: (b)**, with the iframe-renderer enumeration
  done before it lands. If (a), file a ROW for the app-wide header.
- **R-2 Module gate on the public page** (§ A): menu also 404s when the org's
  nutrition (or inventory) module is off. Lean: yes.
- **R-3 Cache window** (§ D): 300 s for recipe/ingredient edits and the stale
  line; immediate on publish-setting changes; SWR on nutrition writes. Lean as
  stated; Gary may prefer shorter.

## COMMENT (handled in the build, no ruling needed unless Gary objects)

- `/menu(.*)` matcher also matches `/menus` etc. — tighten to `/menu/(.*)`
  while touching it, keeping `/menu` itself public only if a bare index is
  wanted (it is not; it 404s).
- ClerkProvider loads clerk-js on the public/embedded page; accepted for N-3.
- Payload: list in-page, labels rendered on tap; measure on staging.
- Items with no Square category cannot be included.
- Sessions must stop using `/menu` as a temp-preview hook once N-3 lands (a
  memory note, not a repo change).
- `PERMISSIONS_INVENTORY`: § 1a row for `/menu` stays; new PG row for
  `menu/[slug]/page.tsx` (public), PG row for `(app)/nutrition/publish`,
  NU row for the publish PUT.

## Not done in Phase 1

No code, no schema edit, no migration, no commit. The scratch measurement
script lives outside the repo and is not committed. The N-2 promotion stamp
(item 7) is for the docs commit; the production `finished_at` for
`20261102230000_n2_nutrition_serving_settings` is still owed from Gary.
