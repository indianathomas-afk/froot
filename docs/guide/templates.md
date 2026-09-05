---
id: templates
title: Building checklist templates
entry: /templates
routes:
  - /templates
  - /templates/[id]
  - /templates/[id]/edit
  - /templates/new
summary: >
  The templates every store's daily checklist is generated from — sections,
  tasks, which tasks are critical, and which stores get them.
roles: [ADMIN]
capability: templates.manage
module: null
order: 30
keywords: [templates, checklist, tasks, sections, critical, photo, daily, weekly]
images:
  - id: templates/template-builder-01.png
    alt: The template builder, showing tasks grouped into sections with critical and photo settings
---

A template is the thing a daily checklist is made from. Stores do not build their
own — templates are set here and generated out to the stores assigned to them.

## Sections and tasks

Tasks belong to sections, and sections render in the order you build them. The
section name is what the person on shift sees as a heading.

Each task has two settings that change what happens on shift:

- **Critical** — an unticked critical task at submission makes the whole
  checklist Non-Compliant. Non-critical tasks left unticked do not.
- **Requires photo** — the task will not tick without a photo attached.

Mark a task critical when its absence is the thing you would want to see on a
report. Marking everything critical produces the same information as marking
nothing.

## Daily or Weekly

A template is Daily or Weekly. That decides how often a checklist is generated
from it for each assigned store.

## Store assignment

A template reaches stores through its assignments. Nothing is generated for a
store the template is not assigned to.

## Import and export

Templates can be exported and imported, which is how a template moves between
organisations or gets restored from a copy.

## Changing a template

Editing a template changes what is generated from it **next**. Checklists already
generated keep the tasks they were created with, so a change does not rewrite
yesterday's record or a checklist a store is part-way through.
