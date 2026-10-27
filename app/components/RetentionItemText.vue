<script setup lang="ts">
/**
 * The text of a row on Mehr → Löschfristen: facility, what and from when in columns; on a phone the name on top and
 * facility and date in a small line below, so the button keeps its place on the right.
 */
defineProps<{ facility: string; what: string; from: string }>()
</script>

<template>
  <div class="min-w-0 flex-1 sm:flex sm:items-center sm:gap-4">
    <span class="hidden text-gray-600 sm:block sm:w-40 sm:shrink-0">{{ facility }}</span>
    <span class="block font-medium sm:min-w-0 sm:flex-1">{{ what }}</span>
    <span class="block text-xs text-gray-500 sm:hidden">{{ facility }} · {{ from }}</span>
    <span class="hidden text-gray-600 sm:block">{{ from }}</span>
  </div>
</template>
