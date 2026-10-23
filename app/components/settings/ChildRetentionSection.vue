<script setup lang="ts">
import type { ChildRetentionDto, ChildRetentionPreviewDto } from '#shared/types/api'
import { de } from '~/locales/de'

/** Träger only: how many whole years a record is kept after the child left (one setting for all facilities). */
const { data, refresh } = await useFetch<ChildRetentionDto>('/api/child-retention')
const { busy, guard } = useBusy()
const act = useAction(async () => {
  await Promise.all([refresh(), refreshNuxtData(['children-archive', 'school-settings'])])
})
// The preview only reads: no refresh, so the stored value does not overwrite what was typed before the confirmation.
const preview = useAction()
const confirm = useConfirm()
const notifySwitchedOff = useAutoLeaveNotice()
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

const dirty = useDirty(() => !!data.value && years.value !== data.value.years)

const save = () => guard(async () => {
  if (!dirty.value) return false
  // Fixed before anything is awaited: the field must not change what is confirmed and saved.
  const target = years.value
  if (!await confirmedShorter(target)) return false
  const answer = { autoLeaveSwitchedOff: false }
  const ok = await act(async () => {
    answer.autoLeaveSwitchedOff = (await $fetch<{ ok: boolean; autoLeaveSwitchedOff: boolean }>('/api/child-retention', { method: 'PUT', body: { years: target } })).autoLeaveSwitchedOff
  }, de.common.saved)
  // Another period changes whom the automatic leaving of school children can take.
  if (ok && answer.autoLeaveSwitchedOff) notifySwitchedOff()
  return ok
})
</script>

<template>
  <section class="space-y-2 rounded-lg bg-white p-4 ring-1 ring-gray-200">
    <h2 class="font-semibold">{{ de.childSettings.retention }}</h2>
    <form class="flex flex-wrap items-end gap-3" @submit.prevent="save">
      <UFormField :label="de.childSettings.retentionYears"><USelect v-model="years" :items="yearItems" class="w-24" /></UFormField>
      <UButton type="submit" :label="de.common.save" :loading="busy" :disabled="busy || !dirty" />
    </form>
    <p class="text-xs text-gray-500">{{ de.childSettings.retentionHint }}</p>
  </section>
</template>
