<script setup lang="ts">
import { computed, nextTick, ref, watch } from "vue"
import {
  ComboboxAnchor,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxItemIndicator,
  ComboboxPortal,
  ComboboxRoot,
  ComboboxTrigger,
  ComboboxViewport,
} from "reka-ui"
import { Bot, Check, ChevronDown } from "lucide-vue-next"
import { useServer } from "@/stores/server"
import { openRequests, shortcutsVisible } from "@/stores/shortcuts"

const { modes, selectedAgent, setAgent } = useServer()

const open = ref(false)
const query = ref("")
const inputRef = ref<unknown>(null)

const selectedKey = computed<string>({
  get: () => selectedAgent.value,
  set: (value) => {
    if (!value || value === selectedAgent.value) return
    setAgent(value)
    open.value = false
  },
})

function displayValue(name: string) {
  const agent = modes.value.find((item) => item.name === name)
  return agent?.displayName ?? name
}

const filtered = computed(() => {
  const q = query.value.trim().toLowerCase()
  if (!q) return modes.value
  return modes.value.filter(
    (agent) =>
      agent.name.toLowerCase().includes(q) ||
      (agent.displayName ?? "").toLowerCase().includes(q) ||
      (agent.description ?? "").toLowerCase().includes(q),
  )
})

function inputNode(): HTMLInputElement | null {
  const value = inputRef.value as { $el?: unknown } | HTMLInputElement | null
  return ((value && "$el" in value ? value.$el : value) ?? null) as HTMLInputElement | null
}

function onInput(event: Event) {
  query.value = (event.target as HTMLInputElement).value
}

function selectDisplayValue() {
  if (query.value) return
  requestAnimationFrame(() => inputNode()?.select())
}

watch(open, async (value) => {
  if (value) {
    await nextTick()
    const node = inputNode()
    node?.focus()
    if (!query.value) node?.select()
  } else {
    query.value = ""
  }
})

// Opened by the Alt+A shortcut.
watch(
  () => openRequests.agent,
  () => {
    open.value = true
  },
)
</script>

<template>
  <ComboboxRoot
    v-model="selectedKey"
    v-model:open="open"
    :ignore-filter="true"
    :open-on-click="true"
    :open-on-focus="true"
    class="kilo-agent-root"
  >
    <ComboboxAnchor class="kilo-agent-anchor" title="Mode (Alt+A)">
      <Bot :size="14" class="kilo-agent-icon" />
      <ComboboxInput
        ref="inputRef"
        class="kilo-agent-input"
        :display-value="displayValue"
        placeholder="Select mode…"
        spellcheck="false"
        @input="onInput"
        @focus="selectDisplayValue"
        @click="selectDisplayValue"
      />
      <ComboboxTrigger class="kilo-agent-chevron" aria-label="Select mode (Alt+A)">
        <ChevronDown :size="14" />
      </ComboboxTrigger>
      <kbd v-if="shortcutsVisible" class="kbd floating">A</kbd>
    </ComboboxAnchor>

    <ComboboxPortal>
      <ComboboxContent class="kilo-menu kilo-agent-menu" position="popper" side="top" :side-offset="8" align="start">
        <ComboboxViewport class="kilo-agent-scroll">
          <ComboboxEmpty class="kilo-agent-empty">
            {{ query ? `No modes match “${query}”.` : "No modes." }}
          </ComboboxEmpty>
          <ComboboxItem
            v-for="agent in filtered"
            :key="agent.name"
            :value="agent.name"
            :text-value="agent.displayName ?? agent.name"
            class="kilo-agent-option"
            :class="{ 'is-active': agent.name === selectedAgent }"
          >
            <span class="kilo-agent-name">{{ agent.displayName ?? agent.name }}</span>
            <span v-if="agent.description" class="kilo-agent-desc">{{ agent.description }}</span>
            <ComboboxItemIndicator class="kilo-agent-check"><Check :size="15" /></ComboboxItemIndicator>
          </ComboboxItem>
        </ComboboxViewport>
      </ComboboxContent>
    </ComboboxPortal>
  </ComboboxRoot>
</template>

<!-- Unscoped: Reka's teleported content does not receive scoped-style attributes. -->
<style>
.kilo-agent-anchor {
  position: relative;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 32px;
  padding: 0 8px 0 10px;
  border-radius: 999px;
  border: 1px solid var(--border);
  background: var(--bg-elevated);
  color: var(--text);
  transition: border-color 0.12s, background 0.12s;
}
.kilo-agent-anchor:hover {
  background: var(--bg-hover);
}
.kilo-agent-anchor:focus-within {
  border-color: var(--accent);
}
.kilo-agent-icon {
  color: var(--accent);
  flex: none;
}
.kilo-agent-input {
  width: 90px;
  border: none;
  outline: none;
  background: transparent;
  color: var(--text);
  font-size: 13px;
  text-overflow: ellipsis;
}
.kilo-agent-input::placeholder {
  color: var(--text-muted);
}
.kilo-agent-chevron {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  color: var(--text-muted);
  background: transparent;
  border: none;
  padding: 2px;
  flex: none;
}
.kilo-agent-chevron:hover {
  color: var(--text);
}
.kilo-agent-menu {
  width: 560px;
  max-width: calc(100vw - 32px);
  display: flex;
  flex-direction: column;
  padding: 0;
  overflow: hidden;
}
.kilo-agent-scroll {
  max-height: min(72vh, 600px);
  overflow: auto;
  padding: 6px;
}
.kilo-agent-option {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 18px;
  align-items: center;
  column-gap: 8px;
  padding: 11px 12px;
  border-radius: var(--radius-sm);
  cursor: pointer;
  outline: none;
  user-select: none;
}
.kilo-agent-option[data-highlighted] {
  background: var(--bg-hover);
}
.kilo-agent-option.is-active {
  background: color-mix(in srgb, var(--accent) 14%, transparent);
}
.kilo-agent-name {
  grid-column: 1;
  font-size: 13.5px;
  font-weight: 500;
  color: var(--text);
  text-transform: capitalize;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.kilo-agent-desc {
  grid-column: 1;
  font-size: 11px;
  line-height: 1.4;
  color: var(--text-muted);
  white-space: normal;
  overflow-wrap: anywhere;
}
.kilo-agent-check {
  grid-column: 2;
  grid-row: 1 / span 2;
  justify-self: center;
  color: var(--accent);
  display: inline-flex;
}
.kilo-agent-empty {
  text-align: center;
  color: var(--text-muted);
  font-size: 13px;
  padding: 24px;
}
</style>