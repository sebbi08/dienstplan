<script setup lang="ts">
import { parseTime, toTimeInput } from '#shared/domain/time'
import type { CreditMode } from '#shared/domain/types'
import { COLOR_KEYS, type CodeDto, type CoverageRuleDto, type SettingsDto, type TemplateDto } from '#shared/types/api'
import { de } from '~/locales/de'

interface TemplateForm {
  id: number | null; shortLabel: string; label: string; start: string; end: string
  breakStart: string; breakEnd: string; countsAsStaff: boolean; sortOrder: number
}
interface RuleForm { id: number | null; label: string; start: string; end: string; minCount: number; active: boolean }

const { data: settings, refresh } = await useFetch<SettingsDto>('/api/settings')
const run = useAction(refresh)
const toast = useToast()
const confirm = useConfirm()

const timeText = (minutes: number | null) => (minutes === null ? '' : toTimeInput(minutes))
const optionalTime = (value: string) => (value ? parseTime(value) : null)

const emptyTemplate = (): TemplateForm => ({ id: null, shortLabel: '', label: '', start: '', end: '', breakStart: '', breakEnd: '', countsAsStaff: true, sortOrder: 99 })
const emptyRule = (): RuleForm => ({ id: null, label: '', start: '', end: '', minCount: 1, active: true })

const templates = ref<TemplateForm[]>([])
const codes = ref<CodeDto[]>([])
const rules = ref<RuleForm[]>([])
const newTemplate = ref(emptyTemplate())
const newRule = ref(emptyRule())

watch(settings, (value) => {
  templates.value = (value?.templates ?? []).map((t: TemplateDto) => ({
    id: t.id, shortLabel: t.shortLabel, label: t.label, start: timeText(t.start), end: timeText(t.end),
    breakStart: timeText(t.breakStart), breakEnd: timeText(t.breakEnd), countsAsStaff: t.countsAsStaff, sortOrder: t.sortOrder,
  }))
  codes.value = (value?.codes ?? []).map(code => ({ ...code }))
  rules.value = (value?.coverageRules ?? []).map((r: CoverageRuleDto) => ({
    id: r.id, label: r.label, start: timeText(r.start), end: timeText(r.end), minCount: r.minCount, active: r.active,
  }))
}, { immediate: true })

const colorItems = COLOR_KEYS.map(color => ({ label: de.colors[color], value: color }))
const creditItems = (['daily_target', 'timed', 'none'] as CreditMode[]).map(mode => ({ label: de.creditModes[mode], value: mode }))

function invalidTime() {
  toast.add({ title: de.settings.invalidTime, color: 'error' })
}

async function saveTemplate(form: TemplateForm) {
  const start = parseTime(form.start)
  const end = parseTime(form.end)
  if (start === null || end === null) return invalidTime()
  const body = {
    shortLabel: form.shortLabel, label: form.label, start, end,
    breakStart: optionalTime(form.breakStart), breakEnd: optionalTime(form.breakEnd),
    countsAsStaff: form.countsAsStaff, sortOrder: form.sortOrder,
  }
  const ok = await run(() => form.id
    ? $fetch<unknown>(`/api/shift-templates/${form.id}`, { method: 'PUT', body })
    : $fetch<unknown>('/api/shift-templates', { method: 'POST', body }), de.common.saved)
  if (ok && !form.id) newTemplate.value = emptyTemplate()
}

async function deleteTemplate(form: TemplateForm) {
  if (form.id && await confirm(de.common.confirmDelete)) run(() => $fetch<unknown>(`/api/shift-templates/${form.id}`, { method: 'DELETE' }), de.common.deleted)
}

async function saveCode(code: CodeDto) {
  const saved = settings.value?.codes.find(candidate => candidate.id === code.id)
  if (saved && saved.creditMode !== code.creditMode
    && !await confirm(de.settings.creditModeConfirm, { confirmLabel: de.common.save, danger: false })) return
  run(() => $fetch<unknown>(`/api/absence-codes/${code.id}`, {
    method: 'PUT', body: { label: code.label, color: code.color, creditMode: code.creditMode },
  }), de.common.saved)
}

async function saveRule(form: RuleForm) {
  const start = parseTime(form.start)
  if (start === null) return invalidTime()
  const body = { label: form.label, start, end: optionalTime(form.end), minCount: form.minCount, active: form.active }
  const ok = await run(() => form.id
    ? $fetch<unknown>(`/api/coverage-rules/${form.id}`, { method: 'PUT', body })
    : $fetch<unknown>('/api/coverage-rules', { method: 'POST', body }), de.common.saved)
  if (ok && !form.id) newRule.value = emptyRule()
}

async function deleteRule(form: RuleForm) {
  if (form.id && await confirm(de.common.confirmDelete)) run(() => $fetch<unknown>(`/api/coverage-rules/${form.id}`, { method: 'DELETE' }), de.common.deleted)
}

const cell = 'px-1 py-1'
const timeInput = 'w-24 rounded border border-gray-300 px-1 py-0.5'
const textInput = 'w-full rounded border border-gray-300 px-1 py-0.5'
</script>

