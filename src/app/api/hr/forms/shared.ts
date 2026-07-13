import { z } from "zod"
import { FORM_FIELD_TYPES } from "@/lib/hr-documents"

// Field-definition payload shared by the create and edit routes. Select
// fields must ship their choices; other types must not carry any.
export const formFieldSchema = z
  .object({
    label: z.string().trim().min(1).max(200),
    fieldType: z.enum(FORM_FIELD_TYPES),
    required: z.boolean().default(true),
    options: z.array(z.string().trim().min(1).max(100)).min(1).max(50).optional(),
  })
  .superRefine((field, ctx) => {
    if (field.fieldType === "Select" && (field.options?.length ?? 0) < 2) {
      ctx.addIssue({
        code: "custom",
        message: `Dropdown field "${field.label}" needs at least 2 options`,
      })
    }
    if (field.fieldType !== "Select" && field.options?.length) {
      ctx.addIssue({
        code: "custom",
        message: `Field "${field.label}" is not a dropdown and cannot have options`,
      })
    }
  })

export const formFieldsSchema = z.array(formFieldSchema).max(100)

export const FORM_BODY_TEXT_MAX = 20000
