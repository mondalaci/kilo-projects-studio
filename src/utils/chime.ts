/**
 * The attention chime.
 *
 * Synthesised with the Web Audio API rather than shipped as a file: it is two
 * short notes and a decay, which needs no asset and cannot 404. Played only when
 * the window is not in front of the user, so it never interrupts someone who is
 * already looking at the conversation.
 *
 * Electron is configured with `autoplayPolicy: "no-user-gesture-required"`, so
 * the context may start without a click; if a platform still refuses, the context
 * stays suspended and the next interaction resumes it.
 */

let context: AudioContext | null = null

/** Lazily create the shared audio context. */
function audio(): AudioContext | null {
  if (typeof window === "undefined") return null
  if (!context) {
    const Ctor = window.AudioContext ?? (window as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (!Ctor) return null
    try {
      context = new Ctor()
    } catch {
      return null
    }
  }
  if (context.state === "suspended") void context.resume().catch(() => undefined)
  return context
}

/**
 * Unlock audio early, so the first chime is not swallowed by the autoplay policy
 * on platforms that require a gesture.
 */
export function prepareAudio() {
  const ctx = audio()
  if (!ctx || ctx.state !== "suspended") return
  const unlock = () => {
    void ctx.resume().catch(() => undefined)
    window.removeEventListener("pointerdown", unlock)
    window.removeEventListener("keydown", unlock)
  }
  window.addEventListener("pointerdown", unlock, { once: true })
  window.addEventListener("keydown", unlock, { once: true })
}

/** One note of the chime: a short, soft, sine-ish blip. */
function note(ctx: AudioContext, frequency: number, startAt: number, duration: number, gain: number) {
  const oscillator = ctx.createOscillator()
  const envelope = ctx.createGain()

  oscillator.type = "sine"
  oscillator.frequency.value = frequency

  // Quick attack and a smooth decay: a chime, not a beep.
  envelope.gain.setValueAtTime(0.0001, startAt)
  envelope.gain.exponentialRampToValueAtTime(gain, startAt + 0.015)
  envelope.gain.exponentialRampToValueAtTime(0.0001, startAt + duration)

  oscillator.connect(envelope).connect(ctx.destination)
  oscillator.start(startAt)
  oscillator.stop(startAt + duration + 0.02)
}

/**
 * Play the attention chime: a rising two-note figure, quiet enough to sit under
 * whatever else is playing. Silently does nothing when audio is unavailable.
 */
export function playAttentionChime() {
  const ctx = audio()
  if (!ctx) return false
  if (ctx.state === "suspended") {
    // Resume and play, so the first call after an unlock is not lost.
    void ctx.resume().then(() => play(ctx)).catch(() => undefined)
    return true
  }
  play(ctx)
  return true
}

function play(ctx: AudioContext) {
  const now = ctx.currentTime + 0.02
  // Loud enough to notice over music, short enough not to nag.
  note(ctx, 880, now, 0.18, 0.24)
  note(ctx, 1174.7, now + 0.13, 0.3, 0.2)
}