<template>
  <div class="max-w-6xl space-y-6">
    <h1 class="text-2xl font-semibold">{{ de.settings.title }}</h1>

    <section class="space-y-2 rounded-lg bg-white p-4 ring-1 ring-gray-200">
      <h2 class="font-semibold">{{ de.settings.templates }}</h2>
      <div class="overflow-x-auto">
        <table class="w-full text-sm">
          <thead class="text-left text-xs text-gray-500">
            <tr>
              <th :class="cell">{{ de.settings.shortLabel }}</th><th :class="cell">{{ de.settings.label }}</th>
              <th :class="cell">{{ de.settings.start }}</th><th :class="cell">{{ de.settings.end }}</th>
              <th :class="cell">{{ de.settings.breakStart }}</th><th :class="cell">{{ de.settings.breakEnd }}</th>
              <th :class="cell">{{ de.settings.countsAsStaff }}</th><th :class="cell">{{ de.settings.sortOrder }}</th><th />
            </tr>
          </thead>
          <tbody>
            <tr v-for="form in [...templates, newTemplate]" :key="form.id ?? 'new'" class="border-t border-gray-100">
              <td :class="cell"><input v-model="form.shortLabel" maxlength="10" class="w-14 rounded border border-gray-300 px-1 py-0.5"></td>
              <td :class="cell"><input v-model="form.label" maxlength="50" :class="textInput"></td>
              <td :class="cell"><input v-model="form.start" type="time" step="300" :class="timeInput"></td>
              <td :class="cell"><input v-model="form.end" type="time" step="300" :class="timeInput"></td>
              <td :class="cell"><input v-model="form.breakStart" type="time" step="300" :class="timeInput"></td>
              <td :class="cell"><input v-model="form.breakEnd" type="time" step="300" :class="timeInput"></td>
              <td :class="cell" class="text-center"><input v-model="form.countsAsStaff" type="checkbox"></td>
              <td :class="cell"><input v-model.number="form.sortOrder" type="number" class="w-14 rounded border border-gray-300 px-1 py-0.5"></td>
              <td :class="cell" class="whitespace-nowrap text-right">
                <UButton size="xs" :label="form.id ? de.common.save : de.settings.addTemplate" @click="saveTemplate(form)" />
                <UButton v-if="form.id" size="xs" color="error" variant="ghost" icon="i-lucide-trash-2" :aria-label="de.common.delete" @click="deleteTemplate(form)" />
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>

    <section class="space-y-2 rounded-lg bg-white p-4 ring-1 ring-gray-200">
      <h2 class="font-semibold">{{ de.settings.codes }}</h2>
      <table class="w-full text-sm">
        <thead class="text-left text-xs text-gray-500">
          <tr><th :class="cell">{{ de.settings.label }}</th><th :class="cell">{{ de.settings.color }}</th><th :class="cell">{{ de.settings.creditMode }}</th><th /></tr>
        </thead>
        <tbody>
          <tr v-for="code in codes" :key="code.id" class="border-t border-gray-100">
            <td :class="cell"><input v-model="code.label" maxlength="50" :class="textInput"></td>
            <td :class="cell"><USelect v-model="code.color" :items="colorItems" class="w-32" /></td>
            <td :class="cell"><USelect v-model="code.creditMode" :items="creditItems" class="w-44" /></td>
            <td :class="cell" class="text-right"><UButton size="xs" :label="de.common.save" @click="saveCode(code)" /></td>
          </tr>
        </tbody>
      </table>
    </section>

    <section class="space-y-2 rounded-lg bg-white p-4 ring-1 ring-gray-200">
      <h2 class="font-semibold">{{ de.settings.rules }}</h2>
      <p class="text-xs text-gray-500">{{ de.settings.rulesHint }}</p>
      <table class="w-full text-sm">
        <thead class="text-left text-xs text-gray-500">
          <tr>
            <th :class="cell">{{ de.settings.label }}</th><th :class="cell">{{ de.settings.ruleStart }}</th>
            <th :class="cell">{{ de.settings.ruleEnd }}</th><th :class="cell">{{ de.settings.minCount }}</th>
            <th :class="cell">{{ de.settings.active }}</th><th />
          </tr>
        </thead>
        <tbody>
          <tr v-for="form in [...rules, newRule]" :key="form.id ?? 'new'" class="border-t border-gray-100">
            <td :class="cell"><input v-model="form.label" maxlength="100" :class="textInput"></td>
            <td :class="cell"><input v-model="form.start" type="time" step="300" :class="timeInput"></td>
            <td :class="cell"><input v-model="form.end" type="time" step="300" :class="timeInput"></td>
            <td :class="cell"><input v-model.number="form.minCount" type="number" min="1" max="20" class="w-16 rounded border border-gray-300 px-1 py-0.5"></td>
            <td :class="cell" class="text-center"><input v-model="form.active" type="checkbox"></td>
            <td :class="cell" class="whitespace-nowrap text-right">
              <UButton size="xs" :label="form.id ? de.common.save : de.settings.addRule" @click="saveRule(form)" />
              <UButton v-if="form.id" size="xs" color="error" variant="ghost" icon="i-lucide-trash-2" :aria-label="de.common.delete" @click="deleteRule(form)" />
            </td>
          </tr>
        </tbody>
      </table>
    </section>

    <section class="space-y-2 rounded-lg bg-white p-4 ring-1 ring-gray-200">
      <h2 class="font-semibold">{{ de.settings.backup }}</h2>
      <p class="text-sm text-gray-600">{{ de.settings.backupHint }}</p>
      <a href="/api/backup" download class="inline-flex items-center gap-1 rounded-md bg-sky-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-sky-700">
        <UIcon name="i-lucide-download" /> {{ de.settings.backupDownload }}
      </a>
    </section>
  </div>
</template>
