<script setup lang="ts">
import { computed } from "vue"
import { SLASH_MENU_ROWS, type SlashCommand } from "@/utils/slash"

const props = defineProps<{
  /** The rows left after filtering, best first. */
  items: SlashCommand[]
  /** Index of the highlighted row, into `items`. */
  selected: number
}>()

const emit = defineEmits<{
  /** A row was clicked; the keyboard goes through the composer instead. */
  (event: "pick", index: number): void
}>()

/**
 * The slice of rows on screen.
 *
 * The list is capped the way the TUI caps its own, and the window follows the
 * highlight rather than resetting, so walking past the bottom row scrolls one
 * row at a time instead of jumping a page.
 */
const offset = computed(() => {
  const rows = SLASH_MENU_ROWS
  if (props.items.length <= rows) return 0
  const start = props.selected - Math.floor(rows / 2)
  return Math.max(0, Math.min(start, props.items.length - rows))
})

const visible = computed(() => props.items.slice(offset.value, offset.value + SLASH_MENU_ROWS))

const isActive = (index: number) => offset.value + index === props.selected
</script>

<template>
  <div class="slash-menu">
    <ul v-if="visible.length" class="rows">
      <li
        v-for="(item, index) in visible"
        :key="item.display"
        class="row"
        :class="{ active: isActive(index) }"
        :aria-selected="isActive(index)"
        role="option"
        @mousedown.prevent="emit('pick', offset + index)"
      >
        <span class="name">{{ item.display }}</span>
        <span v-if="item.description" class="description">{{ item.description }}</span>
      </li>
    </ul>
    <p v-else class="empty">No matching commands</p>
  </div>
</template>

<style scoped>
.slash-menu {
  position: absolute;
  left: 0;
  right: 0;
  bottom: 100%;
  margin-bottom: 6px;
  max-height: 240px;
  overflow: hidden;
  background: var(--bg-elevated);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  box-shadow: var(--shadow);
  z-index: 60;
}
.rows {
  list-style: none;
  margin: 0;
  padding: 4px;
}
.row {
  display: grid;
  /* The name keeps its own column so the descriptions line up, which is what
     the TUI does by padding each name to the longest one. */
  grid-template-columns: minmax(0, max-content) minmax(0, 1fr);
  align-items: baseline;
  gap: 10px;
  padding: 5px 8px;
  border-radius: var(--radius-sm);
  cursor: pointer;
  user-select: none;
}
.row.active {
  background: color-mix(in srgb, var(--accent) 14%, transparent);
}
.name {
  font-family: var(--font-mono);
  font-size: 12.5px;
  color: var(--text);
  white-space: nowrap;
}
.row.active .name {
  color: var(--accent);
}
.description {
  font-size: 12px;
  color: var(--text-muted);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.empty {
  margin: 0;
  padding: 8px 12px;
  font-size: 12.5px;
  color: var(--text-faint);
}
</style>
