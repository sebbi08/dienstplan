<script setup lang="ts">
import { OVERVIEW_FIELD_KEYS, SHEET_NAME_MAX, groupByArea, type OverviewColumnRef } from '#shared/domain/childConsents'
import type { ConsentQuestionSettingsDto, OverviewSheetDto, OverviewSheetInput } from '#shared/types/api'
import { de } from '~/locales/de'
import { moveInList } from '~/utils/consentSettings'

/**
 * The tabs of Kinder → Übersicht: add, rename, reorder and delete them, and per tab pick and order its columns from the
 * facility's consent questions (by area) and the fixed fields of the record. A hidden question's column stays with a
 * hint (it still shows the answers there are).
 */
const s = de.sheetSettings
const fieldNames = de.children.overview.fields

const { data, refresh } = await useFetch<OverviewSheetDto[]>('/api/child-overview-sheets', { key: 'settings-overview-sheets' })
const { data: questionData } = await useFetch<ConsentQuestionSettingsDto[]>('/api/child-consent-questions', { key: 'settings-consent-questions' })
const { busy, run } = useBusyAction(async () => {
  await Promise.all([refresh(), refreshNuxtData(['children-overview'])])
})
const confirm = useConfirm()

const sheets = computed(() => data.value ?? [])
const questions = computed(() => questionData.value ?? [])
const questionAreas = computed(() => groupByArea(questions.value))

/** The tab being edited, with its unsaved name and columns. */
const editing = ref<{ id: number; name: string; columns: OverviewColumnRef[] } | null>(null)
const newName = ref('')
const choice = ref('')
useDirty(() => editing.value !== null || newName.value.trim() !== '')

const columnKey = (column: OverviewColumnRef) => (column.type === 'field' ? `field:${column.key}` : `consent:${column.questionId}`)
function columnLabel(column: OverviewColumnRef): string {
  if (column.type === 'field') return fieldNames[column.key]
  const question = questions.value.find(entry => entry.id === column.questionId)
  return question ? `${question.short} – ${question.text}` : ''
}
const isHiddenQuestion = (column: OverviewColumnRef) =>
  column.type === 'consent' && !!questions.value.find(entry => entry.id === column.questionId)?.hidden
const chosen = computed(() => new Set((editing.value?.columns ?? []).map(columnKey)))

function startEdit(sheet: OverviewSheetDto) {
  editing.value = { id: sheet.id, name: sheet.name, columns: [...sheet.columns] }
  choice.value = ''
}
function addColumn() {
  if (!editing.value || !choice.value) return
  const [type, value] = choice.value.split(':') as ['field' | 'consent', string]
  const column: OverviewColumnRef = type === 'field'
    ? { type, key: value as typeof OVERVIEW_FIELD_KEYS[number] }
    : { type, questionId: Number(value) }
  if (!chosen.value.has(columnKey(column))) editing.value.columns.push(column)
  choice.value = ''
}
function moveColumn(index: number, direction: -1 | 1) {
  if (!editing.value) return
  const next = moveInList(editing.value.columns, index, direction)
  if (next) editing.value.columns = next
}
function removeColumn(index: number) {
  editing.value?.columns.splice(index, 1)
}

async function save() {
  const sheet = editing.value
  if (!sheet) return
  const body: OverviewSheetInput = { name: sheet.name, columns: sheet.columns }
  const ok = await run(() => $fetch<OverviewSheetDto>(`/api/child-overview-sheets/${sheet.id}`, { method: 'PUT', body }), de.common.saved)
  if (ok) editing.value = null
}
async function add() {
  const body: OverviewSheetInput = { name: newName.value, columns: [] }
  let created: OverviewSheetDto | null = null
  const ok = await run(async () => {
    created = await $fetch<OverviewSheetDto>('/api/child-overview-sheets', { method: 'POST', body })
  }, de.common.saved)
  if (ok && created) {
    newName.value = ''
    startEdit(created)
  }
}
async function remove(sheet: OverviewSheetDto) {
  if (!await confirm(s.confirmDelete(sheet.name))) return
  const ok = await run(() => $fetch<unknown>(`/api/child-overview-sheets/${sheet.id}`, { method: 'DELETE' }), de.common.deleted)
  if (ok && editing.value?.id === sheet.id) editing.value = null
}
/** The ▲/▼ of the tabs show only after „Reihenfolge ändern“ (the columns of a tab being edited keep theirs). */
const reordering = ref(false)
function moveSheet(index: number, direction: -1 | 1) {
  const next = moveInList(sheets.value.map(sheet => sheet.id), index, direction)
  if (next) run(() => $fetch<unknown>('/api/child-overview-sheets/order', { method: 'POST', body: { ids: next } }), de.common.saved)
}
</script>

