<script setup lang="ts">
import type { EmployeeDocumentFolder } from '#shared/domain/personnel'
import { APPLICANT_KINDS } from '#shared/domain/visits'
import type { ApplicantVisitDto } from '#shared/types/api'
import { de } from '~/locales/de'
import { errorMessage } from '~/utils/errors'
import { formatDate, formatDateTime } from '~/utils/format'
import { usableFolders } from '~/utils/pdfFill'
import { applicantBody, applicantForm, applicantName, dayRangeText, emptyApplicantForm } from '~/utils/visits'

/**
 * An applicant (Mitarbeiter → Bewerbungen & Hospitationen): name, contact, kind, mentor, notes and assessment, the days
 * („Termine“), documents and forms; „Absagen“ / „Wieder öffnen“, „Einstellen“ (creates the employee and moves documents
 * and forms into the personnel file) and deleting. With visits.applicants.view only read; a hired one links to the
 * personnel file and keeps only its kind, days, status and that link (phone and e-mail only when they could not go into
 * the personal data, for visits.manage).
 */
const t = de.visits
useHead({ title: t.tabs.applicants })
useUnsavedGuard()
const route = useRoute()
const id = computed(() => Number(route.params.id))
const toast = useToast()
const confirm = useConfirm()
const { can } = useCan()
const { data: visit, error, refresh } = await useFetch<ApplicantVisitDto>(() => `/api/applicant-visits/${id.value}`, { key: `applicant-visit-${id.value}` })
const { data: groups } = useGroups()

const form = reactive(emptyApplicantForm())
const baseline = ref('')
function load(value: ApplicantVisitDto | null | undefined) {
  if (!value) return
  Object.assign(form, applicantForm(value))
  baseline.value = JSON.stringify(form)
}
watch(visit, load, { immediate: true })
const editable = computed(() => !!visit.value && visit.value.canManage && visit.value.status !== 'hired')
const dirty = useDirty(() => editable.value && JSON.stringify(form) !== baseline.value)
const kindItems = APPLICANT_KINDS.map(value => ({ label: t.kinds[value], value }))
const mentorMissing = computed(() => form.mentorEmployeeId !== null && !(visit.value?.staff ?? []).some(person => person.id === form.mentorEmployeeId))
const staffItems = computed(() => [
  { label: t.nobody, value: 0 }, ...(visit.value?.staff ?? []).map(person => ({ label: person.name, value: person.id })),
  ...(mentorMissing.value ? [{ label: visit.value?.mentorName ?? '', value: form.mentorEmployeeId! }] : []),
])
const mentor = computed({
  get: () => form.mentorEmployeeId ?? 0,
  set: (value: number) => { form.mentorEmployeeId = value === 0 ? null : value },
})
const addDay = () => form.days.push({ date: '', from: '', to: '' })
const removeDay = (index: number) => form.days.splice(index, 1)

const busy = ref(false)
async function save(status?: 'open' | 'declined', message: string = de.common.saved): Promise<boolean> {
  if (busy.value) return false
  busy.value = true
  try {
    await $fetch<unknown>(`/api/applicant-visits/${id.value}`, { method: 'PUT', body: applicantBody(form, status) })
    await refresh()
    toast.add({ title: message, color: 'success' })
    return true
  }
  catch (failure) {
    toast.add({ title: errorMessage(failure), color: 'error' })
    return false
  }
  finally {
    busy.value = false
  }
}
async function decline() {
  if (await confirm(t.declineConfirm(form.name))) await save('declined', t.declined)
}
async function remove() {
  if (!visit.value || !await confirm(t.deleteRecordConfirm(applicantName(visit.value)))) return
  try {
    await $fetch<unknown>(`/api/applicant-visits/${id.value}`, { method: 'DELETE' })
    baseline.value = JSON.stringify(form)
    toast.add({ title: de.common.deleted, color: 'success' })
    await navigateTo('/admin/employees?tab=applicants')
  }
  catch (failure) {
    toast.add({ title: errorMessage(failure), color: 'error' })
  }
}

