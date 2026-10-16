<script setup lang="ts">
import { formatTime } from '#shared/domain/time'
import type { IsoDate } from '#shared/domain/types'
import type { AttendanceArriveInput, AttendanceChildDto } from '#shared/types/api'
import { de } from '~/locales/de'
import { nowClock, parseClock } from '~/utils/attendance'

/**
 * "Kommt" (spec §3.2): the time (now, changeable), the planned pickup (required; suggested is the end of the child's care
 * type) and, when the facility records it, who brought the child. Stays open when saving fails.
 */
const props = defineProps<{ child: AttendanceChildDto; date: IsoDate; recordBroughtBy: boolean; reload: () => Promise<unknown> }>()
const open = defineModel<boolean>('open', { default: false })
const { busy, run } = useBusyAction(() => props.reload())
const s = de.attendance

const form = reactive({ time: '', plannedPickup: '', broughtBy: '' })
const error = ref('')
watch(open, (value) => {
  if (!value) return
  const suggestion = props.child.plannedPickup ?? props.child.careEnd
  Object.assign(form, { time: nowClock(), plannedPickup: suggestion === null ? '' : formatTime(suggestion), broughtBy: props.child.broughtBy })
  error.value = ''
}, { immediate: true })

const fromCareType = computed(() => props.child.careEnd !== null && parseClock(form.plannedPickup) === props.child.careEnd)

async function save() {
  const time = parseClock(form.time)
  const plannedPickup = parseClock(form.plannedPickup)
  if (time === null) error.value = de.common.invalidTimeAnyMinute
  else if (plannedPickup === null) error.value = de.errors.planned_pickup_required
  else error.value = ''
  if (time === null || plannedPickup === null) return
  const body: AttendanceArriveInput = {
    childId: props.child.childId, date: props.date, time, plannedPickup, ...(props.recordBroughtBy ? { broughtBy: form.broughtBy } : {}),
  }
  if (await run(() => $fetch<unknown>('/api/attendance/arrive', { method: 'POST', body }))) open.value = false
}
</script>

<template>
  <UModal v-model:open="open" :title="s.arrive.title(child.name)">
    <template #body>
      <form class="space-y-4" @submit.prevent="save">
        <div class="grid grid-cols-2 gap-3">
          <UFormField :label="s.arrive.time" required><TimeInput v-model="form.time" any-minute size="xl" /></UFormField>
          <UFormField :label="s.plannedPickupLabel" required :help="fromCareType ? s.arrive.careEndHint : undefined">
            <TimeInput v-model="form.plannedPickup" any-minute size="xl" />
          </UFormField>
        </div>
        <UFormField v-if="recordBroughtBy" :label="s.arrive.broughtBy">
          <div class="space-y-2">
            <div v-if="child.bringOptions.length" class="flex flex-wrap gap-2">
              <UButton
                v-for="name in child.bringOptions" :key="name" type="button" size="lg" :label="name"
                :variant="form.broughtBy === name ? 'solid' : 'outline'" :color="form.broughtBy === name ? 'primary' : 'neutral'"
                @click="form.broughtBy = form.broughtBy === name ? '' : name"
              />
            </div>
            <UInput v-model="form.broughtBy" size="xl" maxlength="100" :placeholder="s.arrive.broughtByPlaceholder" class="w-full" />
          </div>
        </UFormField>
        <p v-if="error" class="text-sm text-red-600">{{ error }}</p>
        <div class="flex gap-2">
          <UButton type="submit" size="xl" icon="i-lucide-log-in" color="success" :label="s.arrive.submit" :loading="busy" :disabled="busy" />
          <UButton type="button" size="xl" color="neutral" variant="ghost" :label="de.common.cancel" :disabled="busy" @click="open = false" />
        </div>
      </form>
    </template>
  </UModal>
</template>
