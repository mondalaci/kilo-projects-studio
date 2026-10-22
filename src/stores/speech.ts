import { computed, ref } from "vue"
import { useServer } from "./server"

/**
 * Text-to-speech for the `pronunciation` chat widget, backed by OpenRouter's
 * OpenAI-compatible speech endpoint so every TTS model OpenRouter exposes is
 * selectable.
 *
 * Browser-direct calls are safe here because OpenRouter sends
 * `Access-Control-Allow-Origin: *` for both the models list and
 * `/api/v1/audio/speech`.
 *
 * Credentials, in priority order:
 *  1. a key the user pasted here (persisted in localStorage), else
 *  2. the connected Kilo server's `openrouter` key, which `/provider` already
 *     returns to this client (in memory only, never persisted here).
 *
 * The server only serves that key over its own (loopback, optionally
 * password-protected) origin, so reading it here does not widen exposure beyond
 * the server's existing trust boundary.
 */

const MODELS_URL = "https://openrouter.ai/api/v1/models?output_modalities=speech"
const SPEECH_URL = "https://openrouter.ai/api/v1/audio/speech"

const MODEL_KEY = "kilo-projects-studio.tts.model"
const VOICE_KEY = "kilo-projects-studio.tts.voice"
const KEY_KEY = "kilo-projects-studio.tts.key"
const SLOW_KEY = "kilo-projects-studio.tts.slow"

/** Preferred default when the catalog loads and nothing valid is remembered. */
const DEFAULT_MODEL = "microsoft/mai-voice-2.1-flash"

export interface SpeechModel {
  id: string
  name: string
  voices: string[]
  pricing?: { prompt?: string; completion?: string }
}

function readStored(key: string): string {
  try {
    return localStorage.getItem(key) ?? ""
  } catch {
    return ""
  }
}

function writeStored(key: string, value: string) {
  try {
    if (value) localStorage.setItem(key, value)
    else localStorage.removeItem(key)
  } catch {
    /* ignore */
  }
}

const models = ref<SpeechModel[]>([])
const loading = ref(false)
const error = ref<string | null>(null)
let loadedOnce = false

/** Format that worked per model id, so we only probe a provider once. */
const formatByModel = new Map<string, AudioFormat>()

const selectedModelID = ref(readStored(MODEL_KEY))
const selectedVoice = ref(readStored(VOICE_KEY))
const apiKey = ref(readStored(KEY_KEY))
const slow = ref(readStored(SLOW_KEY) === "1")

// The v2 server does not expose provider credentials over the API, so speech
// synthesis relies on a manually entered key.
const server = useServer()
const serverKey = computed(() => "")

/** Manual key wins; otherwise fall back to the connected server's key. */
const effectiveKey = computed(() => apiKey.value || serverKey.value)
const keySource = computed<"manual" | "server" | "none">(() =>
  apiKey.value ? "manual" : serverKey.value ? "server" : "none",
)

const selectedModel = computed(() => models.value.find((model) => model.id === selectedModelID.value) ?? null)
const availableVoices = computed(() => selectedModel.value?.voices ?? [])
const hasKey = computed(() => effectiveKey.value.length > 0)

/** USD label for the model's input price, when it is priced per character. */
export function priceLabel(model: SpeechModel): string {
  const prompt = Number(model.pricing?.prompt ?? 0)
  const completion = Number(model.pricing?.completion ?? 0)
  if (completion > 0 && prompt === 0) return `$${trim(completion)}/s`
  if (prompt > 0 && completion === 0) return `$${trim(prompt * 1_000_000)}/M chars`
  return ""
}

function trim(value: number): string {
  if (value >= 1) return value.toFixed(2).replace(/\.00$/, "")
  if (value >= 0.01) return value.toFixed(2)
  return value.toFixed(3)
}

function syncVoice() {
  const voices = availableVoices.value
  if (voices.length && !voices.includes(selectedVoice.value)) {
    selectedVoice.value = voices[0] ?? ""
    writeStored(VOICE_KEY, selectedVoice.value)
  } else if (!voices.length && selectedVoice.value) {
    selectedVoice.value = ""
    writeStored(VOICE_KEY, "")
  }
}

function selectModel(id: string) {
  selectedModelID.value = id
  writeStored(MODEL_KEY, id)
  syncVoice()
}

