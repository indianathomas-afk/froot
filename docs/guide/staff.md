---
id: staff
title: The staff directory
entry: /staff
routes:
  - /staff
  - /staff/[id]
  - /staff/milestones
sections:
  - id: milestones-setup
    heading: Setting up milestones
    capability: milestones.manage
    routes:
      - /staff/milestones
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

## Setting up milestones

Where the HR module is on and an admin has switched on **Milestones** in
Settings, a **Milestones** button appears at the top of Staff Members. It opens
the setup page, which only admins can see.

Add a tenure milestone with the number of days from a person's start date (for
example 90, or 365 for one year), a title, what the business does to recognise
it, and a suggested message a manager can send in their own email. Froot never
emails employees.

Each person's **Milestones** tab then shows their next milestone, how many days
are left, and the milestones they have already reached. Days count from the
**Start Date** on their record, in their store's own time zone. Square fills the
start date from when the person's Square profile was created, unless someone
has edited it by hand.

Archiving a milestone stops it appearing for anyone who has not reached it yet.
People who reached it before it was archived keep it in their history.

### Leaving someone out of Milestones

Some people are never in line for a raise, salaried and executive staff for
example. To leave a person out, an admin opens **Labor Settings**, picks a
store in the Positions table, and switches that person's **Milestones** switch
off. The switch is there only while Milestones is on.

Once it is off, that person has no On-time or Raise badge on Staff Members, no
Milestones tab, no row in the Milestone Report, and no milestone emails. The
switch belongs to the person, not the store, so turning it off on one store's
list turns it off everywhere they work. Nothing is deleted: switch it back on
and everything returns as if it had never been off. Square never changes this
switch. People shown as "Not in Froot" need to be added to Froot before it can
be set.

### Raise eligibility

Where Square labor is switched on, the setup page's **Raise eligibility**
section sets the rules for a red, yellow or green **Raise** badge. Admins and
managers see it beside each person's name on Staff Members and on their
Milestones tab. Store accounts and staff never see it.

- **Compliance gate** — red while any assigned training is overdue or any
  required document is unsigned. Tenure milestones are not affected.
- **Hours** — paid hours (unpaid breaks taken off) in each of the last
  completed Monday–Sunday weeks, all stores combined. The current week never
  counts.
- **On-time** — the same percentage as the On-time badge, over those weeks.
  Below the minimum is red.
- **Required trainings and documents** — each must be completed or signed. One
  that isn't assigned to a person shows "N/A — not assigned" and doesn't
  affect their badge.

Yellow means nothing is blocking but a rule isn't met yet, or there isn't
enough Square data to judge — a badge is never green on missing data. Set
hours or on-time to 0 to switch that rule off.
