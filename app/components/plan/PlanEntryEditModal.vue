<script setup lang="ts">
import { formatTime, parseTime, validateSpan } from '#shared/domain/time'
import type { TimeSpan } from '#shared/domain/time'
import { isTargetGapCode } from '#shared/domain/warnings'
import type { EntryDto, MonthPlanDto } from '#shared/types/api'
import { de } from '~/locales/de'

/**
 * Changes the times of one clicked entry; a fixed shift with other start/end becomes a special shift. With groups, a
 * working duty (shift, special shift, VZ, Büro) can also count for another group than the person's home group.
 * Emits the new times only when they changed and the group only when it changed (null = the home group again).
 */
const props = defineProps<{ entry: EntryDto | null; plan?: MonthPlanDto | null }>()
const open = defineModel<boolean>('open', { required: true })
const emit = defineEmits<{ submit: [id: number, times: TimeSpan | null, groupId: number | null | undefined] }>()

/** groupId 0 = the home group (the select needs a non-null value). */
const form = reactive({ start: '', end: '', breakStart: '', breakEnd: '', groupId: 0 })
const error = ref('')
const isBreak = computed(() => props.entry?.kind === 'break')
const title = computed(() => {
  const entry = props.entry
  if (!entry) return ''
  const name = entry.kind === 'break' ? de.plan.breakEntry(entry.label.slice(1, -1)) : [entry.shortLabel, entry.label].filter(Boolean).join(' ')
  return de.modal.editTitle(name)
})
const timeText = (minutes: number | null) => (minutes === null ? '' : formatTime(minutes))

// Absences and breaks belong to no group, so they never get the choice.
const groupable = computed(() => {
  const entry = props.entry
  if (!entry || !props.plan?.groups.length || entry.kind === 'break') return false
  return entry.kind !== 'code' || isTargetGapCode(entry.codeKey)
})
const homeGroupId = computed(() => props.plan?.employees.find(employee => employee.id === props.entry?.employeeId)?.groupId ?? null)
/** The select's value for a stored group: the home group is the first item (0), so it never shows blank. */
const selectValue = (groupId: number | null) => (groupId === null || groupId === homeGroupId.value ? 0 : groupId)
const groupItems = computed(() => {
  const groups = props.plan?.groups ?? []
  const home = groups.find(group => group.id === homeGroupId.value)
  return [
    { label: home ? de.groups.homeGroup(home.name) : de.groups.noGroup, value: 0 },
    ...groups.filter(group => group.id !== home?.id).map(group => ({ label: group.name, value: group.id })),
  ]
})

const becomesSpecial = computed(() => props.entry?.kind === 'shift'
  && (parseTime(form.start) !== props.entry.start || parseTime(form.end) !== props.entry.end))

watch(open, (isOpen) => {
  const entry = props.entry
  if (!isOpen || !entry) return
  Object.assign(form, {
    start: timeText(entry.start), end: timeText(entry.end),
    breakStart: timeText(entry.breakStart), breakEnd: timeText(entry.breakEnd),
    groupId: selectValue(entry.groupId),
  })
  error.value = ''
})

function submit() {
  if (!props.entry) return
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
  const breakStart = !isBreak.value && form.breakStart.trim() ? parseTime(form.breakStart) : null
  const breakEnd = !isBreak.value && form.breakEnd.trim() ? parseTime(form.breakEnd) : null
  const spanError = validateSpan({ start, end, breakStart, breakEnd })
  if (spanError) {
    error.value = de.spanErrors[spanError]
    return
  }
  const entry = props.entry
  const timesChanged = start !== entry.start || end !== entry.end
    || (!isBreak.value && (breakStart !== entry.breakStart || breakEnd !== entry.breakEnd))
  const groupId = groupable.value && form.groupId !== selectValue(entry.groupId) ? form.groupId || null : undefined
  // Nothing changed: save the times as before (the dialog has always done so).
  emit('submit', entry.id, timesChanged || groupId === undefined ? { start, end, breakStart, breakEnd } : null, groupId)
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
        <UFormField v-if="groupable" :label="de.groups.countsFor" class="col-span-2">
          <USelect v-model="form.groupId" :items="groupItems" class="w-full" />
        </UFormField>
        <p v-if="becomesSpecial" class="col-span-2 text-sm text-amber-700">{{ de.modal.becomesSpecial }}</p>
        <p v-if="error" class="col-span-2 text-sm text-red-600">{{ error }}</p>
        <div class="col-span-2 flex justify-end gap-2">
          <UButton color="neutral" variant="ghost" :label="de.common.cancel" @click="open = false" />
          <UButton type="submit" :label="de.common.save" />
        </div>
      </form>
    </template>
  </UModal>
</template>
