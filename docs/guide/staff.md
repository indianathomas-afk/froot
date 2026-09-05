---
id: staff
title: The staff directory
entry: /staff
routes:
  - /staff
  - /staff/[id]
summary: >
  Add and manage the people who work at each store, link them to Square, set
  their primary store, and open a person's record.
roles: [ADMIN, MANAGER]
capability: staff.view
module: null
order: 80
keywords: [staff, team, employees, directory, square, wage, pay, primary store]
---

Staff Members is the list of people who work for you. It is what makes "who
completed this task" a name rather than a login, so it is worth keeping current
even if you do not use the HR or Labor modules.

The list shows each person, the stores they are assigned to, and — depending on
your access and your Square setup — their pay.

## Adding people

There are two ways in, and they are not interchangeable.

**Add** creates one person by hand. Use it for someone who is not in Square, or
before their Square record exists.

**Import from Square** pulls your Square team across in bulk. This is the usual
route if Square is already your source of truth for who works where. Import is
the faster path and it is also the one that keeps the Square link intact, which
matters for the pay column below.

**Sync** refreshes people already linked to Square — it updates existing records
rather than adding new ones.

## Stores and the primary store

A person can be assigned to several stores. The chips beside their name are
those assignments, and one of them is their **primary** store.

Square has no concept of a primary location — it returns a person's locations
in alphabetical order, which is not a ranking. So the primary store lives in
Froot, not in Square, and you set it here by clicking the chip you want.

## What the pay column is telling you

If you can see pay at all, the column has three distinct states and they mean
different things:

- **A rate** — Square carries a wage setting for this person.
- **"Not set in Square"** — they are linked to Square and no wage is configured
  there. The gap is in Square, not in Froot.
- **"—" with a reason** — they are not linked to Square at all, so Froot has no
  wage to show. Linking them fixes it; typing a number here would not.

Whether the column appears at all depends on your own access and on whether the
Advanced Labor overlay is switched on for your organisation. If you cannot see
it, no wage was ever loaded for your session — it is not hidden from view, it
was never fetched.

## Opening one person

Clicking a row opens that person's record: their assignments, their Square link
state, and — where the HR module is active — their documents and training.
