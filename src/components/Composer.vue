<script setup lang="ts">
import { nextTick, onMounted, ref, watch } from "vue"
import { ArrowUp, FileText, Paperclip, Square, TriangleAlert, X } from "lucide-vue-next"
import AgentSelector from "./AgentSelector.vue"
import ModelSelector from "./ModelSelector.vue"
import VariantSelector from "./VariantSelector.vue"
import { useApp } from "@/stores/app"
import { addFile, attachments, clearAttachments, composerFocusRequest, draft, removeAttachment } from "@/stores/draft"
import { useServer } from "@/stores/server"
import { shortcutsVisible } from "@/stores/shortcuts"

const app = useApp()
const { sending, isBusy } = app.chat
const { abort, sendMessage } = app
const { selectedModelInfo, selectedModelVariants } = useServer()

const textarea = ref<HTMLTextAreaElement | null>(null)
const fileInput = ref<HTMLInputElement | null>(null)
const dragging = ref(false)

const isImage = (mime: string) => mime.startsWith("image/")

const attachmentsUnsupported = () =>
  attachments.value.length > 0 && selectedModelInfo.value != null && !selectedModelInfo.value.capabilities?.attachment

function resize() {
  const el = textarea.value
  if (!el) return
  el.style.height = "auto"
  el.style.height = `${Math.min(el.scrollHeight, 320)}px`
}

watch(draft, () => nextTick(resize))
watch(composerFocusRequest, () => nextTick(() => textarea.value?.focus()))
onMounted(() => {
  resize()
  // Focus the input by default when the chat UI opens.
  nextTick(() => textarea.value?.focus())
})

function handleFiles(files: ArrayLike<File> | null | undefined) {
  if (!files) return
  for (const file of Array.from(files)) void addFile(file)
}

function pickFiles() {
  fileInput.value?.click()
}

function onFilePicked(event: Event) {
  const input = event.target as HTMLInputElement
  handleFiles(input.files)
  input.value = ""
}

function onPaste(event: ClipboardEvent) {
  const items = event.clipboardData?.items
  if (!items) return
  const files: File[] = []
  for (let i = 0; i < items.length; i++) {
    const item = items[i]
    if (item.kind === "file") {
      const file = item.getAsFile()
      if (file) files.push(file)
    }
  }
  if (files.length === 0) return
  event.preventDefault()
  handleFiles(files)
}

function onDrop(event: DragEvent) {
  dragging.value = false
  handleFiles(event.dataTransfer?.files)
}

async function submit() {
  const text = draft.value
  const hasFiles = attachments.value.length > 0
  if ((!text.trim() && !hasFiles) || sending.value) return

  const files = attachments.value.map((item) => ({
    type: "file" as const,
    mime: item.mime,
    url: item.url,
    filename: item.filename,
  }))
  const pending = [...attachments.value]

  draft.value = ""
  clearAttachments()
  await nextTick(resize)

  try {
    await sendMessage(text, files)
  } catch {
    draft.value = text
    attachments.value = pending
  }
}

async function stop() {
  await abort()
}

function onKeydown(event: KeyboardEvent) {
  if (event.key === "Enter" && !event.shiftKey && !event.isComposing) {
    event.preventDefault()
    void submit()
  }
}
</script>

