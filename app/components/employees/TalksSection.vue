<script setup lang="ts">
import { formatTime } from '#shared/domain/time'
import type { FormTemplateDto, StaffTalkDto, TalkFormDto } from '#shared/types/api'
import { de } from '~/locales/de'
import { formatDate, formatDateTime } from '~/utils/format'

/**
 * The tab „Gespräche“ of an employee (Leitung and Träger): the talks newest first with their forms. Per form its state,
 * the release buttons by role (self: „Zum Ausfüllen freigeben“ / „Freigabe zurücknehmen“ / „Wieder öffnen“;
 * assessment: „Zum Lesen freigeben“ / „Lesefreigabe zurücknehmen“), open (fill in here), print and remove.
 */
const props = defineProps<{ employeeId: number }>()
const { data: talks, refresh } = useFetch<StaffTalkDto[]>('/api/staff-talks', { query: { employeeId: props.employeeId }, default: () => [] })
const { data: templates, refresh: refreshTemplates } = useFetch<FormTemplateDto[]>('/api/form-templates', { query: { kind: 'staff' }, default: () => [] })
const run = useAction(refresh)
const confirm = useConfirm()

const dialogOpen = ref(false)
const dialogTalk = ref<StaffTalkDto | null>(null)
async function openDialog(talk: StaffTalkDto | null) {
  dialogTalk.value = talk
  if (!talk) await refreshTemplates()
  dialogOpen.value = true
}

// One form is open at a time. Closing it, or opening another one, asks first while it has unsaved answers.
const openFormId = ref<number | null>(null)
const openDirty = ref(false)
const isOpen = (formId: number) => openFormId.value === formId
async function toggleForm(formId: number) {
  if (openFormId.value !== null && openDirty.value
    && !await confirm(de.forms.closeConfirm, { confirmLabel: de.forms.closeDiscard })) return
  openDirty.value = false
  openFormId.value = isOpen(formId) ? null : formId
}

const talkTitle = (talk: StaffTalkDto) =>
  talk.start === null ? de.talks.talkOn(formatDate(talk.date)) : `${de.talks.talkOn(formatDate(talk.date))} ${de.talks.atTime(formatTime(talk.start))}`

function stateLabel(form: TalkFormDto): string {
  if (form.role === 'self') return de.talks.states[form.state]
  return form.readReleased ? de.talks.readReleased : de.talks.notReadReleased
}
function stateColor(form: TalkFormDto) {
  if (form.role === 'self') return form.state === 'submitted' ? 'success' : form.state === 'released' ? 'info' : 'neutral'
  return form.readReleased ? 'success' : 'neutral'
}
/** „freigegeben am …“, „abgegeben am …“, „zum Lesen freigegeben am …“ as far as they apply. */
function stamps(form: TalkFormDto): string[] {
  const lines: string[] = []
  if (form.releasedAt) lines.push(de.talks.releasedAt(formatDateTime(form.releasedAt)))
  if (form.submittedAt) lines.push(de.talks.submittedAt(formatDateTime(form.submittedAt)))
  if (form.readReleasedAt) lines.push(de.talks.readReleasedAt(formatDateTime(form.readReleasedAt)))
  return lines
}

const post = (form: TalkFormDto, action: string, body?: object) =>
  run(() => $fetch<unknown>(`/api/staff-talks/forms/${form.id}/${action}`, { method: 'POST', body }), de.common.saved)
async function release(form: TalkFormDto) {
  if (await confirm(de.talks.releaseConfirm, { confirmLabel: de.talks.release, danger: false })) await post(form, 'release')
}
const withdraw = (form: TalkFormDto) => post(form, 'withdraw')
async function reopen(form: TalkFormDto) {
  if (await confirm(de.talks.reopenConfirm, { confirmLabel: de.talks.reopen, danger: false })) await post(form, 'reopen')
}
async function readRelease(form: TalkFormDto, released: boolean) {
  if (released && !await confirm(de.talks.readReleaseConfirm, { confirmLabel: de.talks.readRelease, danger: false })) return
  await post(form, 'read-release', { released })
}
/** The confirm text, plus a word about unsaved answers when the open form is among the ones that go. */
const withUnsaved = (message: string, formIds: number[]) =>
  (openDirty.value && openFormId.value !== null && formIds.includes(openFormId.value) ? `${message} ${de.talks.unsavedLost}` : message)
/** The open form is gone: nothing is open (and nothing unsaved) any more. */
function forgetOpen(formIds: number[]) {
  if (openFormId.value !== null && formIds.includes(openFormId.value)) {
    openFormId.value = null
    openDirty.value = false
  }
}
async function removeForm(form: TalkFormDto) {
  if (!await confirm(withUnsaved(de.talks.removeFormConfirm(form.title), [form.id]))) return
  if (await run(() => $fetch<unknown>(`/api/staff-talks/forms/${form.id}`, { method: 'DELETE' }), de.common.deleted)) forgetOpen([form.id])
}
async function deleteTalk(talk: StaffTalkDto) {
  const formIds = talk.forms.map(form => form.id)
  if (!await confirm(withUnsaved(de.talks.deleteTalkConfirm(formatDate(talk.date)), formIds))) return
  if (await run(() => $fetch<unknown>(`/api/staff-talks/${talk.id}`, { method: 'DELETE' }), de.common.deleted)) forgetOpen(formIds)
}

const activeTemplates = computed(() => (templates.value ?? []).filter(template => !template.archived)
  .map(template => ({ label: template.name, value: template.id })))
