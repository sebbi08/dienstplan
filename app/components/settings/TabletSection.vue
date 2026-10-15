<script setup lang="ts">
import { MAX_TABLET_LOCK_MINUTES, MIN_TABLET_LOCK_MINUTES } from '#shared/domain/tablet'
import type { TabletSettingsDto } from '#shared/types/api'
import { de } from '~/locales/de'

/** How long the facility's tablet stays unlocked without use, and whether it shows planned children (Leitung and Träger). */
const { data, refresh } = await useFetch<TabletSettingsDto>('/api/tablet-settings', { key: 'tablet-settings' })
const { busy, run } = useBusyAction(refresh)
const s = de.tablet

const lockMinutes = ref(2)
const showWaitlist = ref(false)
const showFutureContracts = ref(false)
watch(data, (value) => {
  if (!value) return
  lockMinutes.value = value.lockMinutes
  showWaitlist.value = value.showWaitlist
  showFutureContracts.value = value.showFutureContracts
}, { immediate: true })

const save = () => run(() => $fetch<unknown>('/api/tablet-settings', {
  method: 'PUT',
  body: { lockMinutes: lockMinutes.value, showWaitlist: showWaitlist.value, showFutureContracts: showFutureContracts.value },
}), de.common.saved)
</script>

<template>
  <section v-if="data" class="space-y-2 rounded-lg bg-white p-4 ring-1 ring-gray-200">
    <h2 class="font-semibold">{{ s.title }}</h2>
    <form class="space-y-3" @submit.prevent="save">
      <UFormField :label="s.lockMinutes">
        <UInput v-model.number="lockMinutes" type="number" :min="MIN_TABLET_LOCK_MINUTES" :max="MAX_TABLET_LOCK_MINUTES" step="1" class="w-24" required />
      </UFormField>
      <USwitch v-model="showWaitlist" :label="s.showWaitlist" />
      <USwitch v-model="showFutureContracts" :label="s.showFutureContracts" />
      <UButton type="submit" :label="de.common.save" :loading="busy" :disabled="busy" />
    </form>
    <p class="text-xs text-gray-500">{{ s.hint }}</p>
  </section>
</template>
