// The time zones Froot offers in a picker, value = IANA id. ONE LIST, so the
// store form and the NOTIFY-SCHED schedule picker cannot drift apart. Moved
// here from src/app/(app)/stores/store-actions.tsx unchanged. A stored value
// not on this list is still valid — callers show it raw rather than drop it.
export const TIME_ZONE_OPTIONS = [
  { value: "America/Los_Angeles", label: "Pacific (PT)" },
  { value: "America/Denver", label: "Mountain (MT)" },
  { value: "America/Phoenix", label: "Arizona (MST)" },
  { value: "America/Chicago", label: "Central (CT)" },
  { value: "America/New_York", label: "Eastern (ET)" },
] as const

/** The picker label for a zone, or the raw id for one not on the list. */
export function timeZoneLabel(zone: string): string {
  return TIME_ZONE_OPTIONS.find((z) => z.value === zone)?.label ?? zone
}
