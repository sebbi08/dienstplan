<script setup lang="ts">
import type { EventAttendanceDto } from '#shared/types/api'
import { de } from '~/locales/de'
import { formatDate, formatDateSpan, formatDateTime } from '~/utils/format'

/**
 * „Teilnahme bestätigen“ of a Pflichttermin appointment (Leitung and Träger: employees.edit and calendar.edit): everyone
 * it is meant for, ticked – the first time all of them, later as saved. Saving enters the Pflichttermin for the ticked
 * people on the last day and takes it from the others where this appointment entered it (hand-entered ones stay).
 */
const props = defineProps<{ eventId: number | null }>()
const open = defineModel<boolean>('open', { required: true })
const emit = defineEmits<{ saved: [] }>()

const data = ref<EventAttendanceDto | null>(null)
const ticked = ref<number[]>([])
const loadError = ref(false)
const run = useAction()

watch([open, () => props.eventId], async ([isOpen, id]) => {
  if (!isOpen || id === null) return
  data.value = null
  loadError.value = false
  try {
    data.value = await $fetch<EventAttendanceDto>(`/api/calendar-events/${id}/attendance`)
    ticked.value = data.value.people.filter(person => person.attended).map(person => person.employeeId)
  }
  catch {
    loadError.value = true
  }
}, { immediate: true })

function toggle(id: number, on: boolean | 'indeterminate') {
  ticked.value = on === true ? [...new Set([...ticked.value, id])] : ticked.value.filter(item => item !== id)
}

const allTicked = computed(() => !!data.value && data.value.people.every(person => person.handEntered || ticked.value.includes(person.employeeId)))
function toggleAll() {
  if (!data.value) return
  ticked.value = allTicked.value ? data.value.people.filter(person => person.handEntered).map(person => person.employeeId) : data.value.people.map(person => person.employeeId)
}

async function save() {
  const current = data.value
  if (!current?.canConfirm) return
  const ok = await run(() => $fetch<unknown>(`/api/calendar-events/${current.eventId}/attendance`, {
    method: 'PUT', body: { employeeIds: ticked.value.filter(id => !current.people.find(person => person.employeeId === id)?.handEntered) },
  }), de.eventRequirements.saved)
  if (ok) {
    open.value = false
    emit('saved')
  }
}
</script>

<template>
  <UModal v-model:open="open" :title="de.eventRequirements.confirmTitle">
    <template #body>
      <p v-if="loadError" class="text-sm text-red-600">{{ de.eventRequirements.loadError }}</p>
      <p v-else-if="!data" class="text-sm text-gray-500">{{ de.eventRequirements.loading }}</p>
      <div v-else class="space-y-3">
        <div>
          <p class="font-medium">{{ data.title }}</p>
          <p class="text-sm text-gray-600">
            {{ de.eventRequirements.badge(data.typeName) }} ·
            {{ data.endDate ? formatDateSpan(data.date, data.endDate) : formatDate(data.date) }}
          </p>
        </div>
        <p v-if="!data.canConfirm" class="rounded-md bg-amber-50 p-2 text-sm text-amber-900 ring-1 ring-amber-200">
          {{ de.eventRequirements.notYet(formatDate(data.recordDate)) }}
        </p>
        <template v-else>
          <p class="text-sm text-gray-700">{{ de.eventRequirements.confirmHint(data.typeName, formatDate(data.recordDate)) }}</p>
          <p v-if="data.confirmedAt" class="rounded-md bg-sky-50 p-2 text-sm text-sky-900 ring-1 ring-sky-200">
            {{ de.eventRequirements.confirmedOn(formatDateTime(data.confirmedAt)) }}. {{ de.eventRequirements.reconfirmHint }}
          </p>
        </template>
        <p v-if="!data.people.length" class="text-sm text-gray-500">{{ de.eventRequirements.nobody }}</p>
        <fieldset v-else class="rounded-md bg-gray-50 p-2" :disabled="!data.canConfirm">
          <legend class="sr-only">{{ de.eventRequirements.confirmTitle }}</legend>
          <UButton
            v-if="data.canConfirm && data.people.length > 1" size="xs" color="neutral" variant="link" class="mb-1 px-0"
            :label="allTicked ? de.eventRequirements.untickAll : de.eventRequirements.tickAll" @click="toggleAll"
          />
          <div class="grid max-h-80 gap-1 overflow-y-auto sm:grid-cols-2">
            <UCheckbox
              v-for="person in data.people" :key="person.employeeId" class="min-h-9 items-center"
              :label="person.name"
              :description="[person.groupName, person.handEntered ? de.eventRequirements.handEntered : null].filter(Boolean).join(' · ') || undefined"
              :model-value="person.handEntered || ticked.includes(person.employeeId)"
              :disabled="person.handEntered || !data.canConfirm"
              @update:model-value="toggle(person.employeeId, $event)"
            />
          </div>
        </fieldset>
        <div class="flex gap-2">
          <UButton class="ml-auto" color="neutral" variant="ghost" :label="de.common.cancel" @click="open = false" />
          <UButton v-if="data.canConfirm" icon="i-lucide-user-check" :label="de.eventRequirements.confirm" @click="save" />
        </div>
      </div>
    </template>
  </UModal>
</template>
