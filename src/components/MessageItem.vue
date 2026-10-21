<script setup lang="ts">
import { computed } from "vue"
import { User } from "lucide-vue-next"
import type { FilePart, MessageWithParts, Part, TextPart, ToolPart } from "@/api/types"
import { formatCost, formatDateTime, formatTokens } from "@/utils/format"
import { composedMessage } from "@/utils/compose"
import { heldModifier } from "@/stores/shortcuts"
import Markdown from "./Markdown.vue"
import PartFile from "./PartFile.vue"
import PartMessageCompose from "./PartMessageCompose.vue"
import PartReasoning from "./PartReasoning.vue"
import PartTool from "./PartTool.vue"

const props = defineProps<{ message: MessageWithParts; streaming?: boolean }>()

const isUser = computed(() => props.message.info.role === "user")

const contentParts = computed<Part[]>(() =>
  props.message.parts.filter((part) => {
    if (part.type === "text") {
      const text = part as TextPart
      if (text.synthetic || text.ignored || !text.text.trim()) return false
    }
    return true
  }),
)

const errorMessage = computed(() => {
  const info = props.message.info
  if (info.role !== "assistant" || !info.error) return null
  const error = info.error as { data?: { message?: string }; name?: string }
  return error.data?.message ?? error.name ?? "The model returned an error."
})

const meta = computed(() => {
  const info = props.message.info
  if (info.role !== "assistant") return null
  const tokens = info.tokens
  const total = tokens ? (tokens.input ?? 0) + (tokens.output ?? 0) + (tokens.reasoning ?? 0) : 0
  return {
    model: info.modelID,
    tokens: total,
    cost: info.cost ?? 0,
    created: info.time?.created,
  }
})

function isCompose(part: Part): boolean {
  return part.type === "tool" && composedMessage(part as ToolPart) !== null
}
</script>

<template>
  <div class="message" :class="isUser ? 'user' : 'assistant'">
    <div v-if="!isUser" class="avatar" aria-hidden="true">K</div>
    <div class="bubble" :class="isUser ? 'user-bubble' : 'assistant-bubble'">
      <template v-for="part in contentParts" :key="part.id">
        <Markdown v-if="part.type === 'text' && !isUser" :text="(part as TextPart).text" :streaming="streaming" />
        <p v-else-if="part.type === 'text' && isUser" class="user-text">{{ (part as TextPart).text }}</p>

        <PartReasoning v-else-if="part.type === 'reasoning' && !isUser" :part="part" />
        <template v-else-if="part.type === 'tool' && !isUser">
          <PartMessageCompose v-if="isCompose(part)" :part="part" />
          <PartTool v-else :part="part" />
        </template>

        <PartFile v-else-if="part.type === 'file'" :part="part as FilePart" />
      </template>

      <div v-if="streaming && !isUser" class="caret"></div>

      <div v-if="errorMessage" class="error">{{ errorMessage }}</div>
    </div>
    <div v-if="isUser" class="avatar user-avatar" aria-hidden="true"><User :size="15" /></div>
    <div v-if="meta && !streaming && heldModifier === 'alt'" class="meta" :title="meta.model">
      <div class="meta-inner">
        <div v-if="meta.created" class="meta-row meta-datetime">{{ formatDateTime(meta.created) }}</div>
        <div class="meta-model">{{ meta.model }}</div>
        <div v-if="meta.tokens" class="meta-row">{{ formatTokens(meta.tokens) }} tokens</div>
        <div v-if="meta.cost" class="meta-row">{{ formatCost(meta.cost) }}</div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.message {
  position: relative;
  display: flex;
  gap: 12px;
  padding: 10px 0;
  max-width: var(--content-width);
  margin: 0 auto;
  width: 100%;
}
.message.user {
  justify-content: flex-end;
}
.message.assistant {
  justify-content: flex-start;
}
.avatar {
  flex: none;
  width: 28px;
  height: 28px;
  border-radius: 8px;
  display: grid;
  place-items: center;
  font-size: 12px;
  font-weight: 700;
  background: var(--accent);
  color: var(--accent-text);
  margin-top: 2px;
}
.user-avatar {
  background: var(--bg-active);
  color: var(--text-muted);
  font-size: 10px;
}
.bubble {
  min-width: 0;
  max-width: 100%;
}
.assistant-bubble {
  flex: 1;
}
.user-bubble {
  background: var(--bubble-user);
  border-radius: var(--radius-lg);
  padding: 9px 14px;
  max-width: 80%;
}
.user-text {
  margin: 0;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
.caret {
  display: inline-block;
  width: 8px;
  height: 15px;
  background: var(--text);
  vertical-align: text-bottom;
  animation: kilo-blink 1s step-start infinite;
}
@keyframes kilo-blink {
  50% {
    opacity: 0;
  }
}
.error {
  margin-top: 8px;
  padding: 9px 12px;
  border: 1px solid color-mix(in srgb, var(--danger) 45%, transparent);
  background: color-mix(in srgb, var(--danger) 12%, transparent);
  border-radius: var(--radius-sm);
  color: var(--danger);
  font-size: 13px;
}
/* Full-height gutter; the inner block sticks below the header while the
   message is in view (native sticky, so it never jitters on scroll). */
.meta {
  position: absolute;
  top: 0;
  left: calc(100% + 14px);
  height: 100%;
  width: max-content;
  max-width: min(360px, calc(50vw - var(--content-width) / 2 - 40px));
  pointer-events: none;
}
.meta-inner {
  position: sticky;
  top: -10px;
  font-size: 11px;
  line-height: 1.5;
  color: var(--text-faint);
}
.meta-model {
  font-family: var(--font-mono);
  font-size: 10.5px;
  color: var(--text-muted);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.meta-row {
  white-space: nowrap;
}
.meta-datetime {
  font-variant-numeric: tabular-nums;
}
/* On narrower screens there is no side gutter, so overlay the info on hover. */
@media (max-width: 1360px) {
  .meta {
    top: 6px;
    left: auto;
    right: 4px;
    height: auto;
    width: auto;
    max-width: none;
  }
  .meta-inner {
    position: static;
    padding: 4px 8px;
    background: var(--bg-elevated);
    border: 1px solid var(--border);
    border-radius: 6px;
    box-shadow: var(--shadow);
  }
}
</style>