import { ref } from "vue"

/**
 * Which sidebar Ctrl+R and Ctrl+P are filtering.
 *
 * A single value, because only one sidebar can hold the keyboard focus at a
 * time, and the filter bars are otherwise identical.
 */
export type FilterTarget = "projects" | "changes" | null

const target = ref<FilterTarget>(null)

export const filterTarget = target

export function startFilter(next: Exclude<FilterTarget, null>) {
  target.value = next
}

export function stopFilter() {
  target.value = null
}
