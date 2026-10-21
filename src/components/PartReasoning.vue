<script setup lang="ts">
import { computed, nextTick, ref, watch } from "vue"
import type { ReasoningPart } from "@/api/types"
import Spinner from "./Spinner.vue"

const props = defineProps<{ part: ReasoningPart }>()
const streaming = computed(() => !props.part.time?.end)

const body = ref<HTMLElement | null>(null)

watch(
  () => props.part.text,
  async () => {
    if (!streaming.value) return
    await nextTick()
    const el = body.value
    if (el) el.scrollTop = el.scrollHeight
  },
)
</script>

<template>
  <div class="reasoning">
    <div v-if="streaming" class="head" aria-hidden="true">
      <Spinner :size="14" />
    </div>
    <div ref="body" class="body">{{ part.text }}</div>
  </div>
</template>

<style scoped>
.reasoning {
  position: relative;
  margin: 6px 0;
  border-left: 2px solid var(--border);
  padding-left: 10px;
}
/* Streaming indicator in the right gutter, mirroring the assistant avatar on the left. */
.head {
  position: absolute;
  top: 0;
  left: calc(100% + 10px);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  color: var(--text-faint);
  opacity: 0.6;
}
.body {
  margin-top: 6px;
  color: var(--text-muted);
  font-size: 13px;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  max-height: 100px;
  overflow-y: auto;
}
/* No right gutter on narrow viewports: fall back to overlaying the content. */
@media (max-width: 880px) {
  .head {
    left: auto;
    right: 0;
  }
}
</style>
