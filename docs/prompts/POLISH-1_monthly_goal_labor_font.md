# TIER 1 — POLISH-1: Enlarge the Monthly Goal card's labor % value

**Session type: DISPLAY-ONLY COSMETIC.** One card, typography only. No logic,
no data, no gating, no payload changes. CLAUDE.md's Display-Only Changes
rules apply.

Repo: `~/Claude_Projects/Froot/froot` (verify with
`git rev-parse --show-toplevel`). Branch `staging`.

## The change

The Monthly Goal card (the MTD labor % row AL-2 added beneath the
"Extrapolated to month end" block in
`src/app/(app)/dashboard/dashboard-client.tsx`, near the existing block at
~:447) currently renders the labor percentage value small (~text-base). Gary
wants it to sit on the same visual rung as the extrapolated dollar figure
directly above it.

1. **Value ("24.8%*"):** match the extrapolated month-end value's exact
   classes — expected `text-2xl font-bold` (READ the extrapolated value's
   classes first and copy them precisely rather than assuming; if that
   element uses different sizing, match whatever it actually uses).
   Preserve the existing judgment color classes (green/amber/red/bold-red
   states) and the asterisk exactly as they are — only size and weight
   change.
2. **Label ("August labor %"):** restyle to match the
   "EXTRAPOLATED TO MONTH END" label's classes (small-caps/uppercase
   tracking style — again, copy the actual classes from that element).
3. **Footnotes** (days-synced, on-the-clock, straight-time lines):
   unchanged. They are deliberately small.

## Rules

- Touch ONLY the label and value classes for this one row in this one
  component. No other card, no shared component, no logic line.
- Verify by reading the diff that zero non-className changes exist.
- `npm run build` green. One commit, e.g.
  `style(dashboard): monthly goal labor % — value to match extrapolated figure size`
- No push — Gary pushes.

## After (Gary)

Push, staging deploy green, eyeball the card, then it rides to production
on the next promotion (no urgency — cosmetic).
