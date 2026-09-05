---
id: inv-ingredients
title: Ingredients
entry: /inventory/ingredients
routes:
  - /inventory/ingredients
  - /inventory/ingredients/deleted
  - /inventory/ingredients/duplicates
summary: >
  What you buy and count — vendors, pack sizes and unit costs. Add ingredients,
  organise them into categories, and import them in bulk from a CSV.
roles: [ADMIN, MANAGER, STORE]
capability: inventory.nav.view
module: inventory
order: 280
keywords: [ingredients, inventory, categories, pack size, unit cost, csv]
sections:
  - id: housekeeping
    heading: Duplicates and deleted ingredients
    capability: inventory.assets.manage
    routes:
      - /inventory/ingredients/deleted
      - /inventory/ingredients/duplicates
images:
  - id: inv-ingredients/deleted-01.png
    alt: The Deleted Ingredients list, with a Restore button on each row
    section: housekeeping
---

Ingredients are what you **buy and count** — the raw goods behind a recipe, with
a vendor, a pack size and a unit cost.

They are deliberately not the same thing as Sales Items. Sales Items come from
Square and are what a customer pays for; ingredients are yours and are not
synced from Square. A smoothie is a sales item; the mango in it is an
ingredient.

## Adding an ingredient

**New Ingredient** opens the form. What matters most is the pack size and unit
cost, because those are what let a count turn into a number of dollars, and what
lets a recipe cost itself.

## Categories

**Categories** groups ingredients so counting is not one long alphabetical list.
Most people shape these around where the stock physically lives, or around how a
count is walked, rather than around what the ingredient is.

## Importing from a CSV

Where you already keep a list somewhere else, the CSV import brings it in in one
go rather than one form at a time.

## Duplicates and deleted ingredients

The same ingredient entered twice under slightly different names splits its
history — two unit costs, two count lines, and a recipe pointing at whichever
one was picked that day. **Duplicates** finds likely pairs so they can be
merged.

Deleting an ingredient does not erase it. It moves to **View Deleted**, where
the whole list of removed ingredients stays available and any of them can be
restored with one click. This is why deleting is safe to do when a list has
grown untidy: nothing is lost, and an ingredient that turns out to still be in
use can be brought straight back.
