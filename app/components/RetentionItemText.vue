<script setup lang="ts">
/**
 * The text of a row on Mehr → Löschfristen: facility, what and from when in columns; on a phone the name on top and
 * facility and date in a small line below, so the button keeps its place on the right. `overdue`: past a legal deadline
 * (an inspection record, § 72a Abs. 5 SGB VIII) – the date in red.
 */
defineProps<{ facility: string; what: string; from: string; overdue?: boolean }>()
</script>

<template>
  <div class="min-w-0 flex-1 sm:flex sm:items-center sm:gap-4">
    <span class="hidden text-gray-600 sm:block sm:w-40 sm:shrink-0">{{ facility }}</span>
    <span class="block font-medium sm:min-w-0 sm:flex-1" :class="overdue ? 'text-red-800' : ''">{{ what }}</span>
    <span class="block text-xs sm:hidden" :class="overdue ? 'font-medium text-red-700' : 'text-gray-500'">{{ facility }} · {{ from }}</span>
    <span class="hidden sm:block" :class="overdue ? 'font-medium text-red-700' : 'text-gray-600'">{{ from }}</span>
  </div>
</template>
