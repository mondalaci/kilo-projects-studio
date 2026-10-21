<script setup lang="ts">
import { computed, nextTick, ref, watch } from "vue"
import {
  ComboboxAnchor,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxGroup,
  ComboboxInput,
  ComboboxItem,
  ComboboxItemIndicator,
  ComboboxLabel,
  ComboboxPortal,
  ComboboxRoot,
  ComboboxTrigger,
  ComboboxViewport,
  ScrollAreaCorner,
  ScrollAreaRoot,
  ScrollAreaScrollbar,
  ScrollAreaThumb,
  ScrollAreaViewport,
} from "reka-ui"
import { Brain, Check, ChevronDown, Search } from "lucide-vue-next"
import type { Model } from "@/api/types"
import { useServer } from "@/stores/server"
import { openRequests, shortcutsVisible } from "@/stores/shortcuts"

const { providerGroups, providers, selectedModel, setModel } = useServer()

const open = ref(false)
const query = ref("")
const showAll = ref(false)
const inputRef = ref<unknown>(null)

const SEP = "::"
function modelKey(providerID: string, modelID: string) {
  return `${providerID}${SEP}${modelID}`
}
function parseKey(key: string) {
  const index = key.indexOf(SEP)
  if (index === -1) return null
  return { providerID: key.slice(0, index), modelID: key.slice(index + SEP.length) }
}

const selectedKey = computed<string>({
  get: () => (selectedModel.value ? modelKey(selectedModel.value.providerID, selectedModel.value.modelID) : ""),
  set: (key) => {
    const parsed = parseKey(key)
    if (!parsed) return
    setModel({ providerID: parsed.providerID, modelID: parsed.modelID })
    open.value = false
  },
})

function displayValue(key: string) {
  const parsed = parseKey(key)
  if (!parsed) return ""
  const provider = providers.value.find((item) => item.id === parsed.providerID)
  return provider?.models?.[parsed.modelID]?.name ?? parsed.modelID
}

// The combobox input is uncontrolled: its displayed text is either the selected
// model name (via `displayValue`) or the user's typed search term. We only track
// the typed term separately for our own filtering.
function onInput(event: Event) {
  query.value = (event.target as HTMLInputElement).value
}

function inputNode(): HTMLInputElement | null {
  const value = inputRef.value as { $el?: unknown } | HTMLInputElement | null
  return ((value && "$el" in value ? value.$el : value) ?? null) as HTMLInputElement | null
}

/**
 * When the input still shows the selected model name (no search term typed
 * yet), selecting it makes the first keystroke replace the name instead of
 * being inserted at the caret. Once the user is searching, editing stays normal.
 */
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

// Opened by the Alt+M shortcut.
watch(
  () => openRequests.model,
  () => {
    open.value = true
  },
)

// Keep the (uncontrolled) input showing the friendly model name. This matters
// on first load, when the input renders its raw id before providers arrive.
watch([providers, selectedModel], () => {
  if (open.value || query.value) return
  const node = inputNode()
  const name = displayValue(selectedKey.value)
  if (node && node.value !== name) node.value = name
})

const filteredGroups = computed(() => {
  const q = query.value.trim().toLowerCase()
  return providerGroups.value
    .filter((group) => (q ? true : showAll.value || group.connected))
    .map((group) => ({
      ...group,
      models: group.models.filter((model) => {
        if (!q) return true
        return (
          model.name.toLowerCase().includes(q) ||
          model.id.toLowerCase().includes(q) ||
          group.providerName.toLowerCase().includes(q)
        )
      }),
    }))
    .filter((group) => group.models.length > 0)
})

/** Bound the number of rendered options so huge provider lists stay fast. */
const BROWSE_PER_GROUP = 60
const SEARCH_LIMIT = 150
const visibleGroups = computed(() => {
  if (!query.value.trim()) {
    return filteredGroups.value.map((group) => ({ ...group, models: group.models.slice(0, BROWSE_PER_GROUP) }))
  }
  let remaining = SEARCH_LIMIT
  const out: typeof filteredGroups.value = []
  for (const group of filteredGroups.value) {
    if (remaining <= 0) break
    const models = group.models.slice(0, remaining)
    remaining -= models.length
    out.push({ ...group, models })
  }
  return out
})

const totalMatches = computed(() => filteredGroups.value.reduce((total, group) => total + group.models.length, 0))
const resultCount = computed(() => visibleGroups.value.reduce((total, group) => total + group.models.length, 0))

function isSelected(model: Model) {
  return selectedModel.value?.providerID === model.providerID && selectedModel.value?.modelID === model.id
}

