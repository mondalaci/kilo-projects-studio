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
import { Check, ChevronDown, Gauge } from "lucide-vue-next"
import { useServer } from "@/stores/server"
import { openRequests, shortcutsVisible } from "@/stores/shortcuts"

const { selectedModelVariants, selectedVariant, setVariant } = useServer()

const open = ref(false)
const query = ref("")
const inputRef = ref<unknown>(null)

function label(name: string) {
  return name ? name.charAt(0).toUpperCase() + name.slice(1) : "Default"
}

const selectedKey = computed<string>({
  get: () => selectedVariant.value ?? "",
  set: (value) => {
    if (!value) return
    setVariant(value)
    open.value = false
  },
})

function displayValue(value: string) {
  return value ? label(value) : ""
}

const filtered = computed(() => {
  const q = query.value.trim().toLowerCase()
  if (!q) return selectedModelVariants.value
  return selectedModelVariants.value.filter((name) => name.toLowerCase().includes(q))
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

// Opened by the Alt+E shortcut.
watch(
  () => openRequests.effort,
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
    class="kilo-variant-root"
  >
    <ComboboxAnchor class="kilo-variant-anchor" title="Reasoning effort / variant (Alt+E)">
      <Gauge :size="14" class="kilo-variant-icon" />
      <ComboboxInput
        ref="inputRef"
        class="kilo-variant-input"
        :display-value="displayValue"
        placeholder="Default"
        spellcheck="false"
        @input="onInput"
        @focus="selectDisplayValue"
        @click="selectDisplayValue"
      />
      <ComboboxTrigger class="kilo-variant-chevron" aria-label="Select variant (Alt+E)">
        <ChevronDown :size="14" />
      </ComboboxTrigger>
      <kbd v-if="shortcutsVisible" class="kbd floating">E</kbd>
    </ComboboxAnchor>

    <ComboboxPortal>
      <ComboboxContent class="kilo-menu kilo-variant-menu" position="popper" side="top" :side-offset="8" align="start">
        <ComboboxViewport class="kilo-variant-scroll">
          <ComboboxEmpty class="kilo-variant-empty">No variants.</ComboboxEmpty>
          <ComboboxItem
            v-for="name in filtered"
            :key="name"
            :value="name"
            :text-value="label(name)"
            class="kilo-variant-option"
            :class="{ 'is-active': name === selectedVariant }"
          >
            <span class="kilo-variant-name">{{ label(name) }}</span>
            <ComboboxItemIndicator class="kilo-variant-check"><Check :size="15" /></ComboboxItemIndicator>
          </ComboboxItem>
        </ComboboxViewport>
      </ComboboxContent>
    </ComboboxPortal>
  </ComboboxRoot>
</template>

<!-- Unscoped: Reka's teleported content does not receive scoped-style attributes. -->
<style>
.kilo-variant-anchor {
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
.kilo-variant-anchor:hover {
  background: var(--bg-hover);
}
.kilo-variant-anchor:focus-within {
  border-color: var(--accent);
}
.kilo-variant-icon {
  color: var(--accent);
  flex: none;
}
.kilo-variant-input {
  width: auto;
  min-width: 56px;
  max-width: 140px;
  field-sizing: content;
  border: none;
  outline: none;
  background: transparent;
  color: var(--text);
  font-size: 13px;
  text-overflow: ellipsis;
}
.kilo-variant-input::placeholder {
  color: var(--text-muted);
}
.kilo-variant-chevron {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  color: var(--text-muted);
  background: transparent;
  border: none;
  padding: 2px;
  flex: none;
}
.kilo-variant-chevron:hover {
  color: var(--text);
}
.kilo-variant-menu {
  width: 200px;
  display: flex;
  flex-direction: column;
  padding: 0;
  overflow: hidden;
}
.kilo-variant-scroll {
  max-height: min(50vh, 320px);
  overflow: auto;
  padding: 6px;
}
.kilo-variant-option {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 18px;
  align-items: center;
  column-gap: 8px;
  padding: 8px 10px;
  border-radius: var(--radius-sm);
  cursor: pointer;
  outline: none;
  user-select: none;
}
.kilo-variant-option[data-highlighted] {
  background: var(--bg-hover);
}
.kilo-variant-option.is-active {
  background: color-mix(in srgb, var(--accent) 14%, transparent);
}
.kilo-variant-name {
  grid-column: 1;
  font-size: 13.5px;
  color: var(--text);
  text-transform: capitalize;
}
.kilo-variant-check {
  grid-column: 2;
  justify-self: center;
  color: var(--accent);
  display: inline-flex;
}
.kilo-variant-empty {
  text-align: center;
  color: var(--text-muted);
  font-size: 13px;
  padding: 24px;
}
</style>