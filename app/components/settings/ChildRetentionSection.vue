<script setup lang="ts">
import type { ChildRetentionDto, ChildRetentionPreviewDto } from '#shared/types/api'
import { de } from '~/locales/de'

/** Träger only: how many whole years a record is kept after the child left (one setting for all facilities). */
const { data, refresh } = await useFetch<ChildRetentionDto>('/api/child-retention')
const { busy, guard } = useBusy()
const act = useAction(async () => {
  await Promise.all([refresh(), refreshNuxtData('children-archive')])
})
// The preview only reads: no refresh, so the stored value does not overwrite what was typed before the confirmation.
const preview = useAction()
const confirm = useConfirm()
const years = ref(3)
watch(data, (value) => { if (value) years.value = value.years }, { immediate: true })
const yearItems = Array.from({ length: 10 }, (_, index) => ({ label: String(index + 1), value: index + 1 }))

/** A shorter period can schedule records for deletion at once: the Träger is told how many before it is saved. */
async function confirmedShorter(target: number): Promise<boolean> {
  if (!data.value || target >= data.value.years) return true
  let count = 0
  const counted = await preview(async () => {
    count = (await $fetch<ChildRetentionPreviewDto>('/api/child-retention/preview', { query: { years: target } })).count
  })
  if (!counted) return false
  return count === 0 || await confirm(de.childSettings.confirmShorterRetention(count), { confirmLabel: de.common.save, danger: true })
}

const save = () => guard(async () => {
  // Fixed before anything is awaited: the field must not change what is confirmed and saved.
  const target = years.value
  if (!await confirmedShorter(target)) return false
  return act(() => $fetch<unknown>('/api/child-retention', { method: 'PUT', body: { years: target } }), de.common.saved)
})
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
