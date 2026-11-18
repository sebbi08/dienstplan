<script setup lang="ts">
import type { AgeLimitWarningDto } from '#shared/types/api'
import { de } from '~/locales/de'
import { ageLimitWarningText } from '~/utils/ageLimits'

/**
 * Leitung and Träger, on top of the Kinder page (never at the tablet; the page decides): the groups' age limits
 * exceeded now or in the coming twelve months, the first month per group and rule. Hidden when there are none.
 */
const { data, error } = useFetch<AgeLimitWarningDto[]>('/api/children/age-limit-warnings', { key: 'children-age-limit-warnings' })
const warnings = computed(() => (error.value ? [] : data.value ?? []))
</script>

<template>
  <section
    v-if="warnings.length" class="space-y-1 rounded-lg bg-amber-50 p-3 text-sm text-amber-900 ring-1 ring-amber-300"
    role="status" :aria-label="de.ageLimits.hintTitle"
  >
    <h2 class="flex items-center gap-1.5 font-semibold">
      <UIcon name="i-lucide-baby" class="size-4 shrink-0" aria-hidden="true" /> {{ de.ageLimits.hintTitle }}
    </h2>
    <ul class="list-disc space-y-0.5 pl-6">
      <li v-for="(warning, index) in warnings" :key="index">
        {{ ageLimitWarningText(warning) }}
      </li>
    </ul>
  </section>
</template>
