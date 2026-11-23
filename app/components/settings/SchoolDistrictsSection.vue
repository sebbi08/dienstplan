<script setup lang="ts">
import { districtCsv, SCHOOL_DISTRICT_LIMITS } from '#shared/domain/schoolDistricts'
import type { SchoolDistrictListDto, SchoolDistrictParseDto, SchoolDistrictSettingsDto } from '#shared/types/api'
import { de } from '~/locales/de'
import { errorMessage } from '~/utils/errors'
import { formatDateTime } from '~/utils/format'
import { draftFromList, draftFromUpload, rowIssues, type DistrictDraft } from '~/utils/schoolDistricts'
import { uploadSizeError } from '~/utils/uploads'

/**
 * Schulbezirke (settings → Kinder): the facility's own street list (Leitung and Träger) and the Träger's list for all
 * facilities (only the Träger changes it; the Leitung sees and downloads it). An upload is read on the server into a
 * preview that is edited here and saved as a whole; nothing is stored before „Liste speichern“.
 */
type Scope = 'facility' | 'global'

const t = de.schoolDistricts
const { data, refresh } = await useFetch<SchoolDistrictSettingsDto>('/api/school-districts', { key: 'settings-school-districts' })
const { can } = useCan()
const canGlobal = computed(() => can('settings.otherFacility'))
const toast = useToast()
const confirm = useConfirm()
// The school children list shows the districts too.
const reloadAll = async () => { await Promise.all([refresh(), refreshNuxtData(['children-school-children'])]) }
const { busy, run } = useBusyAction(reloadAll)

interface Editing {
  scope: Scope
  draft: DistrictDraft
  /** An upload not saved yet (always unsaved). */
  fresh: boolean
  legend: boolean
  skipped: string[]
  skippedCount: number
  truncated: boolean
}
const editing = ref<Editing | null>(null)

const listOf = (scope: Scope) => (scope === 'global' ? data.value?.global : data.value?.own) ?? null
const toCheck = (list: SchoolDistrictListDto) => rowIssues(list.rows).filter(issues => issues.length > 0).length

const fileInput = ref<HTMLInputElement | null>(null)
const reading = ref<Scope | null>(null)
let uploadScope: Scope = 'facility'
function pickFile(scope: Scope) {
  uploadScope = scope
  fileInput.value?.click()
}
async function onFile(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (!file) return
  if (file.size > SCHOOL_DISTRICT_LIMITS.maxBytes) {
    toast.add({ title: uploadSizeError(file.size, SCHOOL_DISTRICT_LIMITS.maxBytes)!, color: 'error' })
    return
  }
  const scope = uploadScope
  reading.value = scope
  try {
    const body = new FormData()
    body.append('file', file)
    const parsed = await $fetch<SchoolDistrictParseDto>('/api/school-districts/parse', { method: 'POST', body })
    editing.value = {
      scope, draft: draftFromUpload(parsed, listOf(scope)), fresh: true, legend: parsed.legend.length > 0,
      skipped: parsed.skipped, skippedCount: parsed.skippedCount, truncated: parsed.truncated,
    }
  }
  catch (error) {
    toast.add({ title: errorMessage(error), color: 'error' })
  }
  finally {
    reading.value = null
  }
}

function edit(scope: Scope) {
  const list = listOf(scope)
  if (list) editing.value = { scope, draft: draftFromList(list), fresh: false, legend: false, skipped: [], skippedCount: 0, truncated: false }
}

async function remove(scope: Scope) {
  if (!await confirm(t.confirmDelete)) return
  await run(() => $fetch<{ ok: boolean }>(scope === 'global' ? '/api/school-districts/global' : '/api/school-districts', { method: 'DELETE' }), t.deleted)
}

/** The list as CSV, the format the upload reads (made in the browser from the loaded list). */
function download(list: SchoolDistrictListDto) {
  const blob = new Blob([districtCsv(list.rows, list.districts)], { type: 'text/csv;charset=utf-8' })
  const link = document.createElement('a')
  link.href = URL.createObjectURL(blob)
  link.download = `${(list.name || t.title).replace(/[^\p{L}\p{N} ._-]+/gu, '').trim() || t.title}.csv`
  link.click()
  setTimeout(() => URL.revokeObjectURL(link.href), 10_000)
}

async function saved() {
  editing.value = null
  await reloadAll()
}

