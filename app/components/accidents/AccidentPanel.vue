<script setup lang="ts">
import { isValidIsoDate, todayIso } from '#shared/domain/dates'
import { formatTime, parseTime } from '#shared/domain/time'
import type { AccidentFormDto, AccidentSavedDto } from '#shared/types/api'
import { de } from '~/locales/de'
import { errorMessage } from '~/utils/errors'
import { formatDate } from '~/utils/format'
import type { FormPanelSave } from '~/utils/forms'

/**
 * One open accident report: its fixed header (Datum, Uhrzeit, Arztbesuch, for an employee „arbeitsunfähig“, „an
 * Unfallkasse gemeldet am“, which only Leitung/Träger set: `canReport`) and the answers in the shared form panel, editable
 * when the API grants `edit` (for anybody but Leitung/Träger only until the report is reported), else to read; header and
 * answers are saved together. Below: the attachments and, for an employee, the legal hint on the report.
 * `dirty` tells the list whether anything is unsaved; `refreshList` re-reads the list after a save.
 */
const props = defineProps<{
  formId: number
  /** e.g. /api/child-accidents or /api/employee-accidents. */
  formBase: string
  attachmentBase: string
  onTablet?: boolean
  archived?: boolean
  refreshList: () => Promise<unknown>
}>()
const emit = defineEmits<{ dirty: [value: boolean] }>()
const a = de.accidents

const { data: form, error, status, refresh } = useFetch<AccidentFormDto>(`${props.formBase}/${props.formId}`, {
  key: `accident-${props.formBase}-${props.formId}`,
})
const editable = computed(() => form.value?.right === 'edit')
const employee = computed(() => form.value?.subject === 'employee')

const header = reactive({ date: '', start: '', doctor: false, unfit: false, reportedOn: '' })
const savedHeader = ref('')
function resetHeader() {
  const value = form.value
  if (!value) return
  Object.assign(header, {
    date: value.date, start: value.start === null ? '' : formatTime(value.start), doctor: value.doctor, unfit: value.unfit,
    reportedOn: value.reportedOn ?? '',
  })
  savedHeader.value = JSON.stringify(header)
}
const stopFirst = watch(form, (value) => {
  if (!value) return
  resetHeader()
  stopFirst()
}, { immediate: true })
const headerDirty = computed(() => JSON.stringify(header) !== savedHeader.value)

/** A valid date not in the future, a valid time if given and a valid „gemeldet am“ if given; else the message. */
function check(): string | null {
  if (!isValidIsoDate(header.date) || header.date > todayIso()) return a.dateInvalid
  if (header.start.trim() && (parseTime(header.start) === null || parseTime(header.start)! > 1439)) return de.common.invalidTimeAnyMinute
  if (form.value?.canReport && header.reportedOn
    && (!isValidIsoDate(header.reportedOn) || header.reportedOn < header.date || header.reportedOn > todayIso())) return a.reportedInvalid
  return null
}

const save: FormPanelSave = async (answers, expectedUpdatedAt) => {
  const sent = JSON.stringify(header)
  const saved = await $fetch<AccidentSavedDto>(`${props.formBase}/${props.formId}`, {
    method: 'PUT',
    body: {
      date: header.date, start: header.start.trim() ? parseTime(header.start) : null, doctor: header.doctor,
      // Only Leitung/Träger set „gemeldet am“ (the server keeps the stored day for everybody else).
      unfit: employee.value && header.unfit, reportedOn: form.value?.canReport ? header.reportedOn || null : form.value?.reportedOn ?? null,
      answers, expectedUpdatedAt,
    },
  })
  savedHeader.value = sent
  return saved
}
const refreshBoth = () => Promise.all([refresh(), props.refreshList()])

const yesNo = (value: boolean) => (value ? a.yes : a.no)
const headerLine = computed(() => {
  const value = form.value
  if (!value) return ''
  const day = value.date ? formatDate(value.date) : ''
  return [
    value.start === null ? day : `${day} ${a.atTime(formatTime(value.start))}`,
    `${a.doctor}: ${yesNo(value.doctor)}`,
    ...(value.subject === 'employee' ? [`${a.unfit}: ${yesNo(value.unfit)}`] : []),
    value.reportedOn ? a.reported(formatDate(value.reportedOn)) : a.notReported,
  ].join(' · ')
})
</script>

<template>
  <div class="min-w-0 space-y-3">
    <p v-if="status === 'pending' && !form" class="text-sm text-gray-500">{{ a.loading }}</p>
    <p v-else-if="error || !form" class="text-sm text-red-700">{{ errorMessage(error) }}</p>
    <template v-else>
      <p v-if="!editable" class="flex gap-1.5 text-sm text-gray-600">
        <UIcon name="i-lucide-lock" class="mt-0.5 size-4 shrink-0 text-gray-400" />
        <span>{{ props.archived ? a.readOnlyArchived : a.readOnly }}</span>
      </p>
      <FormsFormPanel
        :key="form.id" :form="form" :save="save" :editable="editable" :refresh="refreshBoth" :extra-dirty="headerDirty"
        :check="check" @reset="resetHeader" @dirty="emit('dirty', $event)"
      >
        <template #before>
          <div v-if="editable" class="grid gap-3 rounded-md bg-white p-3 ring-1 ring-gray-200 sm:grid-cols-2 lg:grid-cols-3">
            <UFormField :label="a.date" required>
              <DateTextInput v-model="header.date" :label="a.date" :max="todayIso()" size="lg" class="w-full" required />
            </UFormField>
            <UFormField :label="a.start" :hint="a.startHint">
              <TimeInput v-model="header.start" any-minute size="lg" />
            </UFormField>
            <UFormField v-if="form.canReport" :label="a.reportedOn" :hint="a.reportedOnHint">
              <DateTextInput v-model="header.reportedOn" :label="a.reportedOn" :min="header.date || undefined" :max="todayIso()" size="lg" class="w-full" />
            </UFormField>
            <p v-else class="self-end text-sm text-gray-600">
              {{ form.reportedOn ? a.reported(formatDate(form.reportedOn)) : a.notReported }} · {{ a.reportedByManagers }}
            </p>
            <div class="flex flex-wrap items-center gap-x-6 gap-y-2 sm:col-span-2 lg:col-span-3">
              <UCheckbox v-model="header.doctor" class="min-h-11 items-center" :label="a.doctor" />
              <UCheckbox v-if="employee" v-model="header.unfit" class="min-h-11 items-center" :label="a.unfit" />
            </div>
          </div>
          <p v-else class="text-sm break-words text-gray-700">{{ headerLine }}</p>
        </template>
      </FormsFormPanel>
      <AccidentsAccidentAttachments
        :form-id="form.id" :attachments="form.attachments" :form-base="formBase" :attachment-base="attachmentBase"
        :editable="editable" :on-tablet="onTablet" :refresh="refresh"
      />
      <p v-if="employee" class="flex gap-1.5 text-xs text-gray-600">
        <UIcon name="i-lucide-info" class="mt-0.5 size-4 shrink-0 text-gray-400" />
        <span>{{ a.legalHint }}</span>
      </p>
    </template>
  </div>
</template>
