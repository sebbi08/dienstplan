<script setup lang="ts">
import { de } from '~/locales/de'

/** A day's automatic events (Eingewöhnung, Elterngespräch, birthdays): read-only, small grey italic with an icon. */
defineProps<{ events: string[] }>()
</script>

<template>
  <ul v-if="events.length" class="space-y-0.5 text-xs italic leading-snug text-gray-500" :title="de.plan.autoEventsHint">
    <li v-for="(text, index) in events" :key="index" class="flex items-start gap-1">
      <UIcon name="i-lucide-sparkles" class="mt-0.5 size-3 shrink-0" aria-hidden="true" />
      <span>{{ text }}</span>
    </li>
  </ul>
</template>
