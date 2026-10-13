<script setup lang="ts">
import type { SchoolLeaverDto, SchoolSettingsDto } from '#shared/types/api'
import { de } from '~/locales/de'
import { errorCode, errorMessage } from '~/utils/errors'
import { formatDate } from '~/utils/format'

/**
 * The school cutoff of the facility (the Träger changes it, the Leitung sees it) and the automatic leaving of school
 * children: switching it on shows the children it deregisters at once and needs the Träger's confirmation of exactly that list.
 */
const { data, refresh } = await useFetch<SchoolSettingsDto>('/api/school-settings', { key: 'school-settings' })
const { user } = useUserSession()
const isProvider = computed(() => user.value?.role === 'provider')
const toast = useToast()
const notifySwitchedOff = useAutoLeaveNotice()
const s = de.schoolChildren
// Who left or is listed elsewhere changes with the switch; those lists follow.
const { busy, run } = useBusyAction(async () => {
  await Promise.all([refresh(), refreshNuxtData(['children-school-children', 'children-active', 'children-archive', 'children-occupancy', 'children-open', 'child-documents-overview'])])
})

const month = ref(6)
const day = ref(30)
const age = ref(6)
watch(data, (value) => {
  if (!value) return
  month.value = value.cutoffMonth
  day.value = value.cutoffDay
  age.value = value.ageYears
}, { immediate: true })

const monthItems = de.months.map((label, index) => ({ label, value: index + 1 }))
const ageItems = Array.from({ length: 5 }, (_, index) => ({ label: String(index + 4), value: index + 4 }))

async function save() {
  const wasOn = data.value?.autoLeave === true
  const answer: { settings?: SchoolSettingsDto } = {}
  const ok = await run(async () => {
    answer.settings = await $fetch<SchoolSettingsDto>('/api/school-settings', {
      method: 'PUT', body: { cutoffMonth: month.value, cutoffDay: day.value, ageYears: age.value },
    })
  }, de.common.saved)
  // Another cutoff changes whom the automatic leaving takes, so the server switched it off.
  if (ok && wasOn && answer.settings && !answer.settings.autoLeave) notifySwitchedOff()
}

// Switching on: the preview is loaded first, the dialog lists it and sends exactly this list back with the confirmation.
const dialogOpen = ref(false)
const leavers = ref<SchoolLeaverDto[]>([])
async function loadPreview(): Promise<boolean> {
  try {
    leavers.value = await $fetch<SchoolLeaverDto[]>('/api/school-settings/auto-leave-preview')
    return true
  }
  catch (error) {
    toast.add({ title: errorMessage(error), color: 'error' })
    return false
  }
}

/** Switch off needs no confirmation; switch on asks first (the switch itself only follows the stored value). */
async function toggle(value: boolean) {
  if (!value) {
    await run(() => $fetch<unknown>('/api/school-settings/auto-leave', { method: 'PUT', body: { value: false } }), de.common.saved)
    return
  }
  await run(async () => {
    if (await loadPreview()) dialogOpen.value = true
  })
}

async function confirmSwitchOn() {
  const confirmed = leavers.value.map(({ id, leftOn }) => ({ id, leftOn }))
  let deregistered = 0
  let failure: unknown
  const ok = await run(async () => {
    try {
      deregistered = (await $fetch<{ ok: boolean; deregistered: number }>('/api/school-settings/auto-leave', { method: 'PUT', body: { value: true, confirmed } })).deregistered
    }
    catch (error) {
      failure = error
      throw error
    }
  })
  if (ok) {
    dialogOpen.value = false
    toast.add({ title: deregistered > 0 ? s.deregistered(deregistered) : de.common.saved, color: 'success' })
  }
  // The list changed meanwhile: show the new one and ask again (the dialog stays open).
  else if (errorCode(failure) === 'auto_leave_preview_changed') await loadPreview()
}

</script>

<template>
  <section v-if="data" class="space-y-2 rounded-lg bg-white p-4 ring-1 ring-gray-200">
    <h2 class="font-semibold">{{ s.title }}</h2>
    <form v-if="isProvider" class="flex flex-wrap items-end gap-3" @submit.prevent="save">
      <UFormField :label="s.cutoff">
        <span class="flex items-center gap-2">
          <UInput v-model.number="day" type="number" min="1" max="31" step="1" class="w-20" :aria-label="s.day" required />
          <USelect v-model="month" :items="monthItems" class="w-36" :aria-label="s.month" />
        </span>
      </UFormField>
      <UFormField :label="s.age"><USelect v-model="age" :items="ageItems" class="w-24" /></UFormField>
      <UButton type="submit" :label="de.common.save" :loading="busy" :disabled="busy" />
    </form>
    <template v-else>
      <dl class="flex flex-wrap gap-x-8 gap-y-1 text-sm">
        <div><dt class="text-xs text-gray-500">{{ s.cutoff }}</dt><dd>{{ data.cutoffDay }}. {{ de.months[data.cutoffMonth - 1] }}</dd></div>
        <div><dt class="text-xs text-gray-500">{{ s.age }}</dt><dd>{{ data.ageYears }}</dd></div>
      </dl>
      <p class="text-xs text-gray-500">{{ s.readOnly }}</p>
    </template>
    <p class="text-xs text-gray-500">{{ s.hint }}</p>
    <p class="text-xs text-gray-500">{{ s.hintBirthday }}</p>

    <div class="space-y-1 border-t border-gray-100 pt-3">
      <USwitch v-if="isProvider" :model-value="data.autoLeave" :label="s.autoLeave" :disabled="busy" @update:model-value="toggle" />
      <template v-else>
        <h3 class="text-sm font-medium">{{ s.autoLeave }}</h3>
        <p class="text-sm">{{ data.autoLeave ? s.autoLeaveOn : s.autoLeaveOff }}</p>
      </template>
      <p class="text-xs text-gray-500">{{ s.autoLeaveHint }}</p>
    </div>

    <UModal v-model:open="dialogOpen" :title="s.autoLeave">
      <template #body>
        <p v-if="!leavers.length" class="text-sm">{{ s.previewNone }}</p>
        <div v-else class="space-y-2 text-sm">
          <p>{{ s.preview(leavers.length) }}</p>
          <ul class="max-h-64 list-disc space-y-0.5 overflow-y-auto pl-5">
            <li v-for="leaver in leavers" :key="leaver.id">{{ leaver.name }} <span class="text-gray-500">({{ de.childLifecycle.leavesOn(formatDate(leaver.leftOn)) }})</span></li>
          </ul>
        </div>
      </template>
      <template #footer>
        <div class="flex w-full justify-end gap-2">
          <UButton color="neutral" variant="ghost" :label="de.common.cancel" :disabled="busy" @click="dialogOpen = false" />
          <UButton :label="s.switchOn" :loading="busy" :disabled="busy" @click="confirmSwitchOn" />
        </div>
      </template>
    </UModal>
  </section>
</template>