<template>
  <section class="space-y-3 rounded-lg bg-white p-4 ring-1 ring-gray-200">
    <div class="flex flex-wrap items-center gap-2">
      <h2 class="font-semibold">{{ s.title }}</h2>
      <ReorderToggle v-if="sheets.length > 1" v-model="reordering" size="xs" class="ml-auto" />
    </div>
    <p class="text-xs text-gray-500">{{ s.intro }}</p>
    <p v-if="!sheets.length" class="text-sm text-gray-500">{{ s.empty }}</p>

    <ul class="divide-y divide-gray-100">
      <li v-for="(sheet, index) in sheets" :key="sheet.id" class="space-y-2 py-2">
        <div class="flex flex-wrap items-center gap-2">
          <span class="min-w-40 flex-1 font-medium">{{ sheet.name }}</span>
          <span class="text-xs text-gray-500">{{ s.columns }}: {{ sheet.columns.length }}</span>
          <!-- ▲/▼ only after „Reihenfolge ändern“; on phones „Bearbeiten“ and „⋯“ with „Löschen“. -->
          <template v-if="reordering">
            <UButton
              color="neutral" variant="ghost" icon="i-lucide-arrow-up" class="min-h-10 min-w-10 justify-center" :aria-label="`${s.moveUp}: ${sheet.name}`"
              :disabled="busy || index === 0" @click="moveSheet(index, -1)"
            />
            <UButton
              color="neutral" variant="ghost" icon="i-lucide-arrow-down" class="min-h-10 min-w-10 justify-center" :aria-label="`${s.moveDown}: ${sheet.name}`"
              :disabled="busy || index === sheets.length - 1" @click="moveSheet(index, 1)"
            />
          </template>
          <RowActions
            v-else :name="sheet.name" size="xs" :actions="[
              { key: 'edit', label: de.common.edit, icon: 'i-lucide-pencil', show: editing?.id !== sheet.id, disabled: busy || editing !== null, onClick: () => startEdit(sheet) },
              { key: 'delete', label: de.common.delete, icon: 'i-lucide-trash-2', color: 'error', variant: 'ghost', iconOnly: true, disabled: busy, onClick: () => remove(sheet) },
            ]"
          />
        </div>

        <form v-if="editing?.id === sheet.id" class="space-y-3 rounded-lg bg-gray-50 p-3" @submit.prevent="save">
          <UFormField :label="s.name"><UInput v-model="editing.name" :maxlength="SHEET_NAME_MAX" class="w-64 max-w-full" /></UFormField>
          <div class="space-y-1">
            <p class="text-xs font-medium text-gray-600">{{ s.columns }}</p>
            <p v-if="!editing.columns.length" class="text-sm text-gray-500">{{ s.noColumns }}</p>
            <ol class="space-y-1 text-sm">
              <li v-for="(column, at) in editing.columns" :key="columnKey(column)" class="flex flex-wrap items-center gap-1 rounded bg-white px-2 py-1 ring-1 ring-gray-200">
                <span class="w-6 text-xs text-gray-400">{{ at + 1 }}.</span>
                <span class="min-w-40 flex-1">
                  {{ columnLabel(column) }}
                  <span v-if="isHiddenQuestion(column)" class="block text-xs text-amber-700">{{ s.hiddenQuestion }}</span>
                </span>
                <UButton size="xs" color="neutral" variant="ghost" icon="i-lucide-arrow-up" :aria-label="s.moveLeft" :disabled="at === 0" @click="moveColumn(at, -1)" />
                <UButton
                  size="xs" color="neutral" variant="ghost" icon="i-lucide-arrow-down" :aria-label="s.moveRight"
                  :disabled="at === editing.columns.length - 1" @click="moveColumn(at, 1)"
                />
                <UButton size="xs" color="error" variant="ghost" icon="i-lucide-x" :aria-label="s.removeColumn" @click="removeColumn(at)" />
              </li>
            </ol>
          </div>
          <div class="flex flex-wrap items-center gap-2">
            <select v-model="choice" class="max-w-full rounded border border-gray-300 bg-white px-2 py-1 text-sm" :aria-label="s.addColumn">
              <option value="">{{ s.chooseColumn }}</option>
              <optgroup v-for="block in questionAreas" :key="block.area" :label="block.area">
                <option
                  v-for="question in block.questions" :key="question.id" :value="`consent:${question.id}`"
                  :disabled="chosen.has(`consent:${question.id}`)"
                >
                  {{ question.short }} – {{ question.text }}{{ question.hidden ? ` (${de.consentSettings.hidden})` : '' }}
                </option>
              </optgroup>
              <optgroup :label="s.fieldsGroup">
                <option v-for="key in OVERVIEW_FIELD_KEYS" :key="key" :value="`field:${key}`" :disabled="chosen.has(`field:${key}`)">
                  {{ fieldNames[key] }}
                </option>
              </optgroup>
            </select>
            <UButton type="button" size="xs" variant="outline" icon="i-lucide-plus" :label="s.addColumn" :disabled="!choice" @click="addColumn" />
          </div>
          <div class="flex gap-2">
            <UButton type="submit" :label="de.common.save" :loading="busy" :disabled="busy" />
            <UButton type="button" color="neutral" variant="ghost" :label="de.common.cancel" @click="editing = null" />
          </div>
        </form>
      </li>
    </ul>

    <form class="flex flex-wrap items-end gap-2" @submit.prevent="add">
      <UFormField :label="s.newName"><UInput v-model="newName" :maxlength="SHEET_NAME_MAX" class="w-64 max-w-full" /></UFormField>
      <UButton type="submit" size="sm" variant="outline" icon="i-lucide-plus" :label="s.add" :disabled="busy || !newName.trim()" />
    </form>
  </section>
</template>
