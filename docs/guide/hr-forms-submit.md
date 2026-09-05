---
id: hr-forms-submit
title: Running an agreement form with someone
entry: /hr/forms/[id]/submit
routes:
  - /hr/forms/[id]/submit
summary: >
  Fill in an agreement form with a staff member present and capture their
  signature on the spot.
roles: [ADMIN, MANAGER]
capability: hr.forms.execute
module: hr
order: 240
keywords: [form, agreement, sign, capture, key handover]
---

This is the counter-side of an agreement form: you have the person in front of
you, and you are handing something over.

Building the form and running it are separate jobs, and separate permissions.

## The flow

You start from the form, pick the staff member, and fill in the fields with them
there. The fixed agreement wording is shown as written — it is not editable at
this point, and that is the whole reason the wording is fixed.

Then they sign. The record is captured against **them**, not you, even though
you drove the screen.

## Getting the details right the first time

Fields are captured as typed. There is no edit-after-signing, because a signed
agreement that can be altered afterwards is not evidence of anything — the same
reasoning behind versions being pinned everywhere else in HR.

So the details are worth reading back before the signature — which key, which
piece of equipment, which date.

## Who can run one

Running a form with someone is a manager job. Building forms is an admin one.
That split is deliberate: the person handing over a key should not be able to
quietly change what the agreement says while doing it.
