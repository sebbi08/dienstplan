<script setup lang="ts">
import { formatTime } from '#shared/domain/time'
import type { IsoDate } from '#shared/domain/types'
import type { AttendanceChildDto, AttendanceDayInput, AttendancePickupChoice, AttendancePickupOption, AttendanceStayInput } from '#shared/types/api'
import { de } from '~/locales/de'
import { confirmedWithText, parseClock, pickupPersonText } from '~/utils/attendance'

/**
 * Corrects a stay of the day (spec §3.9): arrival, pickup time (empty = still here) and the pickup person (kept unless
 * another one is chosen, also "Andere Person" typed by hand; closing an open stay needs one), with the brought-by person
 * of the day when it is recorded.
 * A stay stamped by mistake can be deleted. Every change shows up in the history.
 */
const props = defineProps<{ child: AttendanceChildDto; stayId: number; date: IsoDate; recordBroughtBy: boolean; reload: () => Promise<unknown> }>()
const open = defineModel<boolean>('open', { default: false })
const { busy, run } = useBusyAction(() => props.reload())
const confirm = useConfirm()
const s = de.attendance

const stay = computed(() => props.child.stays.find(candidate => candidate.id === props.stayId))
/** The key of "Andere Person" among the choices. */
const OTHER = 'other'
const optionKey = (option: Pick<AttendancePickupOption, 'kind' | 'id'>) => `${option.kind}-${option.id}`
/** person '' = keep the person stored with the stay. */
const form = reactive({ arrived: '', left: '', person: '', otherName: '', confirmedWith: '', broughtBy: '' })
const error = ref('')
watch(open, (value) => {
  if (!value || !stay.value) return
  Object.assign(form, {
    arrived: formatTime(stay.value.arrived), left: stay.value.left === null ? '' : formatTime(stay.value.left), person: '',
    otherName: '', confirmedWith: '', broughtBy: props.child.broughtBy,
  })
  error.value = ''
}, { immediate: true })

const leaving = computed(() => form.left.trim() !== '')
/** The stored person as the list shows it ("Tante Uta (nicht hinterlegt)"), null for none. */
const keptPerson = computed(() => (stay.value ? pickupPersonText(stay.value) : null))
const keptConfirmedWith = computed(() => (stay.value ? confirmedWithText(stay.value) : ''))
/** A newly chosen person (undefined = keep the stored one; null = "Andere Person" without a name yet). */
const newPerson = computed<AttendancePickupChoice | null | undefined>(() => {
  if (form.person === OTHER) {
    return form.otherName.trim() ? { kind: 'other', name: form.otherName, confirmedWith: form.confirmedWith } : null
  }
  const option = props.child.pickupOptions.find(candidate => optionKey(candidate) === form.person)
  return option ? { kind: option.kind, id: option.id } : undefined
})

async function save() {
  const current = stay.value
  if (!current) return
  const arrived = parseClock(form.arrived)
  const left = leaving.value ? parseClock(form.left) : null
  const chosen = newPerson.value
  if (arrived === null || (leaving.value && left === null)) error.value = de.common.invalidTimeAnyMinute
  else if (left !== null && left < arrived) error.value = de.errors.leave_before_arrival
  else if (left !== null && (chosen === null || (chosen === undefined && keptPerson.value === null))) error.value = de.errors.pickup_person_required
  else error.value = ''
  if (error.value || arrived === null) return
  const pickup = left !== null && chosen ? chosen : undefined
  const body: AttendanceStayInput = { arrived, left, ...(pickup ? { pickup } : {}) }
  // Only what really changed is sent: the stay first, then the brought-by person of the day.
  const stayChanged = arrived !== current.arrived || left !== current.left || pickup !== undefined
  const broughtByChanged = props.recordBroughtBy && form.broughtBy.trim() !== props.child.broughtBy
  if (!stayChanged && !broughtByChanged) {
    open.value = false
    return
  }
  let staySaved = false
  const ok = await run(async () => {
    if (stayChanged) {
      await $fetch<unknown>(`/api/attendance/stays/${current.id}`, { method: 'PUT', body })
      staySaved = true
    }
    if (broughtByChanged) {
      const day: AttendanceDayInput = { childId: props.child.childId, date: props.date, broughtBy: form.broughtBy }
      await $fetch<unknown>('/api/attendance/day', { method: 'PUT', body: day })
    }
  }, de.common.saved)
  if (ok) {
    open.value = false
    return
  }
  // The stay was stored but the brought-by person was not: show the stored stay and keep the unsaved brought-by to retry.
  if (staySaved) {
    Object.assign(form, { person: '', otherName: '', confirmedWith: '' })
    await props.reload()
  }
}

