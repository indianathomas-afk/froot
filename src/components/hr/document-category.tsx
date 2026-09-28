"use client"

import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { badgePreset } from "@/lib/badge-presets"
import { UNCATEGORIZED_LABEL } from "@/lib/hr-documents"

export { UNCATEGORIZED_LABEL }

// DOC-5. The org's document categories, rendered and picked the same way on
// every surface — the library, the document detail page, /hr/forms, the form
// builder and /staff/[id]. One taxonomy for documents and forms (F7).
//
// Every reader renders the RELATION (name + colorKey), never the legacy
// HrDocument.category string, which is stale by design (F3). A null category
// is a legal resting state (F2) and renders as "Uncategorized" in neutral grey.

export type DocumentCategoryOption = {
  id: string
  name: string
  colorKey: string
  sortOrder: number
}

// Radix Select cannot carry an empty-string value, so "no category" travels as
// this sentinel inside the picker and as null everywhere else.
const NONE = "__uncategorized__"

// F7 (Gary, 2026-09-28): both create dialogs pre-select the FIRST category in
// sort order. An org with no categories starts uncategorized.
export function defaultCategoryId(categories: DocumentCategoryOption[]): string | null {
  return categories[0]?.id ?? null
}

export function DocumentCategoryChip({
  name,
  colorKey,
}: {
  name: string | null | undefined
  colorKey: string | null | undefined
}) {
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium ${badgePreset(name ? colorKey : null).badge}`}
    >
      {name ?? UNCATEGORIZED_LABEL}
    </span>
  )
}

export function DocumentCategorySelect({
  categories,
  value,
  onChange,
}: {
  categories: DocumentCategoryOption[]
  value: string | null
  onChange: (id: string | null) => void
}) {
  return (
    <Select value={value ?? NONE} onValueChange={(v) => onChange(v === NONE ? null : v)}>
      <SelectTrigger>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {categories.map((c) => (
          <SelectItem key={c.id} value={c.id}>
            <span className="flex items-center gap-2">
              <span className={`h-2 w-2 rounded-full ${badgePreset(c.colorKey).dot}`} />
              {c.name}
            </span>
          </SelectItem>
        ))}
        <SelectItem value={NONE}>
          <span className="flex items-center gap-2">
            <span className={`h-2 w-2 rounded-full ${badgePreset(null).dot}`} />
            {UNCATEGORIZED_LABEL}
          </span>
        </SelectItem>
      </SelectContent>
    </Select>
  )
}
