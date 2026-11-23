<script setup lang="ts">
import { isValidIsoDate } from '#shared/domain/dates'
import {
  PARENTAL_LEAVE_DURATION_MAX_MONTHS, PARENTAL_LEAVE_NOTE_MAX, PARENTAL_LEAVE_PART_TIME_MAX_MINUTES, parentalLeaveEnd, parentalLeaveLength,
} from '#shared/domain/parentalLeave'
import type {
  EmployeeParentalLeaveDto, ParentalLeaveCheckDto, ParentalLeaveDto, ParentalLeaveInput, ParentalLeaveSaveDto,
} from '#shared/types/api'
import { de } from '~/locales/de'
import { errorMessage } from '~/utils/errors'
import { formatDate, formatNumber } from '~/utils/format'
import { formatWeekdayDate, lengthText } from '~/utils/parentalLeave'
import { workdaysText } from '~/utils/workdays'

/**
 * „Elternzeit“ in the tab „Vertrag & Lohn“ (contract data: shown with employees.contractView, entered with
 * employees.contractEdit): the periods with the first working day after them, and the dialog „Elternzeit eintragen“
 * (child, start, duration in months or end, part time with its working days, leave cut, note) with the server's check
 * before saving: what refuses saving, the hints (sections, months per child and after the 3rd birthday), the first
 * working day after and the entries already planned.
 */
const props = defineProps<{ employeeId: number }>()
const t = de.parentalLeave
const { data, error, refresh } = useFetch<EmployeeParentalLeaveDto>(`/api/employees/${props.employeeId}/parental-leaves`, { server: false })
const { busy, run } = useBusyAction(() => refresh())
const confirm = useConfirm()
const toast = useToast()
const loadError = computed(() => (error.value ? errorMessage(error.value) : null))

const childLine = (item: ParentalLeaveDto) => t.childLabel(item.childName, formatDate(item.childBirthDate))

// ---- the dialog ----
const OTHER = 'other'
interface Form {
  child: string; birthDate: string; start: string; mode: 'months' | 'end'; months: number | null; end: string
  partTime: boolean; partTimeHours: number | null; partTimeWorkdays: number; reduceLeave: boolean; note: string
}
const formOpen = ref(false)
const editing = ref<ParentalLeaveDto | null>(null)
const emptyForm = (): Form => ({
  child: data.value?.children.at(-1) ? String(data.value.children.at(-1)!.id) : OTHER, birthDate: '', start: '', mode: 'months',
  months: 12, end: '', partTime: false, partTimeHours: null, partTimeWorkdays: data.value?.contractWorkdays ?? 0b0011111,
  reduceLeave: false, note: '',
})
const form = reactive<Form>(emptyForm())
const childItems = computed(() => [
  ...(data.value?.children ?? []).map(child => ({ label: t.childLabel(child.firstName, formatDate(child.birthDate)), value: String(child.id) })),
  { label: t.childOther, value: OTHER },
])
const modeItems = [{ label: t.byMonths, value: 'months' }, { label: t.byEnd, value: 'end' }]

const childBirthDate = computed(() => form.child === OTHER
  ? form.birthDate
  : data.value?.children.find(child => String(child.id) === form.child)?.birthDate ?? '')
/** The end: computed from the months (start + n months − 1 day) or entered. */
const end = computed(() => {
  if (form.mode === 'end') return form.end
  const months = Number(form.months)
  return isValidIsoDate(form.start) && Number.isInteger(months) && months >= 1 ? parentalLeaveEnd(form.start, months) : ''
})

function openForm(item?: ParentalLeaveDto) {
  editing.value = item ?? null
  Object.assign(form, item
    ? {
        child: item.childId !== null && data.value?.children.some(child => child.id === item.childId) ? String(item.childId) : OTHER,
        birthDate: item.childBirthDate, start: item.start, mode: parentalLeaveLength(item.start, item.end).days === 0 ? 'months' : 'end',
        months: parentalLeaveLength(item.start, item.end).months, end: item.end, partTime: item.partTimeWeeklyMinutes !== null,
        partTimeHours: item.partTimeWeeklyMinutes === null ? null : item.partTimeWeeklyMinutes / 60,
        partTimeWorkdays: item.partTimeWorkdays ?? data.value?.contractWorkdays ?? 0b0011111, reduceLeave: item.reduceLeave, note: item.note,
      }
    : emptyForm())
  check.value = null
  formOpen.value = true
}

const body = (): ParentalLeaveInput => ({
  childId: form.child === OTHER ? null : Number(form.child), childBirthDate: childBirthDate.value, start: form.start, end: end.value,
  partTimeWeeklyMinutes: form.partTime && form.partTimeHours !== null ? Math.round(Number(form.partTimeHours) * 60) : null,
  partTimeWorkdays: form.partTime ? form.partTimeWorkdays : null,
  reduceLeave: form.reduceLeave && !form.partTime, note: form.note,
})

