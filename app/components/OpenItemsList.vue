<script setup lang="ts">
import type { OpenItemLink } from '~/utils/openItems'

/** The lines of „Offen für dich“ as links (the card on „Mein Dienstplan“, the side panel of „Offen (n)“ on the plan). */
defineProps<{ links: OpenItemLink[] }>()
const emit = defineEmits<{ navigate: [] }>()
</script>

<template>
  <ul>
    <li v-for="link in links" :key="link.key">
      <NuxtLink
        :to="link.to"
        class="inline-flex min-h-10 items-center gap-2 rounded-md bg-white px-3 py-1.5 text-sm text-sky-900 ring-1 ring-sky-200 hover:bg-sky-100 focus-visible:outline-2 focus-visible:outline-primary"
        @click="emit('navigate')"
      >
        <UIcon :name="link.icon" class="size-4 shrink-0" aria-hidden="true" />
        <span>{{ link.label }}</span>
        <UIcon name="i-lucide-chevron-right" class="size-4 shrink-0 text-sky-600" aria-hidden="true" />
      </NuxtLink>
    </li>
  </ul>
</template>
