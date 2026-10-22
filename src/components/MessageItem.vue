<script setup lang="ts">
import { computed } from "vue"
import { User } from "lucide-vue-next"
import type { AssistantBlock, AssistantReasoningBlock, AssistantToolBlock, SessionMessage } from "@/api/types"
import { formatCost, formatDateTime, formatTokens } from "@/utils/format"
import { composedMessage } from "@/utils/compose"
import { heldModifier } from "@/stores/shortcuts"
import Markdown from "./Markdown.vue"
import PartFile from "./PartFile.vue"
import PartMessageCompose from "./PartMessageCompose.vue"
import PartReasoning from "./PartReasoning.vue"
import PartTool from "./PartTool.vue"

const props = defineProps<{ message: SessionMessage; streaming?: boolean; caret?: boolean }>()

const isUser = computed(() => props.message.type === "user")
const isAssistant = computed(() => props.message.type === "assistant")

const content = computed<AssistantBlock[]>(() => (props.message.type === "assistant" ? props.message.content : []))

/** Bookkeeping messages with no user-facing content. */
const hidden = computed(() =>
  ["idle", "model-switched", "agent-switched", "location-switched"].includes(props.message.type),
)

/** Notes that are not part of the conversation flow (system, switches, idle). */
const note = computed<string | null>(() => {
  const message = props.message
  if (message.type === "system" || message.type === "synthetic") return message.text
  if (message.type === "skill") return `Skill: ${message.name}`
  if (message.type === "shell") return `$ ${message.command}`
  if (message.type === "compaction") return message.status === "running" ? "Compacting…" : `Compaction (${message.reason})`
  return null
})

const errorMessage = computed(() => {
  if (props.message.type !== "assistant" || !props.message.error) return null
  return props.message.error.message ?? "The model returned an error."
})

/** A turn waiting to try again after a failed step. */
const retryNote = computed(() => {
  if (props.message.type !== "assistant" || !props.message.retry) return null
  return `Retrying (attempt ${props.message.retry.attempt})…`
})

const meta = computed(() => {
  if (props.message.type !== "assistant") return null
  const message = props.message
  const tokens = message.tokens
  const total = tokens ? tokens.input + tokens.output + tokens.reasoning : 0
  return { model: message.model.id, tokens: total, cost: message.cost ?? 0, created: message.time?.created }
})

function isCompose(block: AssistantToolBlock): boolean {
  return composedMessage(block) !== null
}
</script>

<template>
  <template v-if="!hidden">
    <div v-if="note" class="note">{{ note }}</div>

    <div v-else class="message" :class="isUser ? 'user' : 'assistant'">
    <div v-if="!isUser" class="avatar" aria-hidden="true">K</div>
    <div class="bubble" :class="isUser ? 'user-bubble' : 'assistant-bubble'">
      <template v-if="isUser">
        <p v-if="message.type === 'user' && message.text" class="user-text">{{ message.text }}</p>
        <PartFile
          v-for="(file, index) in (message.type === 'user' ? message.files : undefined) ?? []"
          :key="index"
          :data="file.data"
          :mime="file.mime"
          :filename="file.name"
        />
      </template>

      <template v-else-if="isAssistant">
        <template v-for="(part, index) in content" :key="index">
          <Markdown v-if="part.type === 'text'" :text="part.text" :streaming="streaming" />
          <PartReasoning v-else-if="part.type === 'reasoning'" :block="part as AssistantReasoningBlock" />
          <template v-else-if="part.type === 'tool'">
            <PartMessageCompose v-if="isCompose(part)" :block="part" />
            <PartTool v-else :block="part" />
          </template>
        </template>
      </template>

      <!-- The caret tracks the *turn*, not this message's text: a step ends when
           its generation does, while its tools are still running, so keying it
           off `time.completed` left the whole tool phase with no sign of
           progress at all. -->
      <div v-if="caret" class="caret"></div>

      <div v-if="errorMessage" class="error">{{ errorMessage }}</div>
      <div v-if="retryNote" class="retry">{{ retryNote }}</div>
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
</template>

<style scoped>
.note {
  max-width: var(--content-width);
  margin: 6px auto;
  width: 100%;
  color: var(--text-faint);
  font-size: 12px;
  font-family: var(--font-mono);
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
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
.retry {
  margin-top: 6px;
  font-size: 12px;
  color: var(--text-faint);
  font-family: var(--font-mono);
}
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
