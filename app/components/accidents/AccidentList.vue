<script setup lang="ts">
import { isValidIsoDate, todayIso } from '#shared/domain/dates'
import type { FormSubject } from '#shared/domain/forms'
import { formatTime, parseTime } from '#shared/domain/time'
import type { AccidentListItemDto, AccidentsDto } from '#shared/types/api'
import { de } from '~/locales/de'
import { formatDate } from '~/utils/format'
import { templatePickerItems } from '~/utils/forms'

/**
 * „Unfälle“ of one person (child record, Personalakte, „Meine Unfälle“): the accident reports newest first (Datum,
 * Vorlage, Arztbesuch / arbeitsunfähig, gemeldet), „Unfallbericht/-anzeige ausfüllen“ for whoever may (with Datum,
 * Uhrzeit and the header ticks; the template's prefilled answers arrive with the new form), each report opening here to
 * fill in or read as the API says. Leitung/Träger delete. One report is open at a time; closing it, opening another,
 * deleting it or leaving the page asks first while it has unsaved answers. Printing is never offered at the tablet.
 */
const props = defineProps<{
  subject: FormSubject
  /** GET the list, POST a new report. */
  listUrl: string
  formBase: string
  attachmentBase: string
  /** e.g. /print/children/accidents; null = no printing (the tablet). */
  printBase: string | null
  onTablet?: boolean
  archived?: boolean
}>()
const a = de.accidents
const { data, refresh } = useFetch<AccidentsDto>(props.listUrl, { key: `accidents-${props.listUrl}` })
const run = useAction(refresh)
const confirm = useConfirm()
const reports = computed(() => data.value?.forms ?? [])