// The server's check, whenever the period changes (debounced); the start is suggested once the birth is known.
const check = ref<ParentalLeaveCheckDto | null>(null)
let checkTimer: ReturnType<typeof setTimeout> | undefined
const checkable = computed(() => isValidIsoDate(childBirthDate.value) && isValidIsoDate(form.start || childBirthDate.value)
  && (end.value === '' || isValidIsoDate(end.value)))
watch(() => [formOpen.value, childBirthDate.value, form.start, end.value, form.partTime, form.partTimeHours, form.partTimeWorkdays], () => {
  clearTimeout(checkTimer)
  if (!formOpen.value || !checkable.value) return
  checkTimer = setTimeout(async () => {
    const start = form.start || childBirthDate.value
    try {
      check.value = await $fetch<ParentalLeaveCheckDto>(`/api/employees/${props.employeeId}/parental-leaves/check`, {
        method: 'POST', body: { ...body(), start, end: end.value || start, exceptId: editing.value?.id ?? null },
      })
      if (!form.start && check.value) form.start = check.value.suggestedStart
    }
    catch {
      check.value = null
    }
  }, 300)
})
onBeforeUnmount(() => clearTimeout(checkTimer))

const errorText = computed(() => (check.value?.error && form.start && end.value ? de.errors[`parental_leave_${check.value.error}`] : null))
const hintTexts = computed(() => (check.value?.hints ?? []).map(hint => (hint === 'sections'
  ? t.hints.sections(check.value!.sections)
  : hint === 'total' ? t.hints.total(formatNumber(check.value!.totalMonths)) : t.hints.afterThird(formatNumber(check.value!.monthsAfterThird)))))
const ready = computed(() => isValidIsoDate(childBirthDate.value) && isValidIsoDate(form.start) && isValidIsoDate(end.value)
  && (!form.partTime || (Number(form.partTimeHours) > 0 && Number(form.partTimeHours) * 60 <= PARENTAL_LEAVE_PART_TIME_MAX_MINUTES
    && form.partTimeWorkdays > 0)))

async function save() {
  if (!ready.value) return
  const before = editing.value
  let saved: ParentalLeaveSaveDto | null = null
  const ok = await run(async () => {
    saved = before === null
      ? await $fetch<ParentalLeaveSaveDto>(`/api/employees/${props.employeeId}/parental-leaves`, { method: 'POST', body: body() })
      : await $fetch<ParentalLeaveSaveDto>(`/api/parental-leaves/${before.id}`, { method: 'PUT', body: body() })
  }, de.common.saved)
  if (!ok) return
  formOpen.value = false
  const entries = (saved as ParentalLeaveSaveDto | null)?.entries ?? []
  if (entries.length) toast.add({ title: t.entriesWarning(entries.length), description: entries.slice(0, 5).map(entry => formatDate(entry.date)).join(', '), color: 'warning' })
}

async function remove(item: ParentalLeaveDto) {
  if (!await confirm(t.removeConfirm, { confirmLabel: t.remove })) return
  await run(() => $fetch<{ ok: boolean }>(`/api/parental-leaves/${item.id}`, { method: 'DELETE' }), t.removed)
}
</script>