export function useSpeech() {
  async function loadModels(force = false) {
    if (loadedOnce && !force) return
    loading.value = true
    error.value = null
    try {
      const res = await fetch(MODELS_URL)
      if (!res.ok) throw new Error(`OpenRouter returned ${res.status}`)
      const data = (await res.json()) as { data?: Array<Record<string, unknown>> }
      models.value = (data.data ?? [])
        .map((item) => ({
          id: String(item.id ?? ""),
          name: String(item.name ?? item.id ?? ""),
          voices: Array.isArray(item.supported_voices)
            ? item.supported_voices.filter((voice): voice is string => typeof voice === "string")
            : [],
          pricing: item.pricing as SpeechModel["pricing"],
        }))
        .filter((model) => model.id)
        .sort((a, b) => a.name.localeCompare(b.name))
      loadedOnce = true

      if (!models.value.some((model) => model.id === selectedModelID.value)) {
        const preferred = models.value.find((model) => model.id === DEFAULT_MODEL) ?? models.value[0]
        if (preferred) selectModel(preferred.id)
      } else {
        syncVoice()
      }
    } catch (err) {
      error.value = err instanceof Error ? err.message : String(err)
    } finally {
      loading.value = false
    }
  }

  function setVoice(voice: string) {
    selectedVoice.value = voice
    writeStored(VOICE_KEY, voice)
  }

  function setApiKey(key: string) {
    apiKey.value = key.trim()
    writeStored(KEY_KEY, apiKey.value)
  }

  function setSlow(value: boolean) {
    slow.value = value
    writeStored(SLOW_KEY, value ? "1" : "")
  }

  /** Synthesize `input` and return playable audio. Throws a readable error. */
  async function synthesize(input: string): Promise<Blob> {
    const key = effectiveKey.value
    if (!key) throw new Error("No OpenRouter key: connect to a Kilo server with openrouter, or paste a key.")
    const model = selectedModelID.value
    if (!model) throw new Error("Choose a speech model first.")
    const voice = selectedVoice.value || undefined

    // Most models return mp3; some (notably Gemini TTS) require raw pcm. Start
    // from the cached/preferred format and, if the provider rejects it, retry
    // with the format it names in the error, then remember it for this model.
    let format = formatByModel.get(model) ?? (model.startsWith("google/") ? "pcm" : "mp3")
    let res = await requestSpeech(key, model, input, voice, format)
    if (!res.ok) {
      const message = await errorMessage(res)
      const required = requiredFormat(message)
      if (!required || required === format) throw new Error(message)
      format = required
      res = await requestSpeech(key, model, input, voice, format)
      if (!res.ok) throw new Error(await errorMessage(res))
    }
    formatByModel.set(model, format)

    if (format === "pcm") {
      const { rate, channels } = pcmParams(res.headers.get("content-type"))
      return pcmToWav(await res.arrayBuffer(), rate, channels)
    }
    return await res.blob()
  }

  return {
    models,
    loading,
    error,
    selectedModelID,
    selectedModel,
    selectedVoice,
    availableVoices,
    apiKey,
    keySource,
    hasKey,
    slow,
    loadModels,
    selectModel,
    setVoice,
    setApiKey,
    setSlow,
    synthesize,
  }
}

type AudioFormat = "mp3" | "pcm"

/** Format the provider demands, parsed from `…only supports response_format="pcm"`. */
function requiredFormat(message: string): AudioFormat | null {
  const match = message.match(/response_format\s*=\s*"?(mp3|pcm)"?/i)
  return match ? (match[1].toLowerCase() as AudioFormat) : null
}

function requestSpeech(
  key: string,
  model: string,
  input: string,
  voice: string | undefined,
  format: AudioFormat,
): Promise<Response> {
  const body: Record<string, unknown> = { model, input, response_format: format }
  if (voice) body.voice = voice
  return fetch(SPEECH_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
      "HTTP-Referer": window.location.origin,
      "X-Title": "Kilo Projects Studio",
    },
    body: JSON.stringify(body),
  })
}

/** Read `audio/pcm;rate=24000;channels=1`, defaulting to 24 kHz mono 16-bit. */
function pcmParams(contentType: string | null): { rate: number; channels: number } {
  const rate = Number(contentType?.match(/rate=(\d+)/i)?.[1]) || 24000
  const channels = Number(contentType?.match(/channels=(\d+)/i)?.[1]) || 1
  return { rate, channels }
}

/** Wrap raw 16-bit little-endian PCM in a WAV container the browser can play. */
function pcmToWav(pcm: ArrayBuffer, sampleRate: number, channels: number): Blob {
  const bitsPerSample = 16
  const blockAlign = (channels * bitsPerSample) / 8
  const header = new ArrayBuffer(44)
  const view = new DataView(header)
  const writeString = (offset: number, text: string) => {
    for (let i = 0; i < text.length; i++) view.setUint8(offset + i, text.charCodeAt(i))
  }
  writeString(0, "RIFF")
  view.setUint32(4, 36 + pcm.byteLength, true)
  writeString(8, "WAVE")
  writeString(12, "fmt ")
  view.setUint32(16, 16, true) // fmt chunk size
  view.setUint16(20, 1, true) // PCM
  view.setUint16(22, channels, true)
  view.setUint32(24, sampleRate, true)
  view.setUint32(28, sampleRate * blockAlign, true) // byte rate
  view.setUint16(32, blockAlign, true)
  view.setUint16(34, bitsPerSample, true)
  writeString(36, "data")
  view.setUint32(40, pcm.byteLength, true)
  return new Blob([header, pcm], { type: "audio/wav" })
}

async function errorMessage(res: Response): Promise<string> {
  const fallback = `Speech request failed (${res.status})`
  try {
    const text = await res.text()
    if (!text) return fallback
    try {
      const json = JSON.parse(text) as { error?: { message?: string }; message?: string }
      return json.error?.message ?? json.message ?? text.slice(0, 200)
    } catch {
      return text.slice(0, 200)
    }
  } catch {
    return fallback
  }
}
