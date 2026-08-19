# DEBT-28 — the two rulings, and what's left after them

Append the ruling block to DEBT-28's `notes:` (prepend-style, per
preserve-and-mark — nothing below it gets edited). The work list is what a
session picks up afterwards.

---

## To append to DEBT-28's notes

```
RULED 2026-08-17 (Gary) — THE TWO SITES THAT NEEDED A DECISION ARE DECIDED, AND
THE ROW IS NOW PURELY MECHANICAL. Prepended per preserve-and-mark; nothing below
is edited. The row's own HAZARD paragraph named two sites that "are not pure
separator swaps, they are different sentences, so they need a decision rather
than a find-and-replace". Both are now ruled and neither needs re-deriving.

(1) stores/page.tsx:162 — DROP THE "Store " PREFIX. It becomes `#0034 — Carson`,
matching the other thirteen label sites. It was the only site carrying the
prefix, which makes it drift rather than intent. This is a real edit, not an
exemption.

(2) store-view-client.tsx:100 — LEAVE `Carson (#0034)` AS IT IS, and the reason
is the durable half of this ruling: THE EM DASH FORM IS THE HOUSE RULE FOR
LABELS, AND HEADERS ARE EXEMPT. A label sits in a list or a chip, where the
number leads so a column scans; a header answers "which store am I in", where
the name is what the reader came for and the number is a qualifier. Two
different jobs, correctly rendered two ways. Recorded as an exemption rather
than left as an outlier so the next sweep does not re-file it as drift — which
is exactly what happened here, and cost this row three glyph variants when there
were only ever two.

WHAT REMAINS: five hyphen-minus sites to convert, one of which also drops the
prefix per (1). Eight sites already carry the em dash and are untouched. That is
five files, five edits, no decisions left in it.

THE SEQUENCING ADVICE BELOW STILL STANDS AND IS NOT OVERRULED. This row says
fold into DEBT-27 because only two stores currently carry a storeNumber, so
twelve of the fourteen sites do not render the separator at all today and the
change is invisible until the backfill lands. Doing it standalone is five files
for no visible effect. Doing it as part of any session that is already open in
staff/ or stores/ is free. Neither is wrong; what would be wrong is a dedicated
session for it.
```

---

## The work list, after the rulings

Five files. All five are one-character swaps except the first, which is two
changes in one line.

| File | Line | Change |
| --- | --- | --- |
| `src/app/(app)/stores/page.tsx` | 162 | `-` → `—` **and** drop the `Store ` prefix |
| `src/app/(app)/staff/staff-buttons.tsx` | 116 | `-` → `—` |
| `src/app/(app)/staff/[id]/staff-edit-actions.tsx` | 201 | `-` → `—` |
| `src/app/(app)/staff/page.tsx` | 127 | `-` → `—` |
| `src/app/(app)/staff/[id]/page.tsx` | 623 | `-` → `—` |

**Not touched, deliberately:** `store-view-client.tsx:100` (header exemption,
ruled above) and the eight sites already carrying U+2014.

**Verify by codepoint, not by eye.** The row makes this point and it is the
reason the drift went unnoticed for so long — U+2014 and U+002D are
indistinguishable in a diff. Grep for the literal characters rather than reading
the change.

**Line numbers are pointers and this row has had two go stale already.** Confirm
each one before editing; if a citation has moved, repair it in the row rather
than silently editing the new location.

---

## Commit

Display-only under the new CLAUDE.md rule — the gate is the test, no staging
walk-through owed.

```bash
git add src/app/\(app\)/stores/page.tsx src/app/\(app\)/staff/staff-buttons.tsx src/app/\(app\)/staff/\[id\]/staff-edit-actions.tsx src/app/\(app\)/staff/page.tsx src/app/\(app\)/staff/\[id\]/page.tsx docs/ROADMAP.yaml
```

```bash
npx eslint "src/app/(app)/stores/page.tsx" "src/app/(app)/staff/staff-buttons.tsx" "src/app/(app)/staff/[id]/staff-edit-actions.tsx" "src/app/(app)/staff/page.tsx" "src/app/(app)/staff/[id]/page.tsx" && npm run build > /tmp/build.log 2>&1 && git commit -F - <<'EOF'
stores/staff: one em-dash label form across the five hyphen sites

Converts the five U+002D label sites to U+2014 and drops the lone
"Store " prefix on stores/page.tsx, per Gary's 2026-08-17 rulings.
store-view-client.tsx:100 is left as a documented header exemption —
labels lead with the number, headers lead with the name.

DEBT-28
EOF
```
