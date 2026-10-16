<script setup lang="ts">
import type { IsoDate } from '#shared/domain/types'
import type { AttendanceChildDto, AttendanceLeaveInput, AttendancePickupChoice, AttendancePickupOption } from '#shared/types/api'
import { de } from '~/locales/de'
import { nowClock, parseClock } from '~/utils/attendance'

/**
 * "Geht" (spec §3.4): the time (now, not before the arrival) and who picks the child up — a contact allowed to, a
 * person announced for the day (the server never offers anybody with a contact ban) or "Andere Person", typed by hand
 * and marked "nicht hinterlegt". A contact ban of the child shows in red; without anybody registered, the dialog says
 * so and offers to announce a person.
 */
const props = defineProps<{ child: AttendanceChildDto; date: IsoDate; reload: () => Promise<unknown> }>()
const open = defineModel<boolean>('open', { default: false })
const emit = defineEmits<{ announce: [] }>()
const { busy, run } = useBusyAction(() => props.reload())
const s = de.attendance

/** The key of "Andere Person" among the choices. */
const OTHER = 'other'
const optionKey = (option: Pick<AttendancePickupOption, 'kind' | 'id'>) => `${option.kind}-${option.id}`
const form = reactive({ time: '', person: '', otherName: '', confirmedWith: '' })
const error = ref('')
watch(open, (value) => {
  if (!value) return
  // Nobody is preselected, not even a single person on offer: who picks the child up is chosen consciously.
  Object.assign(form, { time: nowClock(), person: '', otherName: '', confirmedWith: '' })
  error.value = ''
}, { immediate: true })

/** The chosen person; null until one of the offer is chosen or "Andere Person" has a name (submit stays off until then). */
const pickup = computed<AttendancePickupChoice | null>(() => {
  if (form.person === OTHER) {
    return form.otherName.trim() ? { kind: 'other', name: form.otherName, confirmedWith: form.confirmedWith } : null
  }
  const option = props.child.pickupOptions.find(candidate => optionKey(candidate) === form.person)
  return option ? { kind: option.kind, id: option.id } : null
})
const openStay = computed(() => props.child.stays.find(stay => stay.left === null))

async function save() {
  const time = parseClock(form.time)
  const person = pickup.value
  if (time === null) error.value = de.common.invalidTimeAnyMinute
  else if (openStay.value && time < openStay.value.arrived) error.value = de.errors.leave_before_arrival
  else if (!person) error.value = de.errors.pickup_person_required
  else error.value = ''
  if (error.value || time === null || !person) return
  const body: AttendanceLeaveInput = { childId: props.child.childId, date: props.date, time, pickup: person }
  if (await run(() => $fetch<unknown>('/api/attendance/leave', { method: 'POST', body }))) open.value = false
}
</script>

<template>
  <UModal v-model:open="open" :title="s.leave.title(child.name)">
    <template #body>
      <form class="space-y-4" @submit.prevent="save">
        <div v-if="child.hasContactBan" class="rounded-lg bg-red-50 p-3 text-red-800 ring-1 ring-red-300" role="alert">
          <p class="flex items-center gap-2 font-semibold"><UIcon name="i-lucide-ban" class="size-5" />{{ s.leave.contactBan }}</p>
          <p v-for="(note, index) in child.contactBanNotes" :key="index" class="mt-1 whitespace-pre-line">{{ note }}</p>
          <p v-if="!child.contactBanNotes.length" class="mt-1">{{ s.leave.contactBanGeneric }}</p>
        </div>
        <UFormField :label="s.leave.time" required class="w-40"><TimeInput v-model="form.time" any-minute size="xl" /></UFormField>
        <fieldset class="space-y-2">
          <legend class="mb-1 text-sm font-medium">{{ s.leave.person }}</legend>
          <div v-if="!child.pickupOptions.length" class="space-y-2 rounded-lg bg-amber-50 p-3 text-amber-900 ring-1 ring-amber-200">
            <p>{{ s.leave.noPerson }}</p>
            <UButton type="button" size="lg" color="neutral" variant="outline" icon="i-lucide-user-plus" :label="s.actions.announce" @click="emit('announce')" />
          </div>
          <div class="grid gap-2 sm:grid-cols-2" role="radiogroup">
            <UButton
              v-for="option in child.pickupOptions" :key="optionKey(option)" type="button" size="xl" block
              role="radio" :aria-checked="form.person === optionKey(option)"
              :variant="form.person === optionKey(option) ? 'solid' : 'outline'" :color="form.person === optionKey(option) ? 'primary' : 'neutral'"
              :icon="form.person === optionKey(option) ? 'i-lucide-circle-check' : 'i-lucide-circle'"
              @click="form.person = optionKey(option)"
            >
              {{ option.name }}<span v-if="option.kind === 'announcement'" class="text-xs opacity-80">({{ s.leave.announced }})</span>
            </UButton>
            <UButton
              type="button" size="xl" block role="radio" :aria-checked="form.person === OTHER"
              :variant="form.person === OTHER ? 'solid' : 'outline'" :color="form.person === OTHER ? 'primary' : 'neutral'"
              :icon="form.person === OTHER ? 'i-lucide-circle-check' : 'i-lucide-circle'" :label="s.leave.other"
              @click="form.person = OTHER"
            />
          </div>
          <ChildrenAttendanceOtherPerson
            v-if="form.person === OTHER" v-model:name="form.otherName" v-model:confirmed-with="form.confirmedWith"
            :no-pickup-contacts="child.noPickupContacts"
          />
        </fieldset>
        <p v-if="error" class="text-sm text-red-600">{{ error }}</p>
        <div class="flex gap-2">
          <UButton
            type="submit" size="xl" icon="i-lucide-log-out" :label="s.leave.submit" :loading="busy"
            :disabled="busy || !pickup"
          />
          <UButton type="button" size="xl" color="neutral" variant="ghost" :label="de.common.cancel" :disabled="busy" @click="open = false" />
        </div>
      </form>
    </template>
  </UModal>
</template>
