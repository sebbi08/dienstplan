<script setup lang="ts">
import { formatDuration, parseTime } from '#shared/domain/time'
import { shiftBreakCheck } from '#shared/domain/timeRecords'
import type { SettingsDto, ShiftChangeResult, TemplateDto } from '#shared/types/api'
import { de } from '~/locales/de'
import { builtRows, mergeRows, optionalTime, timeKey, timeText } from '~/utils/settingsForms'

/** Einstellungen → Dienstplan → Dienst-Buttons: the services with their times and breaks (listed by start time); a row saves on its own. */
interface TemplateForm {
  id: number | null; shortLabel: string; label: string; start: string; end: string
  breakStart: string; breakEnd: string; countsAsStaff: boolean; pairsWithPrepTime: boolean
}

const { data: settings, refresh } = await useFetch<SettingsDto>('/api/settings', { key: 'settings' })
const run = useAction(refresh)
const toast = useToast()
const confirm = useConfirm()

const emptyTemplate = (): TemplateForm => ({ id: null, shortLabel: '', label: '', start: '', end: '', breakStart: '', breakEnd: '', countsAsStaff: true, pairsWithPrepTime: false })
const templates = ref<TemplateForm[]>([])
const newTemplate = ref(emptyTemplate())
// Any save on the page reloads the shared settings: rows with unsaved edits keep them unless they were just saved.
let built = new Map<number, string>()
const justSaved = new Set<number>()
watch(settings, (value) => {
  const fresh = (value?.templates ?? []).map((t: TemplateDto): TemplateForm => ({
    id: t.id, shortLabel: t.shortLabel, label: t.label, start: timeText(t.start), end: timeText(t.end),
    breakStart: timeText(t.breakStart), breakEnd: timeText(t.breakEnd), countsAsStaff: t.countsAsStaff,
    pairsWithPrepTime: t.pairsWithPrepTime,
  }))
  templates.value = mergeRows(templates.value, built, fresh, justSaved)
  built = builtRows(fresh)
  justSaved.clear()
}, { immediate: true })

/** A row differs from the stored service (times compared as times, so "8:00" and "800" are the same). */
function rowDirty(form: TemplateForm): boolean {
  if (!form.id) return !sameValue(form, emptyTemplate())
  const saved = settings.value?.templates.find(template => template.id === form.id)
  if (!saved) return false
  return !sameValue(
    [form.shortLabel, form.label, timeKey(form.start), timeKey(form.end), timeKey(form.breakStart), timeKey(form.breakEnd), form.countsAsStaff, form.pairsWithPrepTime],
    [saved.shortLabel, saved.label, saved.start, saved.end, saved.breakStart, saved.breakEnd, saved.countsAsStaff, saved.pairsWithPrepTime],
  )
}
useDirty(() => [...templates.value, newTemplate.value].some(rowDirty))

/** Working time of the (possibly unsaved) shift and the break § 4 ArbZG requires for it; '–' while times are incomplete. */
function breakInfo(form: TemplateForm): { worked: string; text: string; ok: boolean } {
  const start = parseTime(form.start)
  const end = parseTime(form.end)
  const breakStart = optionalTime(form.breakStart)
  const breakEnd = optionalTime(form.breakEnd)
  if (start === null || end === null || end <= start || breakStart === undefined || breakEnd === undefined) {
    return { worked: '–', text: '', ok: true }
  }
  const check = shiftBreakCheck({ start, end, breakStart: breakEnd === null ? null : breakStart, breakEnd: breakStart === null ? null : breakEnd })
  return { worked: `${formatDuration(check.worked)} h`, text: de.settings.legalBreakText(check.required, check.ok), ok: check.ok }
}

async function saveTemplate(form: TemplateForm) {
  if (!rowDirty(form)) return
  const start = parseTime(form.start)
  const end = parseTime(form.end)
  const breakStart = optionalTime(form.breakStart)
  const breakEnd = optionalTime(form.breakEnd)
  if (start === null || end === null || breakStart === undefined || breakEnd === undefined) {
    return void toast.add({ title: de.settings.invalidTime, color: 'error' })
  }
  const body = {
    shortLabel: form.shortLabel, label: form.label, start, end, breakStart, breakEnd,
    countsAsStaff: form.countsAsStaff, pairsWithPrepTime: form.pairsWithPrepTime,
  }
  if (!form.id) {
    if (await run(() => $fetch<unknown>('/api/shift-templates', { method: 'POST', body }), de.common.saved)) newTemplate.value = emptyTemplate()
    return
  }
  // Changed times: ask whether existing shifts (from a date on) and templates get them too.
  const saved = settings.value?.templates.find(template => template.id === form.id)
  const timesChanged = saved && [saved.start, saved.end, saved.breakStart, saved.breakEnd].join() !== [start, end, breakStart, breakEnd].join()
  const applyFrom = timesChanged ? await askShiftChange(form.shortLabel || form.label) : null
  if (applyFrom === undefined) return
  let result: ShiftChangeResult | undefined
  await run(async () => {
    result = await $fetch<ShiftChangeResult>(`/api/shift-templates/${form.id}`, { method: 'PUT', body: { ...body, applyFrom } })
    if (form.id) justSaved.add(form.id)
  })
  if (result) {
    toast.add({
      title: applyFrom ? de.settings.shiftChangeResult(result.updated, result.skipped, result.inTemplates) : de.common.saved,
      color: 'success',
    })
  }
}

