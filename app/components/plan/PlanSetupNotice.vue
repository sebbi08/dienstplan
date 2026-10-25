<script setup lang="ts">
import type { SetupChecklist } from '#shared/domain/setupChecklist'
import { de } from '~/locales/de'

/**
 * One small line for Leitung and Träger above the plan: „Noch n Punkte offen“ of „Was noch fehlt“, linking to the
 * settings; nothing while everything is entered. Loaded after the plan (lazy, in the browser), so it never slows it.
 */
const { data } = useFetch<SetupChecklist>('/api/setup-checklist', {
  key: 'setup-checklist-plan', lazy: true, server: false, pick: ['open'],
})
const count = computed(() => data.value?.open.length ?? 0)
</script>

<template>
  <p v-if="count > 0" class="text-sm text-gray-600 print:hidden">
    <NuxtLink to="/admin/settings" class="inline-flex items-center gap-1.5 hover:underline">
      <UIcon name="i-lucide-list-checks" class="size-4 shrink-0" aria-hidden="true" />
      {{ de.setupChecklist.planLine(count) }}
    </NuxtLink>
  </p>
</template>