// „Einstellen“
const canHire = computed(() => can('employees.edit'))
// Phone and e-mail go into „Anschrift und Kontakt“ only with that right (else they stay on this record).
const contactStays = computed(() => !can('employees.personal') && (form.phone.trim() !== '' || form.email.trim() !== ''))
const folders = computed(() => usableFolders(can))
const folderItems = computed(() => folders.value.map(folder => ({ label: de.personnel.folders[folder], value: folder })))
const groupItems = computed(() => [{ label: t.noGroup, value: 0 }, ...(groups.value ?? []).map(group => ({ label: group.name, value: group.id }))])
const hireOpen = ref(false)
const hire = reactive<{ shortName: string; validFrom: string; weeklyHours: string; groupId: number; folder: EmployeeDocumentFolder | undefined }>({
  shortName: '', validFrom: '', weeklyHours: '', groupId: 0, folder: undefined,
})
async function startHire() {
  if (dirty.value && !await save()) return
  Object.assign(hire, {
    shortName: form.name.split(/\s+/).map(part => part[0] ?? '').join('').slice(0, 3).toUpperCase(), validFrom: '', weeklyHours: '', groupId: 0,
    folder: folders.value.includes('application') ? 'application' : folders.value[0],
  })
  hireOpen.value = true
}
const hasDocuments = computed(() => (visit.value?.documents.length ?? 0) > 0)
async function confirmHire() {
  if (busy.value) return
  const hours = Number(hire.weeklyHours.replace(',', '.'))
  busy.value = true
  try {
    const { employeeId } = await $fetch<{ employeeId: number; contactCopied: boolean }>(`/api/applicant-visits/${id.value}/hire`, {
      method: 'POST',
      body: {
        shortName: hire.shortName, validFrom: hire.validFrom, weeklyMinutes: Math.round(hours * 60), groupId: hire.groupId || null,
        folder: hasDocuments.value ? hire.folder ?? null : null,
      },
    })
    hireOpen.value = false
    await refresh()
    toast.add({ title: t.hireDone, color: 'success', actions: [{ label: t.toEmployee, onClick: () => { void navigateTo(`/admin/employees/${employeeId}`) } }] })
  }
  catch (failure) {
    toast.add({ title: errorMessage(failure), color: 'error' })
  }
  finally {
    busy.value = false
  }
}
</script>