const sections = computed(() => [
  { scope: 'facility' as const, title: t.own, list: data.value?.own ?? null, canEdit: true, empty: t.noOwn },
  { scope: 'global' as const, title: t.global, list: data.value?.global ?? null, canEdit: canGlobal.value, empty: t.noGlobal },
])
/**
 * The schools a district of the list may name: the scope's school contacts, and a school stored before that no longer
 * is one of them (its „Gilt für“ changed) – it stays, named with a hint.
 */
function schoolChoices(scope: Scope) {
  const options = (scope === 'global' ? data.value?.globalSchoolOptions : data.value?.schoolOptions) ?? []
  const stale = (listOf(scope)?.districts ?? []).filter(district => district.contactId !== null && district.contactOutOfScope)
    .filter((district, index, all) => all.findIndex(other => other.contactId === district.contactId) === index)
    .map(district => ({ id: district.contactId!, name: `${district.contactName ?? ''} (${de.contacts.schoolOutOfScope})` }))
  return [...options, ...stale.filter(entry => !options.some(option => option.id === entry.id))]
}
/** Which list the facility's children are matched against, as a line under each list. */
function appliesText(scope: Scope): string {
  if (scope === 'facility') return data.value?.own ? t.applies : data.value?.global ? t.usesGlobal : ''
  return data.value?.own ? t.overridden : t.applies
}
</script>

<template>
  <section v-if="data" class="space-y-3 rounded-lg bg-white p-4 ring-1 ring-gray-200">
    <h2 class="font-semibold">{{ t.title }}</h2>
    <p class="text-xs text-gray-500">{{ t.hint }}</p>
    <input ref="fileInput" type="file" accept=".pdf,.csv,.txt,application/pdf,text/csv" class="hidden" @change="onFile">

    <SettingsSchoolDistrictsEditor
      v-if="editing" :key="`${editing.scope}-${editing.fresh}`" :scope="editing.scope" :initial="editing.draft" :fresh="editing.fresh"
      :legend="editing.legend" :skipped="editing.skipped" :skipped-count="editing.skippedCount" :truncated="editing.truncated"
      :replacing="!!listOf(editing.scope)"
      :school-options="schoolChoices(editing.scope)"
      @saved="saved" @cancel="editing = null"
    />

    <template v-else>
      <div v-for="section in sections" :key="section.scope" class="space-y-1 rounded border border-gray-200 p-3">
        <h3 class="text-sm font-medium">{{ section.title }}</h3>
        <p v-if="section.scope === 'global'" class="text-xs text-gray-500">{{ t.globalHint }}</p>
        <template v-if="section.list">
          <p class="text-sm">
            <span v-if="section.list.name" class="font-medium">{{ section.list.name }} · </span>{{ t.summary(section.list.rows.length, section.list.asOf) }}
            <span v-if="toCheck(section.list)" class="ml-1 rounded bg-amber-100 px-1.5 py-0.5 text-xs text-amber-900">{{ t.toCheck(toCheck(section.list)) }}</span>
          </p>
          <p class="text-xs text-gray-500">{{ t.changed(formatDateTime(section.list.updatedAt), section.list.updatedBy) }}</p>
        </template>
        <p v-else class="text-sm text-gray-500">{{ section.empty }}</p>
        <p v-if="appliesText(section.scope)" class="text-xs text-gray-500">{{ appliesText(section.scope) }}</p>
        <div class="flex flex-wrap gap-2 pt-1">
          <template v-if="section.canEdit">
            <UButton
              size="xs" icon="i-lucide-upload" :label="section.list ? t.uploadReplace : t.upload" :loading="reading === section.scope"
              :disabled="busy || reading !== null" @click="pickFile(section.scope)"
            />
            <UButton v-if="section.list" size="xs" color="neutral" variant="outline" icon="i-lucide-pencil" :label="t.edit" :disabled="busy" @click="edit(section.scope)" />
          </template>
          <UButton v-if="section.list" size="xs" color="neutral" variant="outline" icon="i-lucide-download" :label="t.download" @click="download(section.list)" />
          <UButton
            v-if="section.list && section.canEdit" size="xs" color="error" variant="ghost" icon="i-lucide-trash-2" :label="t.delete"
            :disabled="busy" @click="remove(section.scope)"
          />
        </div>
      </div>
      <p v-if="reading" class="text-sm text-gray-500">{{ t.reading }}</p>
      <p class="text-xs text-gray-500">{{ t.csvHint }}</p>
      <p class="text-xs text-gray-500">{{ t.excelHint }}</p>
    </template>
  </section>
</template>