// A stay removed meanwhile (e.g. deleted elsewhere) closes the dialog instead of leaving it empty.
watch(stay, (value) => {
  if (!value && open.value) open.value = false
})

async function remove() {
  const current = stay.value
  if (!current || !await confirm(s.stay.confirmDelete)) return
  if (await run(() => $fetch<unknown>(`/api/attendance/stays/${current.id}`, { method: 'DELETE' }), de.common.deleted)) open.value = false
}
</script>

<template>
  <UModal v-model:open="open" :title="s.stay.title(child.name)">
    <template #body>
      <form v-if="stay" class="space-y-4" @submit.prevent="save">
        <div class="grid grid-cols-2 gap-3">
          <UFormField :label="s.stay.arrived" required><TimeInput v-model="form.arrived" any-minute size="xl" /></UFormField>
          <UFormField :label="s.stay.left" :help="s.stay.leftHint"><TimeInput v-model="form.left" any-minute size="xl" /></UFormField>
        </div>
        <fieldset v-if="leaving" class="space-y-2">
          <legend class="mb-1 text-sm font-medium">{{ s.stay.person }}</legend>
          <div class="grid gap-2 sm:grid-cols-2" role="radiogroup">
            <UButton
              v-if="keptPerson !== null" type="button" size="xl" block role="radio" :aria-checked="form.person === ''"
              :variant="form.person === '' ? 'solid' : 'outline'" :color="form.person === '' ? 'primary' : 'neutral'"
              :label="s.stay.keepPerson(keptPerson)" @click="form.person = ''"
            />
            <UButton
              v-for="option in child.pickupOptions" :key="optionKey(option)" type="button" size="xl" block role="radio"
              :aria-checked="form.person === optionKey(option)"
              :variant="form.person === optionKey(option) ? 'solid' : 'outline'" :color="form.person === optionKey(option) ? 'primary' : 'neutral'"
              @click="form.person = optionKey(option)"
            >
              {{ option.name }}<span v-if="option.kind === 'announcement'" class="text-xs opacity-80">({{ s.leave.announced }})</span>
            </UButton>
            <UButton
              type="button" size="xl" block role="radio" :aria-checked="form.person === OTHER"
              :variant="form.person === OTHER ? 'solid' : 'outline'" :color="form.person === OTHER ? 'primary' : 'neutral'"
              :label="s.leave.other" @click="form.person = OTHER"
            />
          </div>
          <p v-if="keptConfirmedWith && form.person === ''" class="text-sm text-gray-600">{{ keptConfirmedWith }}</p>
          <ChildrenAttendanceOtherPerson v-if="form.person === OTHER" v-model:name="form.otherName" v-model:confirmed-with="form.confirmedWith" />
        </fieldset>
        <UFormField v-if="recordBroughtBy" :label="s.stay.broughtBy">
          <UInput v-model="form.broughtBy" size="xl" maxlength="100" class="w-full" />
        </UFormField>
        <p v-if="error" class="text-sm text-red-600">{{ error }}</p>
        <div class="flex flex-wrap gap-2">
          <UButton type="submit" size="xl" :label="de.common.save" :loading="busy" :disabled="busy" />
          <UButton type="button" size="xl" color="neutral" variant="ghost" :label="de.common.cancel" :disabled="busy" @click="open = false" />
          <UButton type="button" size="xl" color="error" variant="outline" class="ml-auto" icon="i-lucide-trash-2" :label="s.stay.delete" :disabled="busy" @click="remove" />
        </div>
      </form>
    </template>
  </UModal>
</template>
