<script setup lang="ts">
import { de } from '~/locales/de'

/** A settings section that lives on another page: its name, a sentence and the link there. */
defineProps<{ title: string; text: string; to: string }>()
</script>

<template>
  <section class="space-y-2 rounded-lg bg-white p-4 ring-1 ring-gray-200">
    <h2 class="font-semibold">{{ title }}</h2>
    <p class="text-sm text-gray-600">{{ text }}</p>
    <UButton :to="to" size="sm" color="neutral" variant="outline" trailing-icon="i-lucide-arrow-right" :label="de.privacy.open" />
  </section>
</template>
