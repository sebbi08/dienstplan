<script setup lang="ts">
import { de } from '~/locales/de'

/**
 * A small ⓘ with an explanation: opens on hover where there is a mouse, on a tap on phones and tablets (they have no
 * hover).
 */
defineProps<{ text: string }>()
const hoverable = ref(false)
onMounted(() => { hoverable.value = window.matchMedia('(hover: hover)').matches })
</script>

<template>
  <UPopover :mode="hoverable ? 'hover' : 'click'" :open-delay="100" :close-delay="100">
    <button type="button" class="inline-flex align-middle text-gray-400 hover:text-gray-600" :aria-label="de.common.explanation">
      <UIcon name="i-lucide-info" class="size-4" />
    </button>
    <template #content>
      <p class="max-w-xs whitespace-pre-line p-3 text-sm font-normal text-gray-700">{{ text }}</p>
    </template>
  </UPopover>
</template>