<template>
  <div class="max-w-4xl space-y-4">
    <NuxtLink to="/admin/employees?tab=applicants" class="inline-flex items-center gap-1 text-sm text-sky-700 hover:underline">
      <UIcon name="i-lucide-arrow-left" class="size-4" />{{ t.back }}
    </NuxtLink>
    <p v-if="error || !visit" class="rounded-lg bg-white p-4 text-sm ring-1 ring-gray-200">{{ errorMessage(error) }}</p>
    <template v-else>
      <div class="flex flex-wrap items-center gap-2">
        <h1 class="text-2xl font-semibold">{{ applicantName(visit) }}</h1>
        <span class="rounded bg-gray-100 px-2 py-0.5 text-xs text-gray-700">{{ t.kinds[visit.kind] }} · {{ t.applicantStatus[visit.status] }}</span>
        <span v-if="visit.declinedAt" class="text-xs text-gray-500">{{ t.declinedOn(formatDate(visit.declinedAt)) }}</span>
        <span class="text-xs text-gray-500">{{ t.lastChanged(visit.updatedBy, formatDateTime(visit.updatedAt)) }}</span>
      </div>

      <UAlert v-if="visit.status === 'hired'" color="success" variant="soft" :title="t.transferredApplicant">
        <template v-if="visit.employeeId" #actions>
          <UButton size="sm" color="neutral" variant="outline" icon="i-lucide-user" :label="t.toEmployee" :to="`/admin/employees/${visit.employeeId}`" />
        </template>
      </UAlert>
      <p v-else-if="!visit.canManage" class="text-sm text-gray-600">{{ t.readOnly }}</p>

      <div v-if="visit.status === 'hired'" class="space-y-1 rounded-lg bg-white p-4 text-sm ring-1 ring-gray-200">
        <p v-if="visit.dayCount">{{ t.termine }}: {{ dayRangeText(visit) }} · {{ t.days(visit.dayCount) }}</p>
        <p v-if="visit.phone || visit.email">
          {{ [visit.phone && `${t.fields.phone}: ${visit.phone}`, visit.email && `${t.fields.email}: ${visit.email}`].filter(Boolean).join(' · ') }}
          <span class="block text-xs text-gray-500">{{ t.hireContactStayed }}</span>
        </p>
      </div>
      <form v-else class="space-y-3 rounded-lg bg-white p-4 ring-1 ring-gray-200" @submit.prevent="save()">
        <fieldset :disabled="!editable" class="grid gap-3 sm:grid-cols-2">
          <UFormField :label="t.fields.name" required>
            <UInput v-model="form.name" maxlength="120" class="w-full" required />
          </UFormField>
          <UFormField :label="t.fields.kind" required>
            <USelect v-model="form.kind" :items="kindItems" class="w-full" :disabled="!editable" />
          </UFormField>
          <UFormField :label="t.fields.phone">
            <UInput v-model="form.phone" maxlength="50" type="tel" class="w-full" />
          </UFormField>
          <UFormField :label="t.fields.email">
            <UInput v-model="form.email" maxlength="200" type="email" class="w-full" />
          </UFormField>
          <UFormField :label="t.fields.mentor">
            <USelect v-model="mentor" :items="staffItems" class="w-full" :disabled="!editable" />
          </UFormField>
          <UFormField :label="t.fields.applicantNotes" :help="t.notesHint" class="sm:col-span-2">
            <UTextarea v-model="form.notes" :maxlength="2000" :rows="4" autoresize class="w-full" />
          </UFormField>
          <div class="space-y-2 sm:col-span-2">
            <p class="text-sm font-medium">{{ t.termine }}</p>
            <p v-if="!form.days.length" class="text-sm text-gray-500">{{ t.noDays }}</p>
            <div v-for="(day, index) in form.days" :key="index" class="flex flex-wrap items-end gap-2">
              <UFormField :label="t.dayDate" required>
                <DateTextInput v-model="day.date" :label="t.dayDate" class="w-40" required :disabled="!editable" />
              </UFormField>
              <UFormField :label="t.dayFrom">
                <TimeInput v-model="day.from" any-minute class="w-24" />
              </UFormField>
              <UFormField :label="t.dayTo">
                <TimeInput v-model="day.to" any-minute class="w-24" />
              </UFormField>
              <UButton
                v-if="editable" type="button" color="neutral" variant="ghost" icon="i-lucide-x" :aria-label="t.removeDay" class="min-h-9"
                @click="removeDay(index)"
              />
            </div>
            <UButton v-if="editable" type="button" size="sm" color="neutral" variant="outline" icon="i-lucide-plus" :label="t.addDay" @click="addDay" />
          </div>
        </fieldset>
        <div v-if="editable" class="flex flex-wrap items-center gap-2">
          <UButton type="submit" icon="i-lucide-save" :label="t.save" :loading="busy" :disabled="busy || !dirty" />
          <span v-if="dirty" class="text-sm text-amber-700">{{ de.forms.unsaved }}</span>
          <div class="flex flex-wrap gap-2 sm:ml-auto">
            <UButton v-if="canHire" type="button" color="success" icon="i-lucide-user-plus" :label="t.hire" :disabled="busy" @click="startHire" />
            <UButton
              v-if="visit.status === 'open'" type="button" color="neutral" variant="outline" icon="i-lucide-x" :label="t.decline"
              :disabled="busy" @click="decline"
            />
            <UButton
              v-else type="button" color="neutral" variant="outline" icon="i-lucide-rotate-ccw" :label="t.reopen" :disabled="busy"
              @click="save('open', t.reopened)"
            />
          </div>
        </div>
        <p v-if="editable && !canHire" class="text-xs text-gray-500">{{ t.hireNoRight }}</p>
      </form>

      <template v-if="visit.status !== 'hired'">
        <VisitsDocuments kind="applicant" :record-id="visit.id" :owner-name="visit.name" :documents="visit.documents" :editable="editable" @changed="refresh" />
        <VisitsForms kind="applicant" :record-id="visit.id" :forms="visit.forms" :templates="visit.templates" :editable="editable" :refresh-list="refresh" />
      </template>

      <div v-if="visit.canManage" class="flex justify-end">
        <UButton color="error" variant="ghost" icon="i-lucide-trash-2" :label="t.deleteRecord" @click="remove" />
      </div>
    </template>

    <UModal v-model:open="hireOpen" :title="t.hireTitle">
      <template #body>
        <form class="grid gap-3 sm:grid-cols-2" @submit.prevent="confirmHire">
          <p class="text-sm text-gray-600 sm:col-span-2">{{ t.hireIntro }}</p>
          <p v-if="contactStays" class="text-sm text-amber-800 sm:col-span-2">{{ t.hireContactHint }}</p>
          <UFormField :label="t.shortName" required>
            <UInput v-model="hire.shortName" maxlength="10" class="w-full" required />
          </UFormField>
          <UFormField :label="t.validFrom" required>
            <DateTextInput v-model="hire.validFrom" :label="t.validFrom" class="w-full" required />
          </UFormField>
          <UFormField :label="t.weeklyHours" required>
            <UInput v-model="hire.weeklyHours" inputmode="decimal" class="w-full" required />
          </UFormField>
          <UFormField :label="t.group">
            <USelect v-model="hire.groupId" :items="groupItems" class="w-full" />
          </UFormField>
          <template v-if="hasDocuments">
            <UFormField v-if="folders.length" :label="t.folder" class="sm:col-span-2" required>
              <USelect v-model="hire.folder" :items="folderItems" class="w-full" />
            </UFormField>
            <p v-else class="text-sm text-amber-800 sm:col-span-2">{{ t.noFolder }}</p>
          </template>
          <div class="flex gap-2 sm:col-span-2">
            <UButton
              type="submit" color="success" :label="t.hire" :loading="busy"
              :disabled="busy || !hire.validFrom || !hire.weeklyHours || (hasDocuments && !folders.length)"
            />
            <UButton type="button" color="neutral" variant="ghost" :label="de.common.cancel" @click="hireOpen = false" />
          </div>
        </form>
      </template>
    </UModal>
  </div>
</template>
