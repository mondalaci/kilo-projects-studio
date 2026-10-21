<script setup lang="ts">
defineProps<{ size?: number }>()
</script>

<template>
  <span class="spinner" :style="{ width: `${size ?? 16}px`, height: `${size ?? 16}px` }" aria-hidden="true"></span>
</template>

<style scoped>
.spinner {
  display: inline-block;
  border: 2px solid currentColor;
  border-right-color: transparent;
  border-radius: 50%;
  animation: kilo-spin 0.7s linear infinite;
  opacity: 0.8;
}
@keyframes kilo-spin {
  to {
    transform: rotate(360deg);
  }
}
</style>