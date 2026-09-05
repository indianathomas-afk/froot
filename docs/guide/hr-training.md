---
id: hr-training
title: Training modules
entry: /hr/training
routes:
  - /hr/training
  - /hr/training/new
  - /hr/training/[id]/edit
  - /hr/training/[id]/preview
summary: >
  The training your team works through, how it reaches the right people, and how
  you see who has finished.
roles: [ADMIN, MANAGER]
capability: hr.training.manage
module: hr
order: 250
keywords: [training, modules, onboarding, quiz, assign, stores]
sections:
  - id: authoring
    heading: Building and changing a module
    capability: hr.training.author
    routes:
      - /hr/training/new
      - /hr/training/[id]/edit
---

Training modules are the structured version of what most shops teach by standing
next to someone. A module holds the material, and usually a short quiz to check
it landed.

## Active, Inactive and Archived

The list is split three ways. **Active** modules are in use and can be assigned.
**Inactive** modules are set aside — intact, but not in use. **Archived** modules
are retired and kept because completion records point at them.

## Assigning to stores

A module reaches people through the stores it is assigned to. Assign it to a
store and it appears for the people at that store, rather than being handed to
one person at a time.

**Assign in bulk** assigns several modules across stores in one pass, rather than
opening each module in turn.

## The quiz

Most modules carry a quiz with a pass threshold. The threshold is the score a
person must reach for the module to count as complete; below it, the module stays
outstanding for them.

## Previewing before it goes out

Preview shows a module the way the person working through it will see it — the
material in order, and the quiz. Nothing you do in preview is recorded as a
completion.

## Building and changing a module

Start a new module from **New Module**, or open an existing one to change it.

A module is a title, its material, and optionally a quiz with a pass threshold.
**Duplicate** copies an existing module — its material and its quiz questions —
into a new one you then edit.

Changing a module does not retract completions already recorded against it. Those
records stay as they were.
