# UX-2 — One current-store context + persistent location indicator

**Track:** platform
**Branch:** staging
**Type:** Refactor + UI
**Size:** M
**Depends on:** BUILD-2 for piece (c) only — (a) and (b) need nothing
**Created:** 2026-07-27

---

## The report this fixes

> "I thought I was in one location, however, had to switch. If I logged back in,
> there was a random feel that I always had to double check which location I was
> looking at." — Gary, 2026-07-27

**Two independent bugs, and neither is nondeterministic ordering** (that theory
was tested and refuted — see BUILD-2).

### Bug 1 — no shared source of truth

~14 store selectors, **three** mechanisms, no coordination:

| Mechanism | Surfaces |
|---|---|
| `localStorage["froot.dashboard.store"]` | dashboard, messages (shared) |
| `localStorage["froot.forecasting.store"]` — a **separate key** | forecasting |
| URL param `?store=` | checklists |
| `useState(stores[0]?.id ?? "")` | **~10 more** — every inventory surface, both labor surfaces, store-view |

Concretely: select **Uptown** on the Dashboard, click Inventory → Ingredients,
land silently on the **alphabetically-first** store. No indication anything
changed, because Inventory never reads the dashboard's key.

### Bug 2 — `localStorage` outlives logout

It is scoped to the browser **origin**, not the Clerk session. So dashboard and
forecasting show the previous selection after re-login while the other ~10
surfaces reset to alphabetical. **Two surfaces remember, ten forget** — that
mismatch is the "random feel."

Not a data leak: both persisting surfaces validate the saved id against the
caller's current store list and fall back
(`stores.find(s => s.id === savedStoreId)?.id ?? stores[0]?.id`). But it is worst
on a **shared device** — which is exactly what PERM-7 provisions, and worst of
all on an ADMIN device account where every store is in scope so a stale selection
persists in full.

---

## Three pieces, deliberately ordered so partial delivery still helps

### (a) SHOW IT — ship this first, regardless of the rest

A persistent current-location indicator in the app shell, beside the email where
UX-1 (b) already scopes a role indicator.

No schema, no refactor, and it directly answers "I always had to double check."
If only one piece of this phase ever ships, make it this one.

### (b) UNIFY IT — the actual bug fix

One shared context plus **one** storage key replacing all 14 independent
selectors, so a switch propagates everywhere.

Mechanical rather than hard: ~14 files, each a small swap from local `useState`
to the shared hook. **Enumerate every selector before starting** — the audit
found 14, but treat that as a floor and re-grep, because a missed surface is
indistinguishable from the bug you are fixing.

**Key the storage by user id (or clear it on sign-out)** — this is what closes
Bug 2. Do not skip it; on a shared store device it is the whole point.

Preserve the good behaviour already present: both existing localStorage readers
validate a saved id against the current store list and fall back if it is out of
scope. The unified context must keep doing that.

### (c) DEFAULT IT — needs BUILD-2

Seed the initial selection from `User.defaultStoreId` instead of
"alphabetically first." BUILD-2 is the only piece requiring a migration;
(a) and (b) do not.

**Fallback chain, never silent:** `defaultStoreId` (if still in scope) → last
selection (if still in scope) → alphabetically first.

---

## Do not touch

`sessionStorage["froot.dashboard.salesSelection"]` and
`sessionStorage["froot.labor.viewedDate"]` are **date/range state, not store
selectors.** They select a period *within* whatever store is active. Leave them
alone.

Checklists' `?store=` param is deliberately different — it also supports "All My
Stores" (`selectedStoreId: effectiveStoreId ?? "all"`), which is a filter state
the other surfaces do not have. Decide whether it joins the shared context or
stays a URL-driven filter, and **record the choice** — do not silently flatten it
and lose the "all" option.

---

## Sequencing note

(a)+(c) is a reasonable first release if (b) is too large to take on at once.
(a) without (b) is honest but still annoying; **(b) without (a) is invisible** —
you will have fixed the bug and nobody will be able to tell.

---

## Constraints

- No schema change in this phase — the column belongs to BUILD-2.
- Do not touch `../froot_docs/`.
- Commit when asked; **never push**.

## Done criterion

`next build` green, UX-2 row updated with its commit SHA, and a staging pass
proving: switch store on Dashboard → Inventory shows the same store; reload
preserves it; **log out and back in as a different user and confirm the previous
user's selection does not appear.**

## Report back

1. The full list of selectors found and migrated — flag any beyond the 14.
2. The checklists "all stores" decision.
3. The storage-key scheme and how logout is handled.
4. Whether (c) landed or is waiting on BUILD-2.
5. The explicit unpushed-commits line.