const openId = ref<number | null>(null)
const openDirty = ref(false)
const isOpen = (id: number) => openId.value === id
async function askLeaveOpen(): Promise<boolean> {
  if (openId.value === null || !openDirty.value) return true
  return await confirm(de.forms.closeConfirm, { confirmLabel: de.forms.closeDiscard })
}
async function mayLeaveOpen(): Promise<boolean> {
  if (!await askLeaveOpen()) return false
  openDirty.value = false
  return true
}
async function toggle(id: number) {
  if (!await mayLeaveOpen()) return
  openId.value = isOpen(id) ? null : id
}
async function show(id: number) {
  if (!isOpen(id)) {
    if (!await mayLeaveOpen()) return
    openId.value = id
  }
  await nextTick()
  document.getElementById(`accident-${id}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
}

function titleLine(report: AccidentListItemDto): string {
  const day = report.date ? formatDate(report.date) : ''
  return report.start === null ? day : `${day} ${a.atTime(formatTime(report.start))}`
}

// „Unfallbericht ausfüllen“ / „Unfallanzeige ausfüllen“.
const createLabel = computed(() => (props.subject === 'child' ? a.createChild : a.createEmployee))
const createOpen = ref(false)
const createError = ref('')
const draft = reactive({ templateId: undefined as number | undefined, date: todayIso(), start: '', doctor: false, unfit: false })
const templateItems = computed(() => templatePickerItems(data.value?.templates ?? []))
function openCreate() {
  Object.assign(draft, { templateId: data.value?.templates[0]?.id, date: todayIso(), start: '', doctor: false, unfit: false })
  createError.value = ''
  createOpen.value = true
}
async function create() {
  createError.value = ''
  const start = draft.start.trim() ? parseTime(draft.start) : null
  if (!isValidIsoDate(draft.date) || draft.date > todayIso()) createError.value = a.dateInvalid
  else if (draft.start.trim() && (start === null || start > 1439)) createError.value = de.common.invalidTimeAnyMinute
  if (createError.value || draft.templateId === undefined) return
  if (!await askLeaveOpen()) return
  let createdId: number | null = null
  const body = {
    templateId: draft.templateId, date: draft.date, start, doctor: draft.doctor, unfit: props.subject === 'employee' && draft.unfit,
    reportedOn: null,
  }
  const ok = await run(async () => {
    createdId = (await $fetch<{ id: number }>(props.listUrl, { method: 'POST', body })).id
  }, a.created)
  if (!ok || createdId === null) return
  createOpen.value = false
  openDirty.value = false
  await show(createdId)
}

async function remove(report: AccidentListItemDto) {
  const lost = openDirty.value && isOpen(report.id) ? ` ${a.unsavedLost}` : ''
  if (!await confirm(`${a.deleteConfirm(report.title, report.date ? formatDate(report.date) : '')}${lost}`, { confirmLabel: a.delete, danger: true })) return
  if (await run(() => $fetch<{ ok: boolean }>(`${props.formBase}/${report.id}`, { method: 'DELETE' }), de.common.deleted) && isOpen(report.id)) {
    openId.value = null
    openDirty.value = false
  }
}

const badge = 'rounded px-1.5 py-0.5 text-xs'
</script>

<template>
  <div class="space-y-3">
    <div v-if="data?.canCreate" class="flex justify-end">
      <UButton class="min-h-11" color="neutral" variant="outline" icon="i-lucide-plus" :label="createLabel" @click="openCreate" />
    </div>
    <p v-if="!reports.length" class="text-sm text-gray-500">{{ a.none }}</p>
    <ul v-else class="space-y-2">
      <li
        v-for="report in reports" :id="`accident-${report.id}`" :key="report.id"
        class="min-w-0 scroll-mt-20 space-y-2 rounded-md bg-gray-50 p-2 ring-1 ring-gray-200 sm:p-3"
      >
        <div class="flex flex-wrap items-start gap-2">
          <div class="min-w-0 flex-1 basis-56 space-y-1">
            <span class="font-medium break-words">{{ titleLine(report) }} · {{ report.title }}</span>
            <div class="flex flex-wrap gap-1">
              <span v-if="report.doctor" :class="[badge, 'bg-amber-100 text-amber-900']">{{ a.doctorBadge }}</span>
              <span v-if="report.unfit" :class="[badge, 'bg-amber-100 text-amber-900']">{{ a.unfitBadge }}</span>
              <span v-if="report.reportedOn" :class="[badge, 'bg-green-100 text-green-800']">{{ a.reported(formatDate(report.reportedOn)) }}</span>
              <span v-else-if="report.doctor || report.unfit" :class="[badge, 'bg-red-100 text-red-800']">{{ a.notReported }}</span>
              <span v-if="report.right === 'read'" :class="[badge, 'bg-gray-200 text-gray-700']">{{ a.readOnlyBadge }}</span>
            </div>
          </div>
          <div class="flex flex-wrap items-center gap-1">
            <UButton
              class="min-h-11" color="neutral" variant="outline" :icon="isOpen(report.id) ? 'i-lucide-chevron-up' : 'i-lucide-file-pen-line'"
              :label="isOpen(report.id) ? a.close : a.open" :aria-expanded="isOpen(report.id)" @click="toggle(report.id)"
            />
            <UButton
              v-if="printBase" class="min-h-11" color="neutral" variant="ghost" icon="i-lucide-printer" :label="a.print"
              :to="`${printBase}/${report.id}`" target="_blank"
            />
            <UButton
              v-if="report.canDelete" class="min-h-11 min-w-11 justify-center" color="error" variant="ghost" icon="i-lucide-trash-2"
              :aria-label="`${a.delete}: ${report.title}`" @click="remove(report)"
            />
          </div>
        </div>
        <AccidentsAccidentPanel
          v-if="isOpen(report.id)" :form-id="report.id" :form-base="formBase" :attachment-base="attachmentBase"
          :on-tablet="onTablet" :archived="archived" :refresh-list="refresh" @dirty="openDirty = $event"
        />
      </li>
    </ul>

    <UModal v-model:open="createOpen" :title="createLabel">
      <template #body>
        <p v-if="!templateItems.length" class="text-sm text-gray-600">{{ a.noTemplates }}</p>
        <form v-else class="grid gap-3 sm:grid-cols-2" @submit.prevent="create">
          <UFormField :label="a.template" required class="sm:col-span-2">
            <USelect v-model="draft.templateId" :items="templateItems" size="lg" class="w-full" :placeholder="a.templatePick" />
          </UFormField>
          <UFormField :label="a.date" required>
            <DateTextInput v-model="draft.date" :label="a.date" :max="todayIso()" size="lg" class="w-full" required />
          </UFormField>
          <UFormField :label="a.start" :hint="a.startHint"><TimeInput v-model="draft.start" any-minute size="lg" /></UFormField>
          <div class="flex flex-wrap items-center gap-x-6 gap-y-2 sm:col-span-2">
            <UCheckbox v-model="draft.doctor" class="min-h-11 items-center" :label="a.doctor" />
            <UCheckbox v-if="subject === 'employee'" v-model="draft.unfit" class="min-h-11 items-center" :label="a.unfit" />
          </div>
          <p v-if="createError" class="text-sm text-red-600 sm:col-span-2" role="alert">{{ createError }}</p>
          <div class="flex gap-2 sm:col-span-2">
            <UButton type="submit" class="min-h-11" :label="createLabel" :disabled="draft.templateId === undefined" />
            <UButton type="button" class="min-h-11" color="neutral" variant="ghost" :label="de.common.cancel" @click="createOpen = false" />
          </div>
        </form>
      </template>
    </UModal>
  </div>
</template>