<template>
  <section class="space-y-4 rounded-lg bg-white p-4 ring-1 ring-gray-200">
    <div class="flex flex-wrap items-start gap-3">
      <div class="min-w-0 flex-1">
        <h2 class="font-semibold">{{ t.title }}</h2>
        <p class="text-sm text-gray-500">{{ t.intro }}</p>
      </div>
      <UButton v-if="data?.canEdit" icon="i-lucide-plus" :label="t.add" :disabled="busy" @click="openForm()" />
    </div>
    <UAlert v-if="loadError" color="error" variant="soft" :title="loadError" />
    <p v-else-if="!data" class="text-sm text-gray-500">{{ t.loading }}</p>
    <template v-else>
      <template v-if="data.levelShift">
        <p class="text-sm text-gray-700">{{ t.levelShift(data.levelShift.level, formatDate(data.levelShift.on), data.levelShift.days) }}</p>
        <UAlert v-for="hint in data.levelShift.hints" :key="hint" color="warning" variant="soft" :title="t.levelHints[hint]" />
      </template>
      <p v-if="!data.periods.length" class="text-sm text-gray-600">{{ t.none }}</p>
      <div v-for="item in data.periods" :key="item.id" class="space-y-1 rounded-md p-3 text-sm ring-1 ring-gray-200">
        <div class="flex flex-wrap items-center gap-2">
          <p class="font-medium">{{ t.periodLine(formatDate(item.start), formatDate(item.end), lengthText(item.start, item.end)) }}</p>
          <span class="text-xs text-gray-500">{{ childLine(item) }}</span>
          <div v-if="data.canEdit" class="ml-auto flex gap-1">
            <UButton size="xs" color="neutral" variant="ghost" icon="i-lucide-pencil" :aria-label="t.edit" :disabled="busy" @click="openForm(item)" />
            <UButton size="xs" color="error" variant="ghost" icon="i-lucide-trash-2" :aria-label="t.remove" :disabled="busy" @click="remove(item)" />
          </div>
        </div>
        <p class="font-medium text-sky-800">
          {{ item.firstWorkingDay ? t.firstWorkingDay(formatWeekdayDate(item.firstWorkingDay)) : t.noFirstWorkingDay }}
        </p>
        <ul class="space-y-0.5 text-gray-700">
          <li>
            {{ item.partTimeWeeklyMinutes === null ? t.fullLine : t.partTimeLine(formatNumber(item.partTimeWeeklyMinutes / 60)) }}
            <template v-if="item.partTimeWorkdays">{{ t.workdaysLine(workdaysText(item.partTimeWorkdays)) }}</template>
          </li>
          <li v-if="item.reduceLeave">{{ t.reduceLine }}</li>
          <li v-if="item.note" class="whitespace-pre-line break-words text-gray-600">{{ item.note }}</li>
          <li class="text-xs text-gray-500">{{ t.createdBy(item.createdBy) }}</li>
        </ul>
      </div>
    </template>

    <UModal v-model:open="formOpen" :title="editing === null ? t.add : t.editTitle">
      <template #body>
        <form class="grid gap-3" @submit.prevent="save">
          <UFormField :label="t.child" required>
            <USelect v-model="form.child" :items="childItems" class="w-full" />
          </UFormField>
          <UFormField v-if="form.child === OTHER" :label="t.birthDate" required>
            <DateTextInput v-model="form.birthDate" :label="t.birthDate" required class="w-44" />
          </UFormField>
          <UFormField :label="t.start" :help="t.startHint" required>
            <DateTextInput v-model="form.start" :label="t.start" required class="w-44" />
          </UFormField>
          <UButton
            v-if="check && check.suggestedStart !== form.start" type="button" size="xs" color="neutral" variant="link" class="justify-self-start"
            :label="t.useSuggestion(formatDate(check.suggestedStart))" @click="form.start = check.suggestedStart"
          />
          <UFormField :label="t.durationMode">
            <URadioGroup v-model="form.mode" :items="modeItems" orientation="horizontal" />
          </UFormField>
          <UFormField v-if="form.mode === 'months'" :label="t.months" required>
            <UInput v-model.number="form.months" type="number" min="1" :max="PARENTAL_LEAVE_DURATION_MAX_MONTHS" step="1" class="w-32" />
          </UFormField>
          <UFormField v-else :label="t.end" required>
            <DateTextInput v-model="form.end" :label="t.end" required class="w-44" />
          </UFormField>
          <p v-if="form.start && end" class="text-sm text-gray-700">
            {{ form.mode === 'months' ? t.endComputed(formatDate(end)) : lengthText(form.start, end) }}
          </p>
          <UCheckbox v-model="form.partTime" :label="t.partTime" />
          <template v-if="form.partTime">
            <UFormField :label="t.partTimeHours" :help="t.partTimeHint" required>
              <UInput v-model.number="form.partTimeHours" type="number" min="0.25" max="32" step="0.25" class="w-32" />
            </UFormField>
            <UFormField :label="t.partTimeWorkdays" :help="t.partTimeWorkdaysHint" required>
              <WorkdayPicker v-model="form.partTimeWorkdays" />
            </UFormField>
          </template>
          <UCheckbox v-else v-model="form.reduceLeave" :label="t.reduceLeave" :description="t.reduceLeaveHint" />
          <UFormField :label="t.note">
            <UTextarea v-model="form.note" :rows="2" :maxlength="PARENTAL_LEAVE_NOTE_MAX" autoresize class="w-full" />
          </UFormField>
          <p v-if="check && form.start && end" class="text-sm font-medium text-sky-800">
            {{ check.firstWorkingDay ? t.firstWorkingDay(formatWeekdayDate(check.firstWorkingDay)) : t.noFirstWorkingDay }}
          </p>
          <UAlert v-if="errorText" color="error" variant="soft" :title="errorText" />
          <UAlert v-for="hint in hintTexts" :key="hint" color="warning" variant="soft" :title="hint" />
          <UAlert v-if="check && check.entries.length" color="warning" variant="soft" :title="t.entriesWarning(check.entries.length)">
            <template #description>
              <ul class="text-xs">
                <li v-for="entry in check.entries.slice(0, 10)" :key="`${entry.date}-${entry.label}`">{{ formatDate(entry.date) }}: {{ entry.label }}</li>
                <li v-if="check.entries.length > 10">{{ t.entriesMore(check.entries.length - 10) }}</li>
              </ul>
            </template>
          </UAlert>
          <details class="text-xs text-gray-600">
            <summary class="cursor-pointer font-medium">{{ t.deadlinesTitle }}</summary>
            <ul class="mt-1 list-disc space-y-1 pl-4">
              <li v-for="line in t.deadlines" :key="line">{{ line }}</li>
            </ul>
          </details>
          <div class="flex gap-2">
            <UButton type="submit" :label="de.common.save" :loading="busy" :disabled="busy || !ready || !!errorText" />
            <UButton type="button" color="neutral" variant="ghost" :label="de.common.cancel" @click="formOpen = false" />
          </div>
        </form>
      </template>
    </UModal>
  </section>
</template>
