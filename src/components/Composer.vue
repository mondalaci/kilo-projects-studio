<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from "vue"
import { ArrowUp, FileText, Paperclip, Square, TriangleAlert, X } from "lucide-vue-next"
import ShortcutBadge from "./ShortcutBadge.vue"
import ImageModelSelector from "./ImageModelSelector.vue"
import ModelSelector from "./ModelSelector.vue"
import VariantSelector from "./VariantSelector.vue"
import type { CommandInfo } from "@/api/types"
import { useApp } from "@/stores/app"
import { addFile, attachments, clearAttachments, composerFocusRequest, draft, removeAttachment } from "@/stores/draft"
import { useServer } from "@/stores/server"
import { fuzzyMatch } from "@/utils/fuzzy"
import { acceptsText, answerFromText, visibleFields } from "@/utils/form"
import { parseSlashHead } from "@/utils/slash"

const app = useApp()
const { sending, isBusy, awaitingUser, pendingForms } = app.chat
const { abort, sendMessage, sendCommand, replyForm } = app
const { commands, imageModels, selectedModelInfo, selectedModelVariants } = useServer()

const textarea = ref<HTMLTextAreaElement | null>(null)
const fileInput = ref<HTMLInputElement | null>(null)
const dragging = ref(false)
/** A typed answer to a pending question is in flight. */
const answering = ref(false)

const isImage = (mime: string) => mime.startsWith("image/")

const attachmentsUnsupported = () =>
  attachments.value.length > 0 &&
  selectedModelInfo.value != null &&
  !(selectedModelInfo.value.capabilities?.input ?? []).some((kind) => kind === "image" || kind === "file")

function resize() {
  const el = textarea.value
  if (!el) return
  el.style.height = "auto"
  el.style.height = `${Math.min(el.scrollHeight, 320)}px`
}

/**
 * The pending question this composer can answer, if any.
 *
 * A question card carries only what is *chosen*; a free-form answer is typed
 * here, so a question waiting on one turns the composer into its input.
 */
const answerableForm = computed(() =>
  pendingForms.value.find((form) => visibleFields(form).some(acceptsText)),
)
const placeholder = computed(() => (answerableForm.value ? "Type your answer…" : ""))

/* ------------------------------- slash menu ------------------------------- */

/**
 * The text after a leading `/`, while the draft is still that one token.
 *
 * The menu belongs to the name alone: once a space is typed the name is settled
 * and the rest is the command's input, so the list gets out of the way.
 */
const slashQuery = computed(() => {
  const text = draft.value
  return /^\/\S*$/.test(text) ? text.slice(1) : null
})

const slashDismissed = ref(false)
const slashIndex = ref(0)
const slashList = ref<HTMLElement | null>(null)

/**
 * The commands to offer, best match first.
 *
 * A name match outranks a description match, so `/im` finds `/image` before a
 * command that merely mentions images in its description.
 */
const slashMatches = computed<CommandInfo[]>(() => {
  const query = slashQuery.value
  if (query === null) return []
  if (!query) return [...commands.value].sort((a, b) => a.name.localeCompare(b.name))
  return commands.value
    .map((command) => {
      const byName = fuzzyMatch(query, command.name)
      const byDescription = command.description ? fuzzyMatch(query, command.description) : null
      return {
        command,
        score: Math.max(byName ? byName.score + 20 : -Infinity, byDescription?.score ?? -Infinity),
      }
    })
    .filter((item) => Number.isFinite(item.score))
    .sort((a, b) => b.score - a.score || a.command.name.localeCompare(b.command.name))
    .map((item) => item.command)
})

/** The row the keyboard acts on; clamped so a shrinking list cannot point past its end. */
const slashActive = computed(() => Math.min(slashIndex.value, Math.max(0, slashMatches.value.length - 1)))

const slashMenuOpen = computed(
  () =>
    slashQuery.value !== null &&
    !slashDismissed.value &&
    !answerableForm.value &&
    commands.value.length > 0,
)

// A new query is a new search: the old dismissal and highlight no longer apply.
watch(slashQuery, () => {
  slashDismissed.value = false
  slashIndex.value = 0
})

watch(slashActive, async (index) => {
  await nextTick()
  slashList.value?.querySelectorAll<HTMLElement>(".slash-item")[index]?.scrollIntoView({ block: "nearest" })
})

function moveSlash(step: number) {
  const count = slashMatches.value.length
  if (!count) return
  slashIndex.value = (slashActive.value + step + count) % count
}

/** Take a command into the composer, leaving the caret where its input goes. */
function acceptSlash(command: CommandInfo) {
  draft.value = `/${command.name} `
  slashDismissed.value = true
  void nextTick(() => {
    resize()
    const el = textarea.value
    if (!el) return
    el.focus()
    el.setSelectionRange(el.value.length, el.value.length)
  })
}

watch(draft, () => nextTick(resize))
watch(composerFocusRequest, () => nextTick(() => textarea.value?.focus()))

/**
 * Take the keyboard when the composer appears. A request can arrive before the
 * composer exists — picking a project while a diff is open has to close the diff
 * first, which mounts it — and a watcher cannot see a value that changed before
 * it was set up.
 */
