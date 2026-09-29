---
id: hr-compliance
title: The compliance rollup
entry: /hr/compliance
routes:
  - /hr/compliance
summary: >
  Who has finished their documents and training and who has not, by person and
  by store.
roles: [ADMIN, MANAGER]
capability: hr.compliance.view
module: hr
order: 270
keywords: [compliance, outstanding, complete, onboarding, by store, by document, who has not signed, key register, keys, returned, who has a key]
---

Compliance answers one question: is everyone up to date, and if not, who is not.

It is a readout. Nothing is set here — every number on this page is produced by
what people have or have not done elsewhere, so the fix for a bad number is
always on another screen.

## By Store

Outstanding items grouped by store, so a location can be read on its own rather
than against the estate total.

## By Document

The same numbers turned the other way: pick a document and see who owes it.

Each signature document shows how many of the people it applies to have signed
it, as "X of Y signed". Open it to see those people grouped by store, each marked
Signed, In progress, Needs re-sign or Not started. A name opens that person's
profile.

Narrow the list with the category chips or pick a single document. Outstanding
only is on by default, so an open document lists the people who still owe it;
turn it off to see the signers as well. The Signing status link on a document in
the Document Library opens this section on that document.

"Signed v2" means the person signed an earlier version and that signature still
counts. Needs re-sign means they signed in an earlier period of employment and
have to sign again.

A document with no audience is not listed here, because it applies to nobody. A
note under the list says how many there are; the Document Library marks them
Unassigned. Archived documents are not listed either.

## Key Register

Who has a key right now. It appears once a document is set to track returns.

Some documents hand something over when they are signed, like the Key Agreement
and its key. Open that document's edit dialog in the Document Library, turn on
Tracks return and say what is issued ("Key"). Only uploaded signature documents
have the setting.

Everyone who has signed the document is listed as holding one until it is marked
returned, grouped by store, with the date they signed and any key number they
filled in. Holding goes by person, not by version or period of employment:
someone who signed an older version, or signed during an earlier period of
employment, still holds the key they were given.

Mark returned records the date it came back and an optional note. The person
leaves the list, and the return shows on their profile's Documents tab. If it
was a mistake, or they are given a key again, use Reissue on their profile. A
return can't be edited or deleted; the history keeps both entries. Signing the
document again after a return also counts as being given a key.

A terminated person who still holds a key stays on the list, marked Terminated —
not returned. An archived document keeps its holders listed, marked (archived);
Mark returned still works there, Reissue doesn't.

Terminating someone who still holds a key shows a warning listing what they
haven't returned. It doesn't stop you.

Admins can record a return for anyone; managers for people in their stores.
Holding a key is not a gap and doesn't change any compliance number.

## Team Members

Per person, what is outstanding.

Someone can appear here without having missed anything. A signature on an
earlier version of a document still counts when a new version is issued. The
document returns to everyone's outstanding list only when the new version is
marked as needing everyone to sign again.

## Agreement Forms

Agreement forms are counted separately from documents and training. They are
issued one at a time rather than assigned to a store, so they are not part of the
same totals.

## What to do about a gap

Apart from Mark returned in the Key Register, nothing is editable from this page. Documents are signed on the document,
training is completed by the person, and an agreement form is run with them.
