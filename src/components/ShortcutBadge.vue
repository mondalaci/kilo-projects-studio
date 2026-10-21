<script setup lang="ts">
import { computed } from "vue"
import { heldModifier } from "@/stores/shortcuts"

/**
 * The key badge that floats on a control while the modifier for its shortcut is
 * held: `Alt` for the actions on this keyboard layer, `Ctrl` for the filters.
 *
 * Holding a modifier reveals only its own layer, and the badge names it, so a
 * letter is never shown next to the wrong modifier.
 */
const props = defineProps<{
  /** Which modifier this shortcut belongs to. */
  modifier: "alt" | "ctrl"
  /** The key letter, without the modifier. */
  keyLabel: string
  /**
   * Where the badge sits:
   * - `corner` floats it over the control's corner, which needs room above and to
   *   the right of the control;
   * - `inside` keeps it within the control, for the header strip where the window
   *   edge is only a few pixels away;
   * - `below` floats it under a text label, centred: for a label narrower than the
   *   badge, where the corner would reach past the window edge. Nothing enters the
   *   flow, so holding a modifier never moves the layout, and sitting under the
   *   label keeps the label readable.
   */
  placement?: "corner" | "inside" | "below"
}>()

const visible = computed(() => heldModifier.value === props.modifier)
const prefix = computed(() => (props.modifier === "alt" ? "Alt" : "Ctrl"))
</script>

<template>
  <kbd v-if="visible" class="kbd" :class="placement ?? 'corner'">
    <span class="modifier">{{ prefix }}</span><span>{{ keyLabel }}</span>
  </kbd>
</template>

<style scoped>
/* `corner` is the global floating look; the scope attribute keeps these two ahead
   of it whatever order the stylesheets are bundled in. */
.kbd.inside {
  position: absolute;
  top: 1px;
  right: 1px;
  z-index: 3;
  pointer-events: none;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.3);
}
/* Under its label, still out of the flow: the layout never moves, the label stays
   readable, and the overhang is shared between both sides instead of reaching a
   window edge. */
.kbd.below {
  position: absolute;
  top: calc(100% + 3px);
  left: 50%;
  transform: translateX(-50%);
  z-index: 4;
  pointer-events: none;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.3);
}
/* The modifier reads as a quieter part of the badge than the key itself, and is
   tighter than the key so a prefixed badge still fits beside a small control. */
.modifier {
  color: var(--text-faint);
  margin-right: 3px;
  font-size: 9px;
}
</style>
