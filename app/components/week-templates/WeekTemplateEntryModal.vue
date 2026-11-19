<script setup lang="ts">
import { canBeHomeOffice, isWorkEntry } from '#shared/domain/balance'
import { formatDuration, formatTime, parseTime, validateSpan } from '#shared/domain/time'
import type { WeekTemplateEntryDto } from '#shared/types/api'
import { de } from '~/locales/de'
import { detachesFromButton, type TemplateEntryTimes } from '~/utils/weekTemplateEditor'
import { exceedsMaxDailyWith, workTime } from '~/utils/workTime'

/**
 * Changes the times of one clicked template entry, like the plan's entry dialog (PlanEntryEditModal): start, end, the
 * break, home office where allowed, with the live working time, legal break and § 3 ArbZG hints. A shift-button entry
 * with other times becomes a special shift of that day (detachesFromButton). Emits the times; the editor checks the
 * cell (editTemplateEntry) and keeps them in the draft until „Speichern“.
 */
const props = defineProps<{
  entry: WeekTemplateEntryDto | null
  /** The other entries of the entry's cell (for the § 3 ArbZG hint). */
  others: WeekTemplateEntryDto[]
}>()
const open = defineModel<boolean>('open', { required: true })
const emit = defineEmits<{ submit: [id: number, times: TemplateEntryTimes] }>()

const form = reactive({ start: '', end: '', breakStart: '', breakEnd: '', homeOffice: false })
const error = ref('')
const isBreak = computed(() => props.entry?.kind === 'break')
const homeOfficeAllowed = computed(() => props.entry !== null && isWorkEntry(props.entry) && canBeHomeOffice(props.entry.codeKey))
const hint = computed(() => (isBreak.value ? null : workTime(form)))
const overMaxDaily = computed(() => {
  const entry = props.entry
  if (!entry) return false
  const times = isBreak.value ? { ...form, breakStart: '', breakEnd: '' } : form
  return exceedsMaxDailyWith(times, { kind: entry.kind, creditMode: entry.creditMode, codeKey: entry.codeKey, homeOffice: form.homeOffice }, [props.others])
})
const title = computed(() => {
  const entry = props.entry
  if (!entry) return ''
  const name = entry.kind === 'break' ? de.plan.breakEntry(entry.label.slice(1, -1)) : [entry.shortLabel, entry.label].filter(Boolean).join(' ')
  return de.modal.editTitle(name)
})
const timeText = (minutes: number | null) => (minutes === null ? '' : formatTime(minutes))
const optional = (value: string) => (value.trim() ? parseTime(value) : null)
const detaches = computed(() => {
  const entry = props.entry
  const start = parseTime(form.start)
  const end = parseTime(form.end)
  if (!entry || start === null || end === null) return false
  return detachesFromButton(entry, { start, end, breakStart: optional(form.breakStart), breakEnd: optional(form.breakEnd) })
})

watch(open, (isOpen) => {
  const entry = props.entry
  if (!isOpen || !entry) return
  Object.assign(form, {
    start: timeText(entry.start), end: timeText(entry.end), breakStart: timeText(entry.breakStart), breakEnd: timeText(entry.breakEnd),
    homeOffice: entry.homeOffice,
  })
  error.value = ''
})

function submit() {
  const entry = props.entry
  if (!entry) return
  if ([form.start, form.end, form.breakStart, form.breakEnd].some(value => value.trim() && parseTime(value) === null)) {
    error.value = de.common.invalidTime
    return
  }
  const start = parseTime(form.start)
  const end = parseTime(form.end)
  if (start === null || end === null) {
    error.value = de.spanErrors.missing_times
    return
  }
  const breakStart = isBreak.value ? null : optional(form.breakStart)
  const breakEnd = isBreak.value ? null : optional(form.breakEnd)
  const spanError = validateSpan({ start, end, breakStart, breakEnd })
  if (spanError) {
    error.value = de.spanErrors[spanError]
    return
  }
  const homeOffice = homeOfficeAllowed.value && form.homeOffice !== entry.homeOffice ? form.homeOffice : undefined
  emit('submit', entry.id, homeOffice === undefined ? { start, end, breakStart, breakEnd } : { start, end, breakStart, breakEnd, homeOffice })
  open.value = false
}
</script>

<template>
  <UModal v-model:open="open" :title="title">
    <template #body>
      <form class="grid grid-cols-2 gap-3" @submit.prevent="submit">
        <UFormField :label="de.modal.start"><TimeInput v-model="form.start" autofocus /></UFormField>
        <UFormField :label="de.modal.end"><TimeInput v-model="form.end" /></UFormField>
        <template v-if="!isBreak">
          <UFormField :label="de.modal.breakStart"><TimeInput v-model="form.breakStart" /></UFormField>
          <UFormField :label="de.modal.breakEnd"><TimeInput v-model="form.breakEnd" /></UFormField>
          <p class="col-span-2 text-xs text-gray-500">{{ de.modal.editBreakHint }}</p>
        </template>
        <p v-if="hint" class="col-span-2 text-sm text-gray-700" aria-live="polite">
          {{ de.modal.workTime(formatDuration(hint.present), formatDuration(hint.worked)) }} ·
          <span :class="hint.ok ? 'text-green-700' : 'text-amber-700'">{{ de.modal.legalBreak(hint.required, hint.ok) }}</span>
        </p>
        <p v-if="overMaxDaily" class="col-span-2 text-sm text-amber-700" aria-live="polite">{{ de.modal.maxDailyHours }}</p>
        <UCheckbox
          v-if="homeOfficeAllowed" v-model="form.homeOffice" class="col-span-2" :label="de.modal.homeOffice"
          :description="de.modal.homeOfficeHint"
        />
        <p v-if="detaches" class="col-span-2 text-sm text-amber-700">{{ de.weekTemplates.editor.becomesSpecial }}</p>
        <p v-if="error" class="col-span-2 text-sm text-red-600">{{ error }}</p>
        <div class="col-span-2 flex flex-wrap justify-end gap-2">
          <UButton color="neutral" variant="ghost" :label="de.common.cancel" @click="open = false" />
          <UButton type="submit" :label="de.common.save" />
        </div>
      </form>
    </template>
  </UModal>
</template>