onMounted(() => nextTick(() => textarea.value?.focus()))
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
  if ((!text.trim() && !hasFiles) || sending.value || answering.value) return

  // A pending question claims the line: replying to it is what frees the parked
  // run, and the card clears itself once the server has the answer. Attachments
  // mean the message rather than an answer, so they go the normal way.
  const form = hasFiles ? undefined : answerableForm.value
  const answer = form ? answerFromText(form, text) : null
  if (form && answer) {
    draft.value = ""
    await nextTick(resize)
    answering.value = true
    try {
      await replyForm(form.sessionID, form.id, answer)
    } catch {
      draft.value = text
      await nextTick(resize)
    } finally {
      answering.value = false
    }
    return
  }

  const files = attachments.value.map((item) => ({
    type: "file" as const,
    mime: item.mime,
    url: item.url,
    filename: item.filename,
  }))
  const pending = [...attachments.value]

  // A leading "/name" that names a stored command runs the command rather than
  // sending text: the server expands its template, and what follows the name
  // becomes the command's input. An unknown name is just text.
  const head = parseSlashHead(text)
  const command = head ? commands.value.find((item) => item.name === head.name) : undefined

  draft.value = ""
  clearAttachments()
  await nextTick(resize)

  try {
    if (command && head) await sendCommand(command.name, head.arguments, files)
    else await sendMessage(text, files)
  } catch {
    draft.value = text
    attachments.value = pending
  }
}

async function stop() {
  await abort()
}

function onKeydown(event: KeyboardEvent) {
  // The open menu owns the keys that would otherwise move the caret or submit,
  // so a command can be picked without touching the mouse.
  if (slashMenuOpen.value && !event.isComposing) {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault()
      moveSlash(event.key === "ArrowDown" ? 1 : -1)
      return
    }
    if (event.key === "Enter" || event.key === "Tab") {
      const command = slashMatches.value[slashActive.value]
      if (command) {
        event.preventDefault()
        acceptSlash(command)
        return
      }
    }
    if (event.key === "Escape") {
      event.preventDefault()
      slashDismissed.value = true
      return
    }
  }

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
      <div v-if="slashMenuOpen" ref="slashList" class="opencode-menu slash-menu" role="listbox">
        <button
          v-for="(command, index) in slashMatches"
          :key="command.name"
          type="button"
          role="option"
          :aria-selected="index === slashActive"
          class="slash-item"
          :class="{ 'is-active': index === slashActive }"
          @mouseenter="slashIndex = index"
          @mousedown.prevent="acceptSlash(command)"
        >
          <span class="slash-name">/{{ command.name }}</span>
          <span v-if="command.description" class="slash-desc">{{ command.description }}</span>
        </button>
        <div v-if="!slashMatches.length" class="slash-empty">No matching commands</div>
      </div>

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
          :placeholder="placeholder"
          @keydown="onKeydown"
          @paste="onPaste"
        />
        <ShortcutBadge modifier="alt" key-label="C" />
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
          <div class="control-group" title="Model and reasoning effort">
            <ModelSelector :grouped="selectedModelVariants.length ? 'start' : 'both'" />
            <template v-if="selectedModelVariants.length">
              <span class="control-divider" aria-hidden="true" />
              <VariantSelector grouped />
            </template>
          </div>
          <ImageModelSelector v-if="imageModels.length" />
          <span v-if="attachmentsUnsupported()" class="warn" title="The selected model may not accept images">
            <TriangleAlert :size="12" /> model may not accept images
          </span>
        </div>
        <div class="bar-right">
          <!-- A question parks the turn without streaming, so "stop" must show
               there too: it withdraws the question and frees the run. -->
          <button v-if="isBusy || awaitingUser" class="send stop" title="Stop (Alt+X)" @click="stop">
            <ShortcutBadge modifier="alt" key-label="X" />
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
  /* A gutter each side, matching the message content: the avatars hang outside
     that width, so the card lines up with the bubbles rather than with them. */
  padding: 6px 40px 12px;
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
  position: relative;
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
/* Lifted above the composer: the card sits at the bottom of the window, so the
   list opens upward, the way the other menus here do. */
.slash-menu {
  position: absolute;
  left: 8px;
  right: 8px;
  bottom: calc(100% + 6px);
  max-height: min(320px, 50vh);
  overflow: auto;
}
.slash-item {
  display: grid;
  gap: 2px;
  width: 100%;
  padding: 7px 9px;
  border: none;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--text);
  text-align: left;
  cursor: pointer;
}
.slash-item.is-active {
  background: var(--bg-hover);
}
.slash-name {
  font-family: var(--font-mono);
  font-size: 12.5px;
  color: var(--text);
}
.slash-desc {
  font-size: 11.5px;
  line-height: 1.4;
  color: var(--text-muted);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.slash-empty {
  padding: 12px;
  font-size: 12.5px;
  color: var(--text-muted);
  text-align: center;
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
  /* Tight: the bar carries four controls plus the attach button on one line. */
  gap: 6px;
  flex-wrap: wrap;
}
/* One pill for the two things a run needs: which model, and how hard it thinks.
   The segments inside it are the selectors themselves, so each keeps its own
   popup and its own shortcut. Not clipped: the Alt-key badges float above the
   segments, and each segment rounds its own end instead. */
.control-group {
  display: inline-flex;
  align-items: center;
  height: 32px;
  border: 1px solid var(--border);
  border-radius: 999px;
  background: var(--bg-elevated);
  transition: border-color 0.12s;
}
.control-group:focus-within {
  border-color: var(--accent);
}
.control-group > * {
  display: inline-flex;
  min-width: 0;
}
.control-divider {
  width: 1px;
  height: 16px;
  flex: none;
  background: var(--border);
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