<script setup lang="ts">
import { reactive } from "vue"
import { HelpCircle, ShieldAlert, X } from "lucide-vue-next"
import type { PermissionRequest, QuestionRequest } from "@/api/types"
import { useApp } from "@/stores/app"

const app = useApp()
const { pendingPermissions, pendingQuestions } = app.chat
const { replyPermission, replyQuestion, rejectQuestion } = app

const selections = reactive<Record<string, string[][]>>({})
const customs = reactive<Record<string, string>>({})

function selection(requestID: string, index: number): string[] {
  if (!selections[requestID]) selections[requestID] = []
  if (!selections[requestID][index]) selections[requestID][index] = []
  return selections[requestID][index]
}

function pick(request: QuestionRequest, index: number, label: string, multiple?: boolean) {
  const current = selection(request.id, index)
  if (multiple) {
    const pos = current.indexOf(label)
    if (pos === -1) current.push(label)
    else current.splice(pos, 1)
  } else {
    selections[request.id][index] = [label]
  }
}

function isPicked(request: QuestionRequest, index: number, label: string) {
  return selection(request.id, index).includes(label)
}

function submit(request: QuestionRequest) {
  const answers = request.questions.map((_, index) => {
    const picked = [...(selections[request.id]?.[index] ?? [])]
    const custom = customs[`${request.id}:${index}`]?.trim()
    if (custom) picked.push(custom)
    return picked
  })
  void replyQuestion(request.id, answers)
}
</script>

<template>
  <div v-if="pendingPermissions.length || pendingQuestions.length" class="dock">
    <div v-for="request in pendingPermissions" :key="request.id" class="card permission">
      <div class="card-head">
        <ShieldAlert :size="16" class="icon-warn" />
        <span>Permission required</span>
        <span class="perm-name">{{ request.permission }}</span>
      </div>
      <div v-if="request.patterns?.length" class="patterns">
        <code v-for="pattern in request.patterns" :key="pattern">{{ pattern }}</code>
      </div>
      <div class="actions">
        <button class="primary" @click="replyPermission(request.id, 'once')">Allow once</button>
        <button @click="replyPermission(request.id, 'always')">Always allow</button>
        <button class="danger" @click="replyPermission(request.id, 'reject')">Deny</button>
      </div>
    </div>

    <div v-for="request in pendingQuestions" :key="request.id" class="card question">
      <div class="card-head">
        <HelpCircle :size="16" class="icon-accent" />
        <span>{{ request.questions[0]?.header ?? "Question" }}</span>
        <button class="close" title="Reject" @click="rejectQuestion(request.id)"><X :size="15" /></button>
      </div>
      <div v-for="(question, index) in request.questions" :key="index" class="question-block">
        <p class="question-text">{{ question.question }}</p>
        <div class="options">
          <button
            v-for="option in question.options"
            :key="option.label"
            class="option"
            :class="{ picked: isPicked(request, index, option.label) }"
            @click="pick(request, index, option.label, question.multiple)"
          >
            <span class="option-label">{{ option.label }}</span>
            <span v-if="option.description" class="option-desc">{{ option.description }}</span>
          </button>
        </div>
        <input
          v-if="question.custom"
          v-model="customs[`${request.id}:${index}`]"
          class="custom"
          placeholder="Or type your own answer…"
          @keydown.enter.prevent="submit(request)"
        />
      </div>
      <div class="actions">
        <button class="primary" @click="submit(request)">Submit</button>
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
.icon-warn {
  color: var(--accent);
}
.icon-accent {
  color: var(--accent);
}
.perm-name {
  font-family: var(--font-mono);
  font-size: 12px;
  color: var(--text-muted);
  font-weight: 400;
}
.close {
  margin-left: auto;
  background: transparent;
  border: none;
  color: var(--text-muted);
  display: inline-flex;
  padding: 2px;
}
.close:hover {
  color: var(--text);
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
  margin: 0 0 8px;
  font-size: 13.5px;
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
.custom {
  margin-top: 8px;
  width: 100%;
  background: var(--bg-input);
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  padding: 7px 10px;
  outline: none;
}
.custom:focus {
  border-color: var(--accent);
}
</style>