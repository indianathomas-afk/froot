---
id: hr-documents
title: The document library
entry: /hr/documents
routes:
  - /hr/documents
  - /hr/documents/[id]
summary: >
  The handbooks, policies and forms your team reads and signs. Add a document
  and choose whether it needs a signature.
roles: [ADMIN, MANAGER, STORE, STAFF]
capability: hr.documents.view
module: hr
order: 220
keywords: [documents, library, handbook, policy, signature, acknowledgment, i-9]
sections:
  - id: versions-and-fields
    heading: Versions, detected fields and audience
    capability: hr.documents.manage
    routes:
      - /hr/documents/[id]
images:
  - id: hr-documents/document-detail-01.png
    alt: A document's detail screen showing its version history and detected fields
    section: versions-and-fields
---

The Document Library is everything your team is expected to read or sign — the
handbook, policies, tax forms, anything else you would otherwise hand someone on
paper.

## The three kinds, and the choice matters

When you add a document you pick one of three kinds, and the choice decides what
happens to it afterwards. It is the only decision on the form that is hard to
change later.

- **Reference** — a read-only library document. People can open it. Nothing is
  tracked, nobody is asked to sign, and it never appears on anyone's outstanding
  list.
- **Signature** — staff must read and acknowledge it. PDF only. Per-page initial
  checkpoints and a final acknowledgment are generated for you, and completion is
  tracked per person.
- **Link** — points at a document hosted somewhere else, such as a government
  form. Use this when the authoritative copy is not yours to host and you do not
  want a stale duplicate.

The rule of thumb: if you would ever need to prove someone read it, it is a
Signature document. If you just need people to be able to find it, it is a
Reference.

## Adding one

**Reference** and **Link** accept PDF, PNG, JPG, DOC or DOCX up to 25 MB.
**Signature** documents are PDF only, because the per-page checkpoints are
generated from the pages themselves.

The instructions field is what the person sees when the document is put in front
of them — "sign and return by Friday" rather than a description of the file.

## Versions, detected fields and audience

Opening a document shows its version history. **A new version does not silently
replace the old one**: signatures are pinned to the version that was signed, so a
record stays true to the document the person actually saw. That is why old
versions remain listed rather than being cleaned up.

For a Signature document, Froot detects the fillable fields in the PDF and lists
them for you to confirm before anyone can sign. **A version whose fields are not
confirmed cannot start a signing ceremony** — this is deliberate, and it is what
stops someone initialling a document whose fields were never checked.

Audience assignment is on this screen too: who this document goes to, by store
or by person. Changing the audience does not retract signatures already
collected — the people who signed still signed.
