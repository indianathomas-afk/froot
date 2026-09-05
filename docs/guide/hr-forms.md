---
id: hr-forms
title: Agreement forms
entry: /hr/forms
routes:
  - /hr/forms
  - /hr/forms/[id]
summary: >
  Build a short agreement — a key issue, an equipment loan — with fixed wording
  and a few fields, ready to be signed with a staff member.
roles: [ADMIN]
capability: hr.forms.manage
module: hr
order: 230
keywords: [forms, agreement, key, equipment, loan, fields]
images:
  - id: hr-forms/form-builder-01.png
    alt: The form builder, showing the agreement wording above a list of fields
---

An agreement form is for the small, repeated commitments that are not a handbook
— issuing a key, lending a piece of equipment, anything where you need fixed
wording plus a couple of specifics.

Unlike a library document, you write the wording here rather than uploading a
file, and the specifics are captured as fields at signing time.

## Writing the agreement

The agreement text is the part that does not change. Write it as the finished
sentence the person is agreeing to — for example, that a key has been issued and
that an unreturned key is deducted from a final paycheck.

Everything that varies between one signing and the next belongs in a field
instead, not in this text.

## Fields

Fields are what gets filled in when the form is actually used. Each has a label
and a type:

- **Text** — anything short and free-form.
- **Date** — a date.
- **Email** and **Phone** — the same as Text, but the format is checked.
- **Number** — a quantity.
- **Select** — a fixed list of choices, which you supply comma-separated. Use
  this wherever the answer should be one of a known set, because it is the only
  type that keeps the wording consistent between people.

A Select field needs at least two options — one option will not save.

## Versions

Editing a form creates a new version. Signings stay attached to the version that
was signed, so changing the wording never rewrites what someone already agreed
to — the same rule the document library follows.
