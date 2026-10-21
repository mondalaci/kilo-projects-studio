<script setup lang="ts">
import { computed } from "vue"
import { ArrowLeft } from "lucide-vue-next"
import { splitPath } from "@/utils/diff"

/**
 * Header for whatever the centre pane is showing (a diff, or a file).
 *
 * The source-control panel is always visible, so this strip is never the
 * right-hand end of the window and carries no window buttons. Callers add their
 * own badges and actions through the two slots.
 */
const props = defineProps<{ path: string; closeTitle?: string }>()
const emit = defineEmits<{ (event: "close"): void }>()

const base = computed(() => splitPath(props.path).base)
const dir = computed(() => splitPath(props.path).dir)
</script>

<template>
  <header class="editor-head drag-region">
    <button class="editor-icon" :title="closeTitle ?? 'Back to chat (Esc)'" @click="emit('close')">
      <ArrowLeft :size="16" />
    </button>
    <div class="paths">
      <span class="path-base">{{ base }}</span>
      <span v-if="dir" class="path-dir">{{ dir }}</span>
      <slot name="path-extra" />
    </div>
    <slot name="actions" />
  </header>
</template>

<style scoped>
.editor-head {
  flex: none;
  height: var(--header-height);
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 0 12px;
  border-bottom: 1px solid var(--border);
  background: var(--bg-elevated);
}
.paths {
  flex: 1;
  min-width: 0;
  display: flex;
  align-items: baseline;
  gap: 7px;
  font-size: 13px;
}
.path-base {
  font-weight: 600;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.path-dir {
  font-family: var(--font-mono);
  font-size: 11px;
  color: var(--text-faint);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