const addPick = reactive<Record<number, number | undefined>>({})
async function addForm(talk: StaffTalkDto) {
  const templateId = addPick[talk.id]
  if (templateId === undefined) return
  if (await run(() => $fetch<unknown>(`/api/staff-talks/${talk.id}/forms`, { method: 'POST', body: { templateId } }), de.common.saved)) {
    addPick[talk.id] = undefined
  }
}
</script>

<template>
  <section class="min-w-0 space-y-3">
    <div class="flex flex-wrap items-center gap-2">
      <h2 class="font-semibold">{{ de.employees.tabs.talks }}</h2>
      <UButton class="ml-auto" size="sm" icon="i-lucide-plus" :label="de.talks.create" @click="openDialog(null)" />
    </div>
    <p v-if="!(talks ?? []).length" class="text-sm text-gray-500">{{ de.talks.none }}</p>

    <article v-for="talk in talks ?? []" :key="talk.id" class="min-w-0 space-y-3 rounded-lg bg-white p-3 ring-1 ring-gray-200 sm:p-4">
      <div class="flex flex-wrap items-start gap-2">
        <div class="min-w-0 flex-1 basis-60">
          <h3 class="font-semibold">{{ talkTitle(talk) }}</h3>
          <p v-if="talk.participants" class="text-sm break-words text-gray-600">{{ de.talks.participants }}: {{ talk.participants }}</p>
          <p v-if="talk.period" class="text-sm break-words text-gray-600">{{ de.talks.period }}: {{ talk.period }}</p>
        </div>
        <div class="flex flex-wrap gap-1">
          <UButton size="sm" color="neutral" variant="ghost" icon="i-lucide-pencil" :label="de.talks.editHeader" @click="openDialog(talk)" />
          <UButton size="sm" color="error" variant="ghost" icon="i-lucide-trash-2" :label="de.talks.deleteTalk" @click="deleteTalk(talk)" />
        </div>
      </div>

      <ul class="space-y-2">
        <li v-for="form in talk.forms" :key="form.id" class="min-w-0 space-y-2 rounded-md bg-gray-50 p-2 ring-1 ring-gray-200 sm:p-3">
          <div class="flex flex-wrap items-center gap-2">
            <span class="min-w-0 font-medium break-words">{{ form.title }}</span>
            <UBadge color="neutral" variant="outline" size="sm" :label="de.talks.roles[form.role]" />
            <UBadge :color="stateColor(form)" variant="soft" size="sm" :label="stateLabel(form)" />
          </div>
          <div class="space-y-0.5 text-xs text-gray-500">
            <p v-for="line in stamps(form)" :key="line">{{ line }}</p>
            <p>{{ de.forms.lastChanged(form.updatedBy, formatDateTime(form.updatedAt)) }}</p>
          </div>
          <div class="flex flex-wrap gap-1">
            <UButton
              size="sm" color="neutral" variant="outline" :icon="isOpen(form.id) ? 'i-lucide-chevron-up' : 'i-lucide-file-pen-line'"
              :label="isOpen(form.id) ? de.talks.close : de.talks.open" :aria-expanded="isOpen(form.id)" @click="toggleForm(form.id)"
            />
            <template v-if="form.role === 'self'">
              <UButton v-if="form.state === 'draft'" size="sm" icon="i-lucide-send" :label="de.talks.release" @click="release(form)" />
              <UButton v-else-if="form.state === 'released'" size="sm" color="neutral" variant="outline" icon="i-lucide-undo-2" :label="de.talks.withdraw" @click="withdraw(form)" />
              <UButton v-else size="sm" color="neutral" variant="outline" icon="i-lucide-lock-open" :label="de.talks.reopen" @click="reopen(form)" />
            </template>
            <template v-else>
              <UButton v-if="!form.readReleased" size="sm" icon="i-lucide-eye" :label="de.talks.readRelease" @click="readRelease(form, true)" />
              <UButton v-else size="sm" color="neutral" variant="outline" icon="i-lucide-eye-off" :label="de.talks.readWithdraw" @click="readRelease(form, false)" />
            </template>
            <UButton size="sm" color="neutral" variant="ghost" icon="i-lucide-printer" :label="de.talks.print" :to="`/admin/print/forms/${form.id}`" target="_blank" />
            <UButton size="sm" color="error" variant="ghost" icon="i-lucide-trash-2" :label="de.talks.removeForm" @click="removeForm(form)" />
          </div>
          <FormsFormPanel
            v-if="isOpen(form.id)" :form="form" :save-url="`/api/staff-talks/forms/${form.id}`" editable :refresh="refresh"
            @dirty="openDirty = $event"
          />
        </li>
      </ul>

      <div v-if="activeTemplates.length" class="flex flex-wrap items-center gap-2 border-t border-gray-100 pt-2">
        <USelect
          v-model="addPick[talk.id]" :items="activeTemplates" size="sm" class="w-full sm:w-72"
          :placeholder="de.talks.addFormPick" :aria-label="de.talks.addFormPick"
        />
        <UButton size="sm" color="neutral" variant="outline" icon="i-lucide-plus" :label="de.talks.addForm" :disabled="addPick[talk.id] === undefined" @click="addForm(talk)" />
      </div>
    </article>

    <EmployeesTalkDialog v-model:open="dialogOpen" :employee-id="props.employeeId" :talk="dialogTalk" :templates="templates ?? []" @saved="refresh" />
  </section>
</template>