<template>
  <div class="composer-wrap">
    <div
      class="composer"
      :class="{ dragging }"
      @dragover.prevent="dragging = true"
      @dragleave.prevent="dragging = false"
      @drop.prevent="onDrop"
    >
      <div v-if="attachments.length" class="attachments">
        <div v-for="item in attachments" :key="item.id" class="attachment" :class="{ file: !isImage(item.mime) }">
          <img v-if="isImage(item.mime)" :src="item.url" :alt="item.filename" />
          <template v-else>
            <FileText :size="18" />
            <span class="file-name" :title="item.filename">{{ item.filename }}</span>
          </template>
          <button type="button" class="remove" :title="`Remove ${item.filename}`" @click="removeAttachment(item.id)">
            <X :size="12" />
          </button>
        </div>
      </div>

      <div class="input-wrap">
        <textarea
          ref="textarea"
          v-model="draft"
          class="input"
          rows="1"
          spellcheck="false"
          @keydown="onKeydown"
          @paste="onPaste"
        />
        <kbd v-if="shortcutsVisible" class="kbd floating">C</kbd>
      </div>

      <div class="bar">
        <div class="bar-left">
          <input
            ref="fileInput"
            class="file-input"
            type="file"
            multiple
            @change="onFilePicked"
          />
          <button type="button" class="attach" title="Attach files" @click="pickFiles">
            <Paperclip :size="16" />
          </button>
          <AgentSelector />
          <ModelSelector />
          <VariantSelector v-if="selectedModelVariants.length" />
          <span v-if="attachmentsUnsupported()" class="warn" title="The selected model may not accept images">
            <TriangleAlert :size="12" /> model may not accept images
          </span>
        </div>
        <div class="bar-right">
          <button v-if="isBusy" class="send stop" title="Stop (Alt+X)" @click="stop">
            <kbd v-if="shortcutsVisible" class="kbd floating">X</kbd>
            <Square :size="14" fill="currentColor" />
          </button>
          <button
            v-else
            class="send"
            :disabled="(!draft.trim() && !attachments.length) || sending"
            title="Send (Enter)"
            @click="submit"
          >
            <ArrowUp :size="16" />
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.composer-wrap {
  /* Left inset matches the message avatar so the card lines up with the
     conversation content (assistant bubble). */
  padding: 6px 0 12px 40px;
  max-width: var(--content-width);
  margin: 0 auto;
  width: 100%;
}
@media (max-width: 900px) {
  .composer-wrap {
    padding: 6px 16px 12px;
  }
}
.composer {
  border: 1px solid var(--border);
  background: var(--bg-input);
  border-radius: var(--radius-lg);
  padding: 10px 12px 8px;
  box-shadow: 0 2px 12px rgba(0, 0, 0, 0.12);
  transition: border-color 0.12s;
}
.composer:focus-within {
  border-color: var(--border-strong);
}
.composer.dragging {
  border-color: var(--accent);
  border-style: dashed;
}
.attachments {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  padding: 2px 4px 8px;
}
.attachment {
  position: relative;
  width: 64px;
  height: 64px;
  border-radius: 8px;
  overflow: hidden;
  border: 1px solid var(--border);
  background: var(--bg-elevated);
}
.attachment img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}
.attachment .remove {
  position: absolute;
  top: 3px;
  right: 3px;
  width: 18px;
  height: 18px;
  padding: 0;
  border-radius: 50%;
  border: none;
  background: rgba(0, 0, 0, 0.62);
  color: #fff;
  display: grid;
  place-items: center;
}
.attachment .remove:hover {
  background: rgba(0, 0, 0, 0.85);
}
.attachment.file {
  width: auto;
  max-width: 220px;
  height: 40px;
  padding: 0 26px 0 10px;
  display: flex;
  align-items: center;
  gap: 8px;
  color: var(--text-muted);
}
.attachment.file .file-name {
  font-size: 12.5px;
  color: var(--text);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.file-input {
  display: none;
}
.attach {
  flex: none;
  width: 28px;
  height: 28px;
  padding: 0;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: var(--text-muted);
  display: grid;
  place-items: center;
  transition: background 0.12s, color 0.12s;
}
.attach:hover {
  background: var(--bg-active);
  color: var(--text);
}
.input-wrap {
  position: relative;
}
.input {
  width: 100%;
  max-height: 320px;
  resize: none;
  border: none;
  outline: none;
  background: transparent;
  color: var(--text);
  font-size: 15px;
  line-height: 1.5;
  padding: 2px 4px 8px;
}
.bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}
.bar-left {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}
.warn {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 11.5px;
  color: var(--accent);
}
.bar-right {
  display: flex;
  align-items: center;
  gap: 10px;
  flex: none;
}
.send {
  width: 34px;
  height: 34px;
  border-radius: 50%;
  border: none;
  background: var(--accent);
  color: var(--accent-text);
  display: grid;
  place-items: center;
  transition: background 0.12s, opacity 0.12s;
}
.send:hover:not(:disabled) {
  background: var(--accent-hover);
}
.send:disabled {
  opacity: 0.4;
  cursor: default;
}
.send.stop {
  position: relative;
  background: var(--bg-active);
  color: var(--text);
}
</style>