<script lang="ts">
import type { SickLeaveMarkDto } from '#shared/types/api'

/** The day of one employee to mark, with its marker if it has one. */
export interface SickLeaveTarget {
  employeeId: number
  name: string
  date: string
  mark: SickLeaveMarkDto | null
}
</script>

<script setup lang="ts">
import { weekday } from '#shared/domain/dates'
import { formatTime, parseTime } from '#shared/domain/time'
import { de } from '~/locales/de'
import { formatDayShort } from '~/utils/format'

/**
 * "Im Dienst erkrankt": marks the duty of one day (plan and time page, managers only), changes the time of leaving
 * and the note, or removes the marker. Saves by itself and reports `done`, so the page reloads its data.
 */
const props = defineProps<{ target: SickLeaveTarget | null }>()
const open = defineModel<boolean>('open', { required: true })
const emit = defineEmits<{ done: [] }>()
const run = useAction()

const form = reactive({ leftAt: '', note: '' })
const error = ref('')
/** Removing asks once more inside this dialog (a second dialog would open behind it). */
const confirmingRemove = ref(false)
const title = computed(() => (props.target
  ? de.sickLeave.title(props.target.name, formatDayShort(props.target.date, weekday(props.target.date)))
  : ''))
/** The time the stamp clock gives while nothing is entered. */
const recordTime = computed(() => {
  const mark = props.target?.mark
  return mark?.leftAtFromRecord && mark.leftAt !== null ? formatTime(mark.leftAt) : null
})

watch(open, (isOpen) => {
  const mark = props.target?.mark
  if (!isOpen) return
  // A time taken from the stamp clock is not an entered one: the field stays empty, so it keeps following the clock.
  form.leftAt = mark && mark.leftAt !== null && !mark.leftAtFromRecord ? formatTime(mark.leftAt) : ''
  form.note = mark?.note ?? ''
  error.value = ''
  confirmingRemove.value = false
})

async function save() {
  const target = props.target
  if (!target) return
  const leftAt = form.leftAt.trim() ? parseTime(form.leftAt) : null
  if (form.leftAt.trim() && leftAt === null) {
    error.value = de.common.invalidTimeAnyMinute
    return
  }
  const body = { employeeId: target.employeeId, date: target.date, leftAt, note: form.note }
  if (!await run(() => $fetch<unknown>('/api/early-sick-leaves', { method: 'PUT', body }), de.common.saved)) return
  open.value = false
  emit('done')
}

async function remove() {
  const mark = props.target?.mark
  if (!mark) return
  if (!await run(() => $fetch<unknown>(`/api/early-sick-leaves/${mark.id}`, { method: 'DELETE' }), de.sickLeave.removed)) return
  open.value = false
  emit('done')
}
</script>

<template>
  <UModal v-model:open="open" :title="title">
    <template #body>
      <form class="space-y-3" @submit.prevent="save">
        <p class="text-sm text-gray-600">{{ de.sickLeave.hint }}</p>
        <UFormField :label="de.sickLeave.leftAt" :help="recordTime ? de.sickLeave.leftAtFromRecord(recordTime) : de.sickLeave.leftAtHelp">
          <TimeInput v-model="form.leftAt" any-minute autofocus class="w-32" />
        </UFormField>
        <UFormField :label="de.sickLeave.note">
          <UInput v-model="form.note" maxlength="200" class="w-full" />
        </UFormField>
        <p v-if="error" class="text-sm text-red-600">{{ error }}</p>
        <div v-if="confirmingRemove" class="space-y-2 rounded-md bg-red-50 p-3">
          <p class="text-sm text-red-800">{{ de.sickLeave.removeConfirm }}</p>
          <div class="flex justify-end gap-2">
            <UButton color="neutral" variant="ghost" :label="de.common.cancel" @click="confirmingRemove = false" />
            <UButton color="error" icon="i-lucide-trash-2" :label="de.sickLeave.remove" @click="remove" />
          </div>
        </div>
        <div v-else class="flex flex-wrap justify-end gap-2">
          <UButton
            v-if="target?.mark" class="mr-auto" color="error" variant="ghost" icon="i-lucide-trash-2"
            :label="de.sickLeave.remove" @click="confirmingRemove = true"
          />
          <UButton color="neutral" variant="ghost" :label="de.common.cancel" @click="open = false" />
          <UButton type="submit" :label="de.common.save" />
        </div>
      </form>
    </template>
  </UModal>
</template>
