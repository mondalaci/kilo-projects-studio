<script setup lang="ts">
import { reactive } from "vue"
import { Check, HelpCircle, ShieldAlert } from "lucide-vue-next"
import type { FormDetail, FormField, FormOption } from "@/api/types"
import { useApp } from "@/stores/app"
import { answersSettle, fieldDefault, needsSubmit, normalizeValue, visibleFields } from "@/utils/form"

const app = useApp()
const { pendingPermissions, pendingForms } = app.chat
const { replyPermission, replyForm } = app

/** Form answers, keyed `${formID}:${fieldKey}` then normalised on submit. */
const answers = reactive<Record<string, unknown>>({})

/** Forms whose answer is already on its way, so a click that lands twice sends one. */
const sending = new Set<string>()

function fieldValue(form: FormDetail, field: FormField): unknown {
  const key = `${form.id}:${field.key}`
  if (key in answers) return answers[key]
  // An untouched Yes/No holds no answer: "no" is a choice, not a starting point.
  if (field.type === "boolean") return undefined
  return fieldDefault(field)
}

function setField(form: FormDetail, field: FormField, value: unknown) {
  answers[`${form.id}:${field.key}`] = value
}

/** The buttons a field puts on the card: its own options, or a Yes/No pair. */
function choices(field: FormField): FormOption[] {
  if (field.options?.length) return field.options
  if (field.type === "boolean") return [{ value: "true", label: "Yes" }, { value: "false", label: "No" }]
  return []
}

/** An option click: a toggle when several may be picked, a choice when one may. */
function choose(form: FormDetail, field: FormField, value: string) {
  const key = `${form.id}:${field.key}`
  if (field.type === "multiselect") {
    const current = Array.isArray(answers[key]) ? (answers[key] as string[]) : []
    const pos = current.indexOf(value)
    answers[key] = pos === -1 ? [...current, value] : current.filter((item) => item !== value)
  } else {
    setField(form, field, field.type === "boolean" ? value === "true" : value)
  }
  // The click that lands the last choice is the form's send, not just a pick.
  submitIfSettled(form)
}

function isPicked(form: FormDetail, field: FormField, value: string): boolean {
  const current = fieldValue(form, field)
  if (field.type === "multiselect") return Array.isArray(current) && (current as string[]).includes(value)
  return current !== undefined && current !== null && String(current) === value
}

/** Answer a form the moment its last choice lands: the card keeps no Submit button. */
function submitIfSettled(form: FormDetail) {
  if (answersSettle(form, (field) => fieldValue(form, field))) submit(form)
}

function submit(form: FormDetail) {
  if (sending.has(form.id)) return
  const answer: Record<string, unknown> = {}
  for (const field of visibleFields(form)) {
    answer[field.key] = normalizeValue(field, fieldValue(form, field))
  }
  sending.add(form.id)
  // A reply that fails leaves the form pending, so it may be answered again.
  void replyForm(form.sessionID, form.id, answer).catch(() => sending.delete(form.id))
}
</script>

<template>
  <div v-if="pendingPermissions.length || pendingForms.length" class="dock">
    <div v-for="request in pendingPermissions" :key="request.id" class="card permission">
      <div class="card-head">
        <ShieldAlert :size="16" class="icon-warn" />
        <span>Permission required</span>
        <span class="perm-name">{{ request.action }}</span>
      </div>
      <div v-if="request.resources?.length" class="patterns">
        <code v-for="resource in request.resources" :key="resource">{{ resource }}</code>
      </div>
      <div class="actions">
        <button class="primary" @click="replyPermission(request.sessionID, request.id, 'once')">Allow once</button>
        <button @click="replyPermission(request.sessionID, request.id, 'always')">Always allow</button>
        <button class="danger" @click="replyPermission(request.sessionID, request.id, 'reject')">Deny</button>
      </div>
    </div>

    <div v-for="form in pendingForms" :key="form.id" class="card question">
      <div class="card-head">
        <HelpCircle :size="16" class="icon-accent" />
        <span>{{ form.title || "Question" }}</span>
      </div>
      <div v-for="field in visibleFields(form)" :key="field.key" class="question-block">
        <p class="question-text">{{ field.title || field.key }}</p>
        <p v-if="field.description" class="question-desc">{{ field.description }}</p>

        <!-- The card carries what is *chosen*; anything free-form is answered by
             typing in the composer, so no question grows a second input area. -->
        <div v-if="choices(field).length" class="options" :class="{ row: field.type === 'boolean' }">
          <button
            v-for="option in choices(field)"
            :key="option.value"
            class="option"
            :class="{ picked: isPicked(form, field, option.value) }"
            @click="choose(form, field, option.value)"
          >
            <span class="option-mark"><Check v-if="isPicked(form, field, option.value)" :size="14" /></span>
            <span class="option-body">
              <span class="option-label">{{ option.label }}</span>
              <span v-if="option.description" class="option-desc">{{ option.description }}</span>
            </span>
          </button>
        </div>
      </div>

      <!-- A form that keeps its button: nothing on the card ends a multiple
           choice or a browser step, so those are sent by hand. -->
      <div v-if="needsSubmit(form)" class="actions">
        <button class="primary" @click="submit(form)">Submit</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.dock {
  display: flex;
  flex-direction: column;
  gap: 10px;
  max-width: var(--content-width);
  /* Inset like the composer, so a question reads as part of the conversation
     rather than as a second input area: one gutter each side, the width the
     message content itself occupies. */
  padding: 0 40px;
  margin: 6px auto 0;
  width: 100%;
}
@media (max-width: 900px) {
  .dock {
    padding: 0;
  }
}
.card {
  border: 1px solid var(--border);
  border-radius: var(--radius);
  background: var(--bg-elevated);
  padding: 12px 14px;
}
.permission {
  border-color: color-mix(in srgb, var(--accent) 45%, transparent);
}
.card-head {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13.5px;
  font-weight: 600;
  margin-bottom: 8px;
}
.icon-warn,
.icon-accent {
  color: var(--accent);
}
.perm-name {
  font-family: var(--font-mono);
  font-size: 12px;
  color: var(--text-muted);
  font-weight: 400;
}
.patterns {
  display: flex;
  flex-direction: column;
  gap: 4px;
  margin-bottom: 10px;
}
.patterns code {
  font-family: var(--font-mono);
  font-size: 12px;
  background: var(--code-bg);
  border: 1px solid var(--code-border);
  padding: 4px 7px;
  border-radius: var(--radius-sm);
  color: #d6deeb;
  overflow-wrap: anywhere;
}
.actions {
  display: flex;
  gap: 7px;
  flex-wrap: wrap;
}
.actions button {
  border: 1px solid var(--border);
  background: var(--bg);
  border-radius: var(--radius-sm);
  padding: 6px 12px;
  font-size: 13px;
}
.actions button:hover {
  background: var(--bg-hover);
}
.actions button.primary {
  background: var(--accent);
  border-color: var(--accent);
  color: var(--accent-text);
}
.actions button.primary:hover {
  background: var(--accent-hover);
}
.actions button.danger {
  color: var(--danger);
  border-color: color-mix(in srgb, var(--danger) 45%, transparent);
}
.question-block {
  margin-bottom: 12px;
}
.question-text {
  margin: 0 0 4px;
  font-size: 13.5px;
}
.question-desc {
  margin: 0 0 8px;
  font-size: 12px;
  color: var(--text-muted);
}
.options {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.options.row {
  flex-direction: row;
}
.option {
  display: flex;
  flex-direction: row;
  align-items: flex-start;
  gap: 9px;
  text-align: left;
  border: 1px solid var(--border);
  background: var(--bg);
  border-radius: var(--radius-sm);
  padding: 7px 11px;
  font-size: 13px;
}
.option:hover {
  background: var(--bg-hover);
}
.option.picked {
  border-color: var(--accent);
  background: color-mix(in srgb, var(--accent) 14%, transparent);
}
.option-mark {
  display: flex;
  width: 14px;
  flex: none;
  justify-content: center;
  margin-top: 2px;
  color: var(--accent);
}
.option-body {
  display: flex;
  flex-direction: column;
  gap: 1px;
}
.option-label {
  font-weight: 500;
}
.option-desc {
  font-size: 11.5px;
  color: var(--text-muted);
}
</style>