const shiftChange = reactive<{ open: boolean; name: string; resolve: ((value: string | null | undefined) => void) | null }>({
  open: false, name: '', resolve: null,
})
/** Resolves with the date to adjust existing shifts from, null for "new entries only", undefined when cancelled. */
function askShiftChange(name: string): Promise<string | null | undefined> {
  return new Promise((resolve) => {
    Object.assign(shiftChange, { open: true, name, resolve })
  })
}
function settleShiftChange(value: string | null | undefined) {
  shiftChange.resolve?.(value)
  shiftChange.resolve = null
}
watch(() => shiftChange.open, (isOpen) => {
  if (!isOpen) settleShiftChange(undefined) // closed without a choice = cancel (no-op after a choice)
})

async function deleteTemplate(form: TemplateForm) {
  if (form.id && await confirm(de.common.confirmDelete)) run(() => $fetch<unknown>(`/api/shift-templates/${form.id}`, { method: 'DELETE' }), de.common.deleted)
}

const cell = 'px-1 py-1'
const textInput = 'w-full min-w-24 rounded border border-gray-300 px-1 py-0.5'
</script>

<template>
  <section class="space-y-2 rounded-lg bg-white p-4 ring-1 ring-gray-200">
    <h2 class="font-semibold">{{ de.settings.templates }}</h2>
    <div class="overflow-x-auto">
      <table class="w-full text-sm">
        <thead class="text-left text-xs text-gray-500">
          <tr>
            <th :class="cell">{{ de.settings.shortLabel }}</th><th :class="cell">{{ de.settings.label }}</th>
            <th :class="cell">{{ de.settings.start }}</th><th :class="cell">{{ de.settings.end }}</th>
            <th :class="cell">{{ de.settings.breakStart }}</th><th :class="cell">{{ de.settings.breakEnd }}</th>
            <th :class="cell">{{ de.settings.workingTime }}</th>
            <th :class="cell" :title="de.settings.legalBreakHint">{{ de.settings.legalBreak }}</th>
            <th :class="cell">{{ de.settings.countsAsStaff }}</th>
            <th :class="cell" :title="de.settings.pairsWithPrepTimeHint">{{ de.settings.pairsWithPrepTime }}</th>
            <th />
          </tr>
        </thead>
        <tbody>
          <tr v-for="form in [...templates, newTemplate]" :key="form.id ?? 'new'" class="border-t border-gray-100">
            <td :class="cell"><input v-model="form.shortLabel" maxlength="10" class="w-14 rounded border border-gray-300 px-1 py-0.5" :aria-label="de.settings.shortLabel"></td>
            <td :class="cell"><input v-model="form.label" maxlength="50" :class="textInput" :aria-label="de.settings.label"></td>
            <td :class="cell"><TimeInput v-model="form.start" class="w-20" :aria-label="de.settings.start" @keydown.enter="saveTemplate(form)" /></td>
            <td :class="cell"><TimeInput v-model="form.end" class="w-20" :aria-label="de.settings.end" @keydown.enter="saveTemplate(form)" /></td>
            <td :class="cell"><TimeInput v-model="form.breakStart" class="w-20" :aria-label="de.settings.breakStart" @keydown.enter="saveTemplate(form)" /></td>
            <td :class="cell"><TimeInput v-model="form.breakEnd" class="w-20" :aria-label="de.settings.breakEnd" @keydown.enter="saveTemplate(form)" /></td>
            <td :class="cell" class="whitespace-nowrap font-medium">{{ breakInfo(form).worked }}</td>
            <td :class="[cell, breakInfo(form).ok ? 'text-green-700' : 'font-medium text-red-700']" class="whitespace-nowrap">
              {{ breakInfo(form).text }}
            </td>
            <td :class="cell" class="text-center"><input v-model="form.countsAsStaff" type="checkbox" :aria-label="de.settings.countsAsStaff"></td>
            <td :class="cell" class="text-center"><input v-model="form.pairsWithPrepTime" type="checkbox" :title="de.settings.pairsWithPrepTimeHint" :aria-label="de.settings.pairsWithPrepTime"></td>
            <td :class="cell" class="whitespace-nowrap text-right">
              <UButton v-if="!form.id" size="xs" :label="de.settings.addTemplate" :disabled="!rowDirty(form)" @click="saveTemplate(form)" />
              <UButton v-else-if="rowDirty(form)" size="xs" :label="de.common.save" @click="saveTemplate(form)" />
              <UButton v-if="form.id" size="xs" color="error" variant="ghost" icon="i-lucide-trash-2" :aria-label="de.common.delete" @click="deleteTemplate(form)" />
            </td>
          </tr>
        </tbody>
      </table>
    </div>
    <p class="text-xs text-gray-500">{{ de.settings.legalBreakHint }}</p>
    <SettingsShiftChangeModal v-model:open="shiftChange.open" :name="shiftChange.name" @choose="settleShiftChange" />
  </section>
</template>
