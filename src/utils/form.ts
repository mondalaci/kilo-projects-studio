import type { FormDetail, FormField } from "@/api/types"

/**
 * Helpers shared by the question card and the composer.
 *
 * A question is delivered as a v2 form. The card owns everything that is
 * *chosen* — options, checkboxes — while anything free-form is typed into the
 * usual composer, so a question never grows a second input area.
 */

/** The fields a person actually sees; hidden ones only contribute their default. */
export function visibleFields(form: FormDetail): FormField[] {
  return form.fields.filter((field) => !field.hidden)
}

/** The value a field starts from when nothing has been picked or typed. */
export function fieldDefault(field: FormField): unknown {
  return field.default ?? (field.type === "multiselect" ? [] : field.type === "boolean" ? false : "")
}

/** Coerce a raw value to the shape the field's type expects. */
export function normalizeValue(field: FormField, value: unknown): unknown {
  if (field.type === "multiselect") return Array.isArray(value) ? value : []
  if (field.type === "boolean") return value === true || value === "true"
  if (field.type === "number" || field.type === "integer") {
    if (typeof value !== "string") return value
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : value
  }
  return value
}

/**
 * Whether a line typed in the composer can answer this field.
 *
 * A field that offers options only takes one of them — unless it also invites a
 * custom answer — while a checkbox, a multiple choice or an external link has
 * nothing a typed line could fill.
 */
export function acceptsText(field: FormField): boolean {
  if (field.type === "boolean" || field.type === "multiselect" || field.type === "external") return false
  if (field.options?.length) return field.custom === true
  return true
}

/** Whether the card itself has anything to click, so it needs its Submit button. */
export function hasCardControls(form: FormDetail): boolean {
  return visibleFields(form).some((field) => Boolean(field.options?.length) || field.type === "boolean")
}

/**
 * The answer a line typed in the composer gives a pending question.
 *
 * The text lands on the first field that can take it — a question usually has a
 * single free-form one — and every other field keeps its default, because the
 * server reads the answer as a whole. Returns null when no visible field could
 * take typed text, so the caller can fall back to sending a normal message
 * rather than answering a question nobody asked.
 */
export function answerFromText(form: FormDetail, text: string): Record<string, unknown> | null {
  const body = text.trim()
  if (!body) return null
  const fields = visibleFields(form)
  const target = fields.find(acceptsText)
  if (!target) return null
  const answer: Record<string, unknown> = {}
  for (const field of fields) {
    answer[field.key] = normalizeValue(field, field === target ? body : fieldDefault(field))
  }
  return answer
}
