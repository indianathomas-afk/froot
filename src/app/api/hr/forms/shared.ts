import { z } from "zod"
import { prisma } from "@/lib/prisma"
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

// Executing a form for a staff member is ADMIN (org-wide) or MANAGER limited
// to staff in their own stores — the HR-4 attested-capture rule. Returns the
// staff row (with store assignments) or null when out of role/scope; callers
// 404 on null so out-of-scope staff don't leak existence.
export async function loadScopedStaff(
  organizationId: string,
  staffMemberId: string,
  dbUser: { role: string; storeAssignments: { storeId: string }[] }
) {
  if (dbUser.role !== "ADMIN" && dbUser.role !== "MANAGER") return null
  const staff = await prisma.staffMember.findFirst({
    where: { id: staffMemberId, organizationId },
    include: {
      storeAssignments: {
        include: { store: true },
        orderBy: [{ isPrimary: "desc" as const }, { store: { name: "asc" as const } }],
      },
    },
  })
  if (!staff) return null
  if (dbUser.role === "MANAGER") {
    const managerStoreIds = dbUser.storeAssignments.map((a) => a.storeId)
    if (!staff.storeAssignments.some((a) => managerStoreIds.includes(a.storeId))) return null
  }
  return staff
}
