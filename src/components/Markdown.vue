<script setup lang="ts">
import { computed, createApp, onBeforeUnmount, onMounted, ref, watch, type App as VueApp } from "vue"
import { marked } from "marked"
import DOMPurify from "dompurify"
import hljs from "highlight.js/lib/common"
import PronunciationBlock from "./PronunciationBlock.vue"
import { parsePronunciation } from "@/utils/pronunciation"

const props = defineProps<{ text: string; streaming?: boolean }>()
const root = ref<HTMLElement | null>(null)

marked.setOptions({ gfm: true, breaks: true })

const html = computed(() => {
  const raw = marked.parse(props.text ?? "", { async: false }) as string
  return DOMPurify.sanitize(raw, { ADD_ATTR: ["target", "rel"] })
})

function highlight() {
  if (!root.value) return
  root.value.querySelectorAll("pre code").forEach((block) => {
    try {
      hljs.highlightElement(block as HTMLElement)
    } catch {
      /* unsupported language */
    }
  })
}

/** Wrap each code block with a hover copy icon button. */
const COPY_ICON =
  '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/></svg>'
const CHECK_ICON =
  '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>'

function decorateCode() {
  if (!root.value) return
  root.value.querySelectorAll<HTMLPreElement>("pre").forEach((pre) => {
    const code = pre.querySelector("code")
    if (!code || pre.previousElementSibling?.classList.contains("code-block")) return
    // Mermaid blocks are rendered to diagrams separately.
    if (code.classList.contains("language-mermaid") || code.classList.contains("lang-mermaid")) return
    // Pronunciation blocks are rendered as interactive audio widgets.
    if (isPronunciation(code)) return

    const wrapper = document.createElement("div")
    wrapper.className = "code-block"
    pre.parentNode?.insertBefore(wrapper, pre)
    wrapper.appendChild(pre)

    const button = document.createElement("button")
    button.type = "button"
    button.className = "code-copy"
    button.title = "Copy code"
    button.setAttribute("aria-label", "Copy code")
    button.innerHTML = COPY_ICON
    button.addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText(code.textContent ?? "")
        button.innerHTML = CHECK_ICON
        button.classList.add("copied")
        setTimeout(() => {
          button.innerHTML = COPY_ICON
          button.classList.remove("copied")
        }, 1500)
      } catch {
        /* clipboard unavailable */
      }
    })
    wrapper.appendChild(button)
  })
}

/* ---------------------------------- Mermaid --------------------------------- */

let mermaidPromise: Promise<typeof import("mermaid").default> | null = null

async function getMermaid() {
  mermaidPromise ??= import("mermaid").then((mod) => mod.default)
  const mermaid = await mermaidPromise
  mermaid.initialize({
    startOnLoad: false,
    securityLevel: "strict",
    theme: document.documentElement.dataset.theme === "dark" ? "dark" : "default",
  })
  return mermaid
}

let renderToken = 0
async function renderMermaid() {
  // While a message is still streaming, mermaid source is incomplete; show the
  // code block and render once the message is done.
  if (props.streaming || !root.value) return
  const nodes = Array.from(root.value.querySelectorAll<HTMLElement>("pre > code.language-mermaid, pre > code.lang-mermaid"))
  if (nodes.length === 0) return
  const token = ++renderToken
  try {
    const mermaid = await getMermaid()
    for (const node of nodes) {
      if (token !== renderToken) return
      const pre = node.closest("pre")
      if (!pre) continue
      const source = node.textContent ?? ""
      try {
        const { svg } = await mermaid.render(`mermaid-${token}-${Math.random().toString(36).slice(2)}`, source)
        const container = document.createElement("div")
        container.className = "mermaid-diagram"
        container.innerHTML = svg
        pre.replaceWith(container)
      } catch {
        // Invalid/incomplete diagram: leave the highlighted code visible.
        pre.dataset.mermaidError = "true"
      }
    }
  } catch {
    /* mermaid failed to load */
  }
}

/* ------------------------------- Pronunciation ------------------------------ */

const PRONUNCIATION_SELECTOR = "pre > code.language-pronunciation, pre > code.lang-pronunciation"

function isPronunciation(code: Element) {
  return code.classList.contains("language-pronunciation") || code.classList.contains("lang-pronunciation")
}

// Each widget is a real Vue app mounted into the rendered markdown. The markdown
// HTML is replaced wholesale on every update, so widgets whose host detached are
// unmounted and rebuilt below.
let pronunciationApps: Array<{ app: VueApp; host: HTMLElement }> = []

// Set when a streaming response finishes; the next widget built from a *complete*
// (parseable) block auto-plays once. A response often finishes while its fenced
// block is still truncated, so this stays armed until a block actually parses.
// Ordinary re-renders (old messages, session loads) leave it false so history is
// never replayed.
let autoplayPending = false

function prunePronunciation() {
  pronunciationApps = pronunciationApps.filter(({ app, host }) => {
    if (host.isConnected) return true
    app.unmount()
    return false
  })
}

function renderPronunciation() {
  prunePronunciation()
  // While a message streams the block may be incomplete; show the code and wait.
  if (props.streaming || !root.value) return
  const autoplay = autoplayPending
  let autoplayed = false
  for (const node of root.value.querySelectorAll<HTMLElement>(PRONUNCIATION_SELECTOR)) {
    const pre = node.closest("pre")
    if (!pre) continue
    const source = node.textContent ?? ""
    const playable = parsePronunciation(source).length > 0
    const host = document.createElement("div")
    host.className = "pronunciation-host"
    const app = createApp(PronunciationBlock, { text: source, autoplay: autoplay && playable })
    app.mount(host)
    pre.replaceWith(host)
    pronunciationApps.push({ app, host })
    if (autoplay && playable) autoplayed = true
  }
  // Only disarm once a complete block has actually been handed the flag, so a
  // truncated block at completion does not consume it.
  if (autoplayed) autoplayPending = false
}

function renderAll() {
  highlight()
  decorateCode()
  void renderMermaid()
  renderPronunciation()
}

onMounted(renderAll)
onBeforeUnmount(() => {
  for (const { app } of pronunciationApps) app.unmount()
  pronunciationApps = []
})
// One watcher over both sources so a response that finishes and settles its
// final text in the same tick still sets `autoplayPending` before the widget is
// built.
watch([html, () => props.streaming], ([, streaming], [, prevStreaming]) => {
  if (prevStreaming === true && streaming === false) autoplayPending = true
  requestAnimationFrame(renderAll)
})
</script>

<template>
  <div ref="root" class="markdown" v-html="html"></div>
</template>