/** Compact USD-per-1M-token price: `$3/$15`. */
function price(value: number) {
  if (!value) return "0"
  if (value >= 1) return value.toFixed(2).replace(/\.00$/, "")
  return value.toFixed(3).replace(/0+$/, "").replace(/\.$/, "")
}
function costLabel(model: Model) {
  if (model.isFree) return "free"
  const cost = model.cost
  if (!cost || (!cost.input && !cost.output)) return ""
  return `$${price(cost.input)}/$${price(cost.output)}`
}
function costTitle(model: Model) {
  if (model.isFree) return "Free"
  const cost = model.cost
  if (!cost) return ""
  return `Input $${cost.input} / 1M tokens · Output $${cost.output} / 1M tokens`
}

/**
 * Colour the price by value on a log scale so cheaper models trend green and
 * expensive ones trend red. Uses the higher of input/output cost.
 */
function costColor(model: Model): string | undefined {
  const free = "hsl(142 60% 45%)"
  if (model.isFree) return free
  const cost = model.cost
  if (!cost) return undefined
  const value = Math.max(cost.input || 0, cost.output || 0)
  if (value <= 0) return free
  const min = Math.log10(0.05)
  const max = Math.log10(60)
  const t = Math.min(1, Math.max(0, (Math.log10(value) - min) / (max - min)))
  const hue = 142 - 142 * t
  return `hsl(${Math.round(hue)} 70% 48%)`
}
</script>

<template>
  <ComboboxRoot
    v-model="selectedKey"
    v-model:open="open"
    :ignore-filter="true"
    :open-on-click="true"
    :open-on-focus="true"
    class="kilo-model-root"
  >
    <ComboboxAnchor class="kilo-model-anchor">
      <Brain :size="14" class="kilo-model-anchor-icon" />
      <ComboboxInput
        ref="inputRef"
        class="kilo-model-input"
        :display-value="displayValue"
        placeholder="Search models…"
        spellcheck="false"
        @input="onInput"
        @focus="selectDisplayValue"
        @click="selectDisplayValue"
      />
      <ComboboxTrigger class="kilo-model-chevron" aria-label="Toggle models (Alt+M)">
        <ChevronDown :size="14" />
      </ComboboxTrigger>
      <kbd v-if="shortcutsVisible" class="kbd floating">M</kbd>
    </ComboboxAnchor>

    <ComboboxPortal>
      <ComboboxContent class="kilo-menu kilo-model-menu" position="popper" side="top" :side-offset="8" align="start">
        <div class="kilo-model-head">
          <Search :size="13" />
          <span>Type to search all providers</span>
          <label class="kilo-model-show-all">
            <input v-model="showAll" type="checkbox" />
            All
          </label>
        </div>
        <ComboboxViewport class="kilo-model-viewport">
          <ScrollAreaRoot class="kilo-model-scroll-root" type="auto">
            <ScrollAreaViewport class="kilo-model-scroll">
              <ComboboxGroup v-for="group in visibleGroups" :key="group.providerID" class="kilo-model-group">
                <ComboboxLabel class="kilo-model-group-head">
                  <span>{{ group.providerName }}</span>
                  <span v-if="group.connected" class="kilo-model-dot" title="Connected"></span>
                </ComboboxLabel>
                <ComboboxItem
                  v-for="model in group.models"
                  :key="modelKey(group.providerID, model.id)"
                  :value="modelKey(group.providerID, model.id)"
                  :text-value="model.name"
                  class="kilo-model-option"
                  :class="{ 'is-active': isSelected(model) }"
                >
                  <span class="kilo-model-name">{{ model.name }}</span>
                  <span
                    v-if="costLabel(model)"
                    class="kilo-model-cost"
                    :style="{ color: costColor(model) }"
                    :title="costTitle(model)"
                    >{{ costLabel(model) }}</span
                  >
                  <span class="kilo-model-badges">
                    <span v-if="model.capabilities?.reasoning" class="kilo-model-tag is-reasoning">reasoning</span>
                  </span>
                  <ComboboxItemIndicator class="kilo-model-check"><Check :size="15" /></ComboboxItemIndicator>
                </ComboboxItem>
              </ComboboxGroup>
              <ComboboxEmpty class="kilo-model-empty">
                {{ query ? `No models match “${query}”.` : "No models available." }}
              </ComboboxEmpty>
              <p v-if="!query && !showAll && resultCount" class="kilo-model-hint">Showing connected providers only</p>
              <p v-else-if="totalMatches > resultCount" class="kilo-model-hint">
                Showing {{ resultCount }} of {{ totalMatches }} matches · refine your search
              </p>
            </ScrollAreaViewport>
            <ScrollAreaScrollbar class="kilo-model-scrollbar" orientation="vertical">
              <ScrollAreaThumb class="kilo-model-thumb" />
            </ScrollAreaScrollbar>
            <ScrollAreaCorner class="kilo-model-scrollbar-corner" />
          </ScrollAreaRoot>
        </ComboboxViewport>
      </ComboboxContent>
    </ComboboxPortal>
  </ComboboxRoot>
