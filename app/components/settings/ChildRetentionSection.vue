<script setup lang="ts">
import type { ChildRetentionDto } from '#shared/types/api'
import { de } from '~/locales/de'

/** Träger only: how many whole years a record is kept after the child left (one setting for all facilities). */
const { data, refresh } = await useFetch<ChildRetentionDto>('/api/child-retention')
const { busy, run } = useBusyAction(async () => {
  await Promise.all([refresh(), refreshNuxtData('children-archive')])
})
const years = ref(3)
watch(data, (value) => { if (value) years.value = value.years }, { immediate: true })
const yearItems = Array.from({ length: 10 }, (_, index) => ({ label: String(index + 1), value: index + 1 }))

const save = () => run(() => $fetch<unknown>('/api/child-retention', { method: 'PUT', body: { years: years.value } }), de.common.saved)
</script>

<template>
  <section class="space-y-2 rounded-lg bg-white p-4 ring-1 ring-gray-200">
    <h2 class="font-semibold">{{ de.childSettings.retention }}</h2>
    <form class="flex flex-wrap items-end gap-3" @submit.prevent="save">
      <UFormField :label="de.childSettings.retentionYears"><USelect v-model="years" :items="yearItems" class="w-24" /></UFormField>
      <UButton type="submit" :label="de.common.save" :loading="busy" :disabled="busy" />
    </form>
    <p class="text-xs text-gray-500">{{ de.childSettings.retentionHint }}</p>
  </section>
</template>
