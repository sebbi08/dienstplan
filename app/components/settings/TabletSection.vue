<script setup lang="ts">
import { MAX_NO_LOCK_WINDOWS, MAX_TABLET_LOCK_MINUTES, MIN_TABLET_LOCK_MINUTES } from '#shared/domain/tablet'
import type { TabletSettingsDto } from '#shared/types/api'
import { de } from '~/locales/de'
import { fromWindowDrafts, sameWindowDrafts, toWindowDrafts, type WindowDraft } from '~/utils/tabletWindows'

/**
 * How long the facility's tablet stays unlocked without use, the time windows without the automatic lock (e.g. the main
 * drop-off and pick-up times), and whether it shows planned children (Leitung and Träger).
 */
const { data, refresh } = await useFetch<TabletSettingsDto>('/api/tablet-settings', { key: 'tablet-settings' })
const { busy, run } = useBusyAction(refresh)
const s = de.tablet

const lockMinutes = ref(2)
const showWaitlist = ref(false)
const showFutureContracts = ref(false)
const windows = ref<WindowDraft[]>([])
watch(data, (value) => {
  if (!value) return
  lockMinutes.value = value.lockMinutes
  showWaitlist.value = value.showWaitlist
  showFutureContracts.value = value.showFutureContracts
  windows.value = toWindowDrafts(value.noLockWindows)
}, { immediate: true })

const dirty = useDirty(() => !!data.value && (!sameValue(
  [Number(lockMinutes.value), showWaitlist.value, showFutureContracts.value],
  [data.value.lockMinutes, data.value.showWaitlist, data.value.showFutureContracts],
) || !sameWindowDrafts(windows.value, toWindowDrafts(data.value.noLockWindows))))

// The wrong window of the last save attempt, named and marked (cleared by the next edit).
const problem = ref<{ row: number | null; text: string } | null>(null)
watch(windows, () => (problem.value = null), { deep: true })

function addWindow() {
  windows.value.push({ start: '', end: '' })
}
function removeWindow(index: number) {
  windows.value.splice(index, 1)
}

function save() {
  if (!dirty.value) return
  // The server's check, here first, so the wrong window can be named and marked.
  const checked = fromWindowDrafts(windows.value)
  if (checked.problem) {
    problem.value = checked.problem
    return
  }
  return run(() => $fetch<TabletSettingsDto>('/api/tablet-settings', {
    method: 'PUT',
    body: {
      lockMinutes: lockMinutes.value, showWaitlist: showWaitlist.value, showFutureContracts: showFutureContracts.value,
      noLockWindows: checked.windows,
    },
  }), de.common.saved)
}
</script>

<template>
  <section v-if="data" class="space-y-2 rounded-lg bg-white p-4 ring-1 ring-gray-200">
    <h2 class="font-semibold">{{ s.title }}</h2>
    <form class="space-y-3" @submit.prevent="save">
      <UFormField :label="s.lockMinutes">
        <UInput v-model.number="lockMinutes" type="number" :min="MIN_TABLET_LOCK_MINUTES" :max="MAX_TABLET_LOCK_MINUTES" step="1" class="w-24" required />
      </UFormField>
      <fieldset class="space-y-2">
        <legend class="text-sm font-medium">{{ s.noLockTitle }}</legend>
        <p class="text-xs text-gray-500">{{ s.noLockHint }}</p>
        <p v-if="!windows.length" class="text-sm text-gray-500">{{ s.noLockNone }}</p>
        <ul class="space-y-2">
          <li
            v-for="(entry, index) in windows" :key="index" class="flex flex-wrap items-center gap-2 rounded text-sm"
            :class="problem?.row === index + 1 ? 'bg-red-50 p-1 ring-1 ring-red-400' : ''"
            :aria-invalid="problem?.row === index + 1 ? true : undefined"
          >
            <span>{{ s.noLockFrom }}</span>
            <TimeInput v-model="entry.start" any-minute class="w-20" :aria-label="`${s.noLockFrom} ${index + 1}`" />
            <span>{{ s.noLockTo }}</span>
            <TimeInput v-model="entry.end" any-minute class="w-20" :aria-label="`${s.noLockTo} ${index + 1}`" />
            <UButton
              size="sm" color="neutral" variant="ghost" icon="i-lucide-trash-2" :aria-label="`${s.noLockRemove}: ${index + 1}`"
              :title="s.noLockRemove" :disabled="busy" @click="removeWindow(index)"
            />
          </li>
        </ul>
        <p v-if="problem" class="flex items-center gap-1 text-sm text-red-700" role="alert">
          <UIcon name="i-lucide-circle-alert" class="size-4 shrink-0" aria-hidden="true" /> {{ problem.text }}
        </p>
        <UButton
          v-if="windows.length < MAX_NO_LOCK_WINDOWS" size="sm" color="neutral" variant="outline" icon="i-lucide-plus"
          :label="s.noLockAdd" :disabled="busy" @click="addWindow"
        />
        <p class="text-xs text-gray-500">{{ s.noLockDays }}</p>
      </fieldset>
      <USwitch v-model="showWaitlist" :label="s.showWaitlist" />
      <USwitch v-model="showFutureContracts" :label="s.showFutureContracts" />
      <UButton type="submit" :label="de.common.save" :loading="busy" :disabled="busy || !dirty" />
    </form>
    <p class="text-xs text-gray-500">{{ s.hint }}</p>
  </section>
</template>
