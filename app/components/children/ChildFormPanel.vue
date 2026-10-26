<script setup lang="ts">
import { isValidIsoDate } from '#shared/domain/dates'
import { formatTime, parseTime } from '#shared/domain/time'
import type { ChildFormDto, ChildFormSavedDto } from '#shared/types/api'
import { de } from '~/locales/de'
import { errorMessage } from '~/utils/errors'
import { formatDate } from '~/utils/format'
import type { FormPanelSave } from '~/utils/forms'

/**
 * One open observation form in the record: its header (Datum, Uhrzeit, Teilnehmer) and the answers in the shared form
 * panel, editable when the API grants the viewer `edit` on this form, else shown to read. Header and answers are saved
 * together (with the updatedAt the form was loaded with); `dirty` tells the list whether anything is unsaved.
 * `refreshList` re-reads the list (for its „zuletzt geändert“) after a save.
 */
const props = defineProps<{ formId: number; refreshList: () => Promise<unknown> }>()
const emit = defineEmits<{ dirty: [value: boolean] }>()
const c = de.childForms

const { data: form, error, status, refresh } = useFetch<ChildFormDto>(`/api/child-forms/${props.formId}`, { key: `child-form-${props.formId}` })
const editable = computed(() => form.value?.right === 'edit')

const header = reactive({ date: '', start: '', participants: '' })
const savedHeader = ref('')
function resetHeader() {
  const value = form.value
  if (!value) return
  Object.assign(header, { date: value.date, start: value.start === null ? '' : formatTime(value.start), participants: value.participants })
  savedHeader.value = JSON.stringify(header)
}
// The header fields follow the first load (later loads reach them through the panel's `reset`).
const stopFirst = watch(form, (value) => {
  if (!value) return
  resetHeader()
  stopFirst()
}, { immediate: true })
const headerDirty = computed(() => JSON.stringify(header) !== savedHeader.value)

/** A valid date and, if given, a valid time; else the message the panel shows instead of saving. */
function check(): string | null {
  if (!isValidIsoDate(header.date)) return c.dateInvalid
  if (header.start.trim() && (parseTime(header.start) === null || parseTime(header.start)! > 1439)) return de.common.invalidTimeAnyMinute
  return null
}

const save: FormPanelSave = async (answers, expectedUpdatedAt) => {
  const sent = JSON.stringify(header)
  const saved = await $fetch<ChildFormSavedDto>(`/api/child-forms/${props.formId}`, {
    method: 'PUT',
    body: {
      date: header.date, start: header.start.trim() ? parseTime(header.start) : null, participants: header.participants,
      answers, expectedUpdatedAt,
    },
  })
  savedHeader.value = sent
  return saved
}
const refreshBoth = () => Promise.all([refresh(), props.refreshList()])

const headerLine = computed(() => {
  const value = form.value
  if (!value) return ''
  const day = value.date ? formatDate(value.date) : ''
  return [value.start === null ? day : `${day} ${c.atTime(formatTime(value.start))}`, value.participants].filter(Boolean).join(' · ')
})
</script>

<template>
  <div class="min-w-0 space-y-3">
    <p v-if="status === 'pending' && !form" class="text-sm text-gray-500">{{ c.loading }}</p>
    <p v-else-if="error || !form" class="text-sm text-red-700">{{ errorMessage(error) }}</p>
    <template v-else>
      <p v-if="!editable" class="flex gap-1.5 text-sm text-gray-600">
        <UIcon name="i-lucide-lock" class="mt-0.5 size-4 shrink-0 text-gray-400" />
        <span>{{ c.readOnly }}</span>
      </p>
      <FormsFormPanel
        :key="form.id" :form="form" :save="save" :editable="editable" :refresh="refreshBoth" :extra-dirty="headerDirty"
        :check="check" @reset="resetHeader" @dirty="emit('dirty', $event)"
      >
        <template #before>
          <div v-if="editable" class="grid gap-3 rounded-md bg-white p-3 ring-1 ring-gray-200 sm:grid-cols-[minmax(0,12rem)_minmax(0,8rem)_minmax(0,1fr)]">
            <UFormField :label="c.date" required>
              <DateTextInput v-model="header.date" :label="c.date" size="lg" class="w-full" required />
            </UFormField>
            <UFormField :label="c.start" :hint="c.startHint">
              <TimeInput v-model="header.start" any-minute size="lg" />
            </UFormField>
            <UFormField :label="c.participants">
              <UInput v-model="header.participants" maxlength="300" size="lg" :placeholder="c.participantsPlaceholder" class="w-full" />
            </UFormField>
          </div>
          <p v-else-if="headerLine" class="text-sm break-words text-gray-700">{{ headerLine }}</p>
        </template>
      </FormsFormPanel>
    </template>
  </div>
</template>