</template>

<!-- Unscoped: Reka's teleported content does not receive scoped-style attributes. -->
<style>
.kilo-model-anchor {
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
.kilo-model-anchor:hover {
  background: var(--bg-hover);
}
.kilo-model-anchor:focus-within {
  border-color: var(--accent);
}
.kilo-model-anchor-icon {
  color: var(--accent);
  flex: none;
}
.kilo-model-input {
  width: auto;
  min-width: 96px;
  max-width: 360px;
  field-sizing: content;
  border: none;
  outline: none;
  background: transparent;
  color: var(--text);
  font-size: 13px;
  text-overflow: ellipsis;
}
.kilo-model-input::placeholder {
  color: var(--text-muted);
}
.kilo-model-chevron {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  color: var(--text-muted);
  background: transparent;
  border: none;
  padding: 2px;
  flex: none;
}
.kilo-model-chevron:hover {
  color: var(--text);
}
.kilo-model-menu {
  width: 460px;
  display: flex;
  flex-direction: column;
  padding: 0;
  overflow: hidden;
}
.kilo-model-head {
  display: flex;
  align-items: center;
  gap: 7px;
  padding: 8px 12px;
  border-bottom: 1px solid var(--border);
  color: var(--text-faint);
  font-size: 11.5px;
  flex: none;
}
.kilo-model-head > span {
  flex: 1;
}
.kilo-model-show-all {
  display: flex;
  align-items: center;
  gap: 5px;
  font-size: 12px;
  color: var(--text-muted);
  white-space: nowrap;
  cursor: pointer;
}
.kilo-model-viewport {
  overflow: visible !important;
  flex: none !important;
  min-height: 0;
}
.kilo-model-scroll-root {
  position: relative;
  max-height: min(62vh, 520px);
}
.kilo-model-scroll {
  max-height: min(62vh, 520px);
  overflow-x: hidden !important;
  /* Keep keyboard-highlighted rows clear of the sticky group header. */
  scroll-padding-top: 34px;
  padding-right: 12px;
}
.kilo-model-scrollbar {
  display: flex;
  width: 10px;
  padding: 2px;
  user-select: none;
  touch-action: none;
  background: var(--bg-elevated);
}
.kilo-model-thumb {
  flex: 1;
  position: relative;
  border-radius: 6px;
  background: var(--text-muted);
}
.kilo-model-thumb:hover {
  background: var(--text);
}
.kilo-model-scrollbar-corner {
  background: var(--bg-elevated);
}
.kilo-model-group {
  padding-bottom: 4px;
}
.kilo-model-group-head {
  display: flex;
  align-items: center;
  gap: 7px;
  padding: 8px 12px 5px;
  font-size: 11.5px;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--text-faint);
  position: sticky;
  top: 0;
  background: var(--bg-elevated);
  z-index: 1;
}
.kilo-model-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: #4ade80;
}
.kilo-model-option {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 78px 88px 18px;
  align-items: center;
  column-gap: 8px;
  margin: 0 6px;
  padding: 8px 10px;
  border-radius: var(--radius-sm);
  font-size: 13.5px;
  color: var(--text);
  cursor: pointer;
  outline: none;
  user-select: none;
}
.kilo-model-option[data-highlighted] {
  background: var(--bg-hover);
}
.kilo-model-option.is-active {
  background: color-mix(in srgb, var(--accent) 14%, transparent);
}
.kilo-model-name {
  grid-column: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.kilo-model-cost {
  grid-column: 2;
  justify-self: end;
  font-size: 10px;
  color: var(--text-faint);
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}
.kilo-model-badges {
  grid-column: 3;
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 6px;
}
.kilo-model-check {
  grid-column: 4;
  justify-self: center;
  color: var(--accent);
  display: inline-flex;
}
.kilo-model-tag {
  font-size: 10.5px;
  padding: 1px 6px;
  border-radius: 999px;
  border: 1px solid var(--border);
  color: var(--text-muted);
  flex: none;
}
.kilo-model-tag.is-reasoning {
  color: var(--accent);
  border-color: color-mix(in srgb, var(--accent) 40%, transparent);
}
.kilo-model-empty {
  text-align: center;
  color: var(--text-muted);
  font-size: 13px;
  padding: 24px;
}
.kilo-model-hint {
  text-align: center;
  color: var(--text-faint);
  font-size: 11.5px;
  margin: 4px 0 2px;
}
</style>