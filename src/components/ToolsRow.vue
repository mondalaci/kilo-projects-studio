<script setup lang="ts">
import { computed, ref, watch } from "vue"
import { ChevronRight } from "lucide-vue-next"
import { useServer } from "@/stores/server"
import { useTools } from "@/stores/tools"
import { openRequests, shortcutsVisible } from "@/stores/shortcuts"
import { toolState, type ToolState } from "@/utils/tools"

const TOOLS_DOCS_URL = "https://kilo.ai/docs/automate/tools"

const { toolIds, selectedAgentInfo, selectedAgent } = useServer()
const { overrides, setOverride, reset } = useTools()

const TOOLS_EXPANDED_KEY = "kilo-projects-studio.tools-expanded"

const expanded = ref(localStorage.getItem(TOOLS_EXPANDED_KEY) === "true")

watch(expanded, (value) => {
  try {
    localStorage.setItem(TOOLS_EXPANDED_KEY, String(value))
  } catch {
    /* storage unavailable */
  }
})

// Overrides are per-agent; clear them when the mode changes.
watch(selectedAgent, () => reset())

// Alt+T toggles the tools list.
watch(
  () => openRequests.tools,
  () => {
    expanded.value = !expanded.value
  },
)

const tools = computed(() => [...toolIds.value].sort((a, b) => a.localeCompare(b)))
const enabledCount = computed(() => tools.value.filter((id) => displayState(id) !== "disabled").length)

function displayState(id: string): ToolState {
  const override = overrides.value[id]
  if (override === false) return "disabled"
  if (override === true) return "enabled"
  return toolState(id, selectedAgentInfo.value?.permission)
}

function onToggle(id: string) {
  setOverride(id, displayState(id) === "disabled")
}
</script>

<template>
  <div v-if="tools.length" class="tools-row">
    <button type="button" class="tools-head" @click="expanded = !expanded">
      <ChevronRight :size="13" class="tools-chev" :class="{ open: expanded }" />
      <span class="tools-label">Tools</span>
      <span class="tools-count">{{ enabledCount }}/{{ tools.length }}</span>
      <kbd v-if="shortcutsVisible" class="kbd floating">T</kbd>
    </button>
    <div class="tools-collapse" :class="{ open: expanded }">
      <div class="tools-collapse-inner">
        <div class="tools-chips">
          <button
            v-for="id in tools"
            :key="id"
            type="button"
            class="tool-chip"
            :class="displayState(id)"
            @click="onToggle(id)"
          >
            {{ id }}
          </button>
          <a
            class="tools-help"
            :href="TOOLS_DOCS_URL"
            target="_blank"
            rel="noreferrer"
            title="Tool documentation"
            aria-label="Tool documentation"
          >
            ?
          </a>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.tools-row {
  flex: none;
  border-top: 1px solid var(--border);
  padding: 8px 10px;
}
.tools-head {
  position: relative;
  display: flex;
  align-items: center;
  gap: 6px;
  width: 100%;
  background: transparent;
  border: none;
  padding: 0;
  color: var(--text-faint);
}
.tools-head:hover {
  color: var(--text-muted);
}
.tools-chev {
  transition: transform 0.15s;
  flex: none;
}
.tools-chev.open {
  transform: rotate(90deg);
}
.tools-label {
  font-size: 10.5px;
  text-transform: uppercase;
  letter-spacing: 0.04em;
}
.tools-count {
  margin-left: auto;
  font-size: 10.5px;
  font-variant-numeric: tabular-nums;
}
.tools-collapse {
  display: grid;
  grid-template-rows: 0fr;
  transition: grid-template-rows 0.2s ease;
}
.tools-collapse.open {
  grid-template-rows: 1fr;
}
.tools-collapse-inner {
  overflow: hidden;
}
.tools-chips {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 4px;
  padding-top: 8px;
}
.tool-chip {
  font-family: var(--font-mono);
  font-size: 10px;
  line-height: 1;
  padding: 3px 6px;
  border-radius: 999px;
  border: 1px solid var(--border);
  background: var(--bg-elevated);
  color: var(--text-muted);
  cursor: pointer;
}
.tool-chip:hover {
  border-color: var(--border-strong);
  color: var(--text);
}
.tool-chip.enabled {
  border-color: color-mix(in srgb, #4ade80 55%, transparent);
  color: var(--text);
}
.tool-chip.ask {
  border-color: color-mix(in srgb, var(--accent) 55%, transparent);
  color: var(--accent);
}
/* Inactive tools stay legible: muted but full-opacity text, dashed border. */
.tool-chip.disabled {
  border-style: dashed;
  color: var(--text-muted);
  opacity: 0.9;
}
.tools-help {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 18px;
  height: 18px;
  border-radius: 50%;
  border: 1px solid var(--border);
  background: var(--bg-elevated);
  color: var(--text-muted);
  font-size: 11px;
  font-weight: 600;
  text-decoration: none;
}
.tools-help:hover {
  border-color: var(--accent);
  color: var(--accent);
}
</style>