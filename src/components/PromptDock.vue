<script setup lang="ts">
import { reactive } from "vue"
import { HelpCircle, ShieldAlert } from "lucide-vue-next"
import type { FormDetail, FormField } from "@/api/types"
import { useApp } from "@/stores/app"

const app = useApp()
const { pendingPermissions, pendingForms } = app.chat
const { replyPermission, replyForm } = app

/** Form answers, keyed `${formID}:${fieldKey}` then normalised on submit. */
const answers = reactive<Record<string, unknown>>({})

function fieldValue(formID: string, field: FormField): unknown {
  const key = `${formID}:${field.key}`
  if (key in answers) return answers[key]
  return field.default ?? (field.type === "multiselect" ? [] : field.type === "boolean" ? false : "")
}

function setField(formID: string, field: FormField, value: unknown) {
  answers[`${formID}:${field.key}`] = value
}

function toggleMulti(formID: string, field: FormField, value: string) {
  const key = `${formID}:${field.key}`
  const current = Array.isArray(answers[key]) ? (answers[key] as string[]) : []
  const pos = current.indexOf(value)
  answers[key] = pos === -1 ? [...current, value] : current.filter((item) => item !== value)
}

function multiplePicked(formID: string, field: FormField, value: string): boolean {
  const current = answers[`${formID}:${field.key}`]
  return Array.isArray(current) && (current as string[]).includes(value)
}

function visibleFields(form: FormDetail): FormField[] {
  return form.fields.filter((field) => !field.hidden)
}

function submit(form: FormDetail) {
  const answer: Record<string, unknown> = {}
  for (const field of visibleFields(form)) {
    const value = fieldValue(form.id, field)
    if (field.type === "multiselect") {
      answer[field.key] = Array.isArray(value) ? value : []
    } else if (field.type === "boolean") {
      answer[field.key] = value === true
    } else if (field.type === "number" || field.type === "integer") {
      answer[field.key] = typeof value === "string" ? Number(value) : value
    } else {
      answer[field.key] = value
    }
  }
  void replyForm(form.sessionID, form.id, answer)
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

        <select
          v-if="field.options?.length && field.type !== 'multiselect'"
          class="input"
          :value="fieldValue(form.id, field)"
          @change="setField(form.id, field, ($event.target as HTMLSelectElement).value)"
        >
          <option value="" disabled>Choose…</option>
          <option v-for="option in field.options" :key="option.value" :value="option.value">{{ option.label }}</option>
        </select>

        <div v-else-if="field.type === 'multiselect'" class="options">
          <button
            v-for="option in field.options"
            :key="option.value"
            class="option"
            :class="{ picked: multiplePicked(form.id, field, option.value) }"
            @click="toggleMulti(form.id, field, option.value)"
          >
            <span class="option-label">{{ option.label }}</span>
            <span v-if="option.description" class="option-desc">{{ option.description }}</span>
          </button>
        </div>

        <label v-else-if="field.type === 'boolean'" class="checkbox">
          <input
            type="checkbox"
            :checked="fieldValue(form.id, field) === true"
            @change="setField(form.id, field, ($event.target as HTMLInputElement).checked)"
          />
          <span>{{ field.title || field.key }}</span>
        </label>

        <input
          v-else-if="field.type === 'number' || field.type === 'integer'"
          class="input"
          type="number"
          :value="fieldValue(form.id, field)"
          @input="setField(form.id, field, ($event.target as HTMLInputElement).value)"
        />

        <input
          v-else
          class="input"
          :value="fieldValue(form.id, field)"
          placeholder="Type your answer…"
          @input="setField(form.id, field, ($event.target as HTMLInputElement).value)"
          @keydown.enter.prevent="submit(form)"
        />
      </div>
      <div class="actions">
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
  margin: 0 auto 10px;
  width: 100%;
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
.option {
  display: flex;
  flex-direction: column;
  gap: 1px;
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
.option-label {
  font-weight: 500;
}
.option-desc {
  font-size: 11.5px;
  color: var(--text-muted);
}
.checkbox {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13.5px;
}
.input {
  width: 100%;
  background: var(--bg-input);
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  padding: 7px 10px;
  outline: none;
  color: var(--text);
}
.input:focus {
  border-color: var(--accent);
}
</style>
