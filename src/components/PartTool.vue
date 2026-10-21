<script setup lang="ts">
import { computed, ref } from "vue"
import { Check, ChevronRight, CircleAlert, Terminal } from "lucide-vue-next"
import type { ToolPart } from "@/api/types"
import { prettyJson, toolSummary } from "@/utils/format"
import Spinner from "./Spinner.vue"

const props = defineProps<{ part: ToolPart }>()
const open = ref(false)

const state = computed(() => props.part.state)
const summary = computed(() => toolSummary(props.part.tool, state.value.input))
const title = computed(() => ("title" in state.value && state.value.title) || summary.value || props.part.tool)
const inputText = computed(() => JSON.stringify(state.value.input ?? {}, null, 2))
const output = computed(() => {
  if (state.value.status === "completed") return state.value.output
  if (state.value.status === "error") return state.value.error
  return ""
})
const outputText = computed(() => prettyJson(output.value))
</script>

<template>
  <div class="tool" :class="state.status">
    <button class="head" @click="open = !open">
      <ChevronRight :size="14" class="chev" :class="{ open }" />
      <Terminal :size="14" class="tool-icon" />
      <span class="tool-name">{{ part.tool }}</span>
      <span class="tool-title">{{ title }}</span>
      <span class="status">
        <Spinner v-if="state.status === 'running' || state.status === 'pending'" :size="12" />
        <Check v-else-if="state.status === 'completed'" :size="14" class="ok" />
        <CircleAlert v-else :size="14" class="err" />
      </span>
    </button>
    <div v-show="open" class="body">
      <div class="section">
        <div class="label">Input</div>
        <pre>{{ inputText }}</pre>
      </div>
      <div v-if="output" class="section">
        <div class="label">Output</div>
        <pre>{{ outputText }}</pre>
      </div>
    </div>
  </div>
</template>

<style scoped>
.tool {
  margin: 8px 0;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  background: var(--bg-elevated);
  overflow: hidden;
}
.head {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  text-align: left;
  background: transparent;
  border: none;
  padding: 8px 12px;
  font-size: 12.5px;
  color: var(--text-muted);
}
.head:hover {
  background: var(--bg-hover);
}
.chev {
  transition: transform 0.15s;
  flex: none;
}
.chev.open {
  transform: rotate(90deg);
}
.tool-icon {
  flex: none;
}
.tool-name {
  font-family: var(--font-mono);
  color: var(--text);
  flex: none;
}
.tool-title {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-family: var(--font-mono);
  color: var(--text-faint);
}
.status {
  flex: none;
  display: inline-flex;
}
.ok {
  color: #4ade80;
}
.err {
  color: var(--danger);
}
.body {
  border-top: 1px solid var(--border);
  padding: 8px 12px 10px;
}
.section + .section {
  margin-top: 8px;
}
.label {
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--text-faint);
  margin-bottom: 4px;
}
pre {
  margin: 0;
  padding: 10px;
  background: var(--code-bg);
  border: 1px solid var(--code-border);
  border-radius: var(--radius-sm);
  font-family: var(--font-mono);
  font-size: 12px;
  line-height: 1.5;
  overflow: auto;
  max-height: 320px;
  color: #d6deeb;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
</style>