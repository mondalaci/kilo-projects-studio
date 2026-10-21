import { ref } from "vue"

export type Theme = "dark" | "light"

const KEY = "kilo-projects-studio.theme"

function initial(): Theme {
  const stored = localStorage.getItem(KEY)
  if (stored === "dark" || stored === "light") return stored
  return window.matchMedia?.("(prefers-color-scheme: light)").matches ? "light" : "dark"
}

export const theme = ref<Theme>(initial())

function apply() {
  document.documentElement.dataset.theme = theme.value
}

export function setTheme(next: Theme) {
  theme.value = next
  try {
    localStorage.setItem(KEY, next)
  } catch {
    /* ignore */
  }
  apply()
}

export function toggleTheme() {
  setTheme(theme.value === "dark" ? "light" : "dark")
}

export function initTheme() {
  apply()
}