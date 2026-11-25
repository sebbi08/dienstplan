<script setup lang="ts">
import type { DocumentTypeDto, InfoVisitDto } from '#shared/types/api'
import { de } from '~/locales/de'
import { errorMessage } from '~/utils/errors'
import { formatDate, formatDateTime } from '~/utils/format'
import { defaultDocumentType } from '~/utils/pdfFill'
import { emptyInfoVisitForm, infoVisitBody, infoVisitForm } from '~/utils/visits'

/**
 * An info visit (Kinder → Planung → Infogespräche): the fields, the documents and the forms; „Absagen“ / „Wieder
 * öffnen“, „Als Vormerkung übernehmen“ (creates the waitlist child and moves documents and forms there) and deleting.
 * A visit taken over is only read and links to the child's record.
 */
const t = de.visits
useHead({ title: t.tabs.info })
useUnsavedGuard()
const route = useRoute()
const id = computed(() => Number(route.params.id))
const toast = useToast()
const confirm = useConfirm()
const { can } = useCan()
const { data: visit, error, refresh } = await useFetch<InfoVisitDto>(() => `/api/info-visits/${id.value}`, { key: `info-visit-${id.value}` })

const form = reactive(emptyInfoVisitForm(''))
const baseline = ref('')
function load(value: InfoVisitDto | null | undefined) {
  if (!value) return
  Object.assign(form, infoVisitForm(value))
  baseline.value = JSON.stringify(form)
}
watch(visit, load, { immediate: true })
const open = computed(() => !!visit.value && visit.value.status !== 'waitlisted')
const dirty = useDirty(() => open.value && JSON.stringify(form) !== baseline.value)
const staffItems = computed(() => [{ label: t.nobody, value: 0 }, ...(visit.value?.staff ?? []).map(person => ({ label: person.name, value: person.id }))])
// The kept guide of someone who left is not in the staff list: shown by name.
const guideMissing = computed(() => form.guidedByEmployeeId !== null && !(visit.value?.staff ?? []).some(person => person.id === form.guidedByEmployeeId))
const guide = computed({
  get: () => form.guidedByEmployeeId ?? 0,
  set: (value: number) => { form.guidedByEmployeeId = value === 0 ? null : value },
})

const busy = ref(false)
async function save(status?: 'open' | 'declined', message: string = de.common.saved): Promise<boolean> {
  if (busy.value) return false
  busy.value = true
  try {
    await $fetch<unknown>(`/api/info-visits/${id.value}`, { method: 'PUT', body: infoVisitBody(form, status) })
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
  if (await confirm(t.declineConfirm(form.familyName))) await save('declined', t.declined)
}
async function remove() {
  if (!visit.value || !await confirm(t.deleteRecordConfirm(visit.value.familyName))) return
  try {
    await $fetch<unknown>(`/api/info-visits/${id.value}`, { method: 'DELETE' })
    baseline.value = JSON.stringify(form)
    toast.add({ title: de.common.deleted, color: 'success' })
    await navigateTo('/children?tab=infoVisits')
  }
  catch (failure) {
    toast.add({ title: errorMessage(failure), color: 'error' })
  }
}

// „Als Vormerkung übernehmen“
const canTakeOver = computed(() => can('children.ownAccount') && can('children.edit'))
const takeOverOpen = ref(false)
const takeOver = reactive({ birthDate: '', documentTypeId: 0 })
const types = ref<DocumentTypeDto[]>([])
const typeItems = computed(() => types.value.map(type => ({ label: type.name, value: type.id })))
async function startTakeOver() {
  if (dirty.value && !await save()) return
  takeOver.birthDate = visit.value?.childBirthDate ?? ''
  if (visit.value?.documents.length) {
    try {
      types.value = await $fetch<DocumentTypeDto[]>('/api/document-types')
    }
    catch (failure) {
      return void toast.add({ title: errorMessage(failure), color: 'error' })
    }
    takeOver.documentTypeId = defaultDocumentType(types.value, 'Sonstiges')?.id ?? 0
  }
  takeOverOpen.value = true
}
async function confirmTakeOver() {
  if (busy.value) return
  busy.value = true
  try {
    const { childId } = await $fetch<{ childId: number }>(`/api/info-visits/${id.value}/take-over`, {
      method: 'POST', body: { birthDate: takeOver.birthDate, documentTypeId: visit.value?.documents.length ? takeOver.documentTypeId || null : null },
    })
    takeOverOpen.value = false
    await refresh()
    toast.add({ title: t.takeOverDone, color: 'success', actions: [{ label: t.toChild, onClick: () => { void navigateTo(`/children/${childId}`) } }] })
  }
  catch (failure) {
    toast.add({ title: errorMessage(failure), color: 'error' })
  }
  finally {
    busy.value = false
  }
}
const childNamed = computed(() => form.childFirstName.trim() !== '' && form.childLastName.trim() !== '')
</script>

<template>
  <div class="max-w-4xl space-y-4">
    <NuxtLink to="/children?tab=infoVisits" class="inline-flex items-center gap-1 text-sm text-sky-700 hover:underline">
      <UIcon name="i-lucide-arrow-left" class="size-4" />{{ t.back }}
    </NuxtLink>
    <p v-if="error || !visit" class="rounded-lg bg-white p-4 text-sm ring-1 ring-gray-200">{{ errorMessage(error) }}</p>
    <template v-else>
      <div class="flex flex-wrap items-center gap-2">
        <h1 class="text-2xl font-semibold">{{ visit.familyName }}</h1>
        <span class="rounded bg-gray-100 px-2 py-0.5 text-xs text-gray-700">{{ t.infoStatus[visit.status] }}</span>
        <span class="text-xs text-gray-500">{{ t.lastChanged(visit.updatedBy, formatDateTime(visit.updatedAt)) }}</span>
      </div>

      <UAlert v-if="!open" color="success" variant="soft" :title="t.transferredInfo">
        <template v-if="visit.childId" #actions>
          <UButton size="sm" color="neutral" variant="outline" icon="i-lucide-baby" :label="t.toChild" :to="`/children/${visit.childId}`" />
        </template>
      </UAlert>

      <form class="space-y-3 rounded-lg bg-white p-4 ring-1 ring-gray-200" @submit.prevent="save()">
        <fieldset :disabled="!open" class="grid gap-3 sm:grid-cols-2">
          <UFormField :label="t.fields.visitDate" required>
            <DateTextInput v-model="form.visitDate" :label="t.fields.visitDate" class="w-full" required :disabled="!open" />
          </UFormField>
          <UFormField :label="t.fields.visitStart">
            <TimeInput v-model="form.visitStart" any-minute />
          </UFormField>
          <UFormField :label="t.fields.familyName" class="sm:col-span-2" required>
            <UInput v-model="form.familyName" maxlength="120" class="w-full" required />
          </UFormField>
          <UFormField :label="t.fields.phone">
            <UInput v-model="form.phone" maxlength="50" type="tel" class="w-full" />
          </UFormField>
          <UFormField :label="t.fields.email">
            <UInput v-model="form.email" maxlength="200" type="email" class="w-full" />
          </UFormField>
          <UFormField :label="t.fields.childFirstName">
            <UInput v-model="form.childFirstName" maxlength="120" class="w-full" />
          </UFormField>
          <UFormField :label="t.fields.childLastName">
            <UInput v-model="form.childLastName" maxlength="120" class="w-full" />
          </UFormField>
          <UFormField :label="t.fields.childBirthDate">
            <DateTextInput v-model="form.childBirthDate" :label="t.fields.childBirthDate" class="w-full" :disabled="!open" />
          </UFormField>
          <UFormField :label="t.fields.desiredStart">
            <DateTextInput v-model="form.desiredStart" :label="t.fields.desiredStart" class="w-full" :disabled="!open" />
          </UFormField>
          <UFormField :label="t.fields.guidedBy">
            <USelect v-model="guide" :items="guideMissing ? [...staffItems, { label: visit.guidedBy, value: form.guidedByEmployeeId! }] : staffItems" class="w-full" />
          </UFormField>
          <UFormField v-if="form.guidedByEmployeeId === null" :label="t.fields.guidedByName">
            <UInput v-model="form.guidedByName" maxlength="100" class="w-full" />
          </UFormField>
          <UFormField :label="t.fields.notes" :help="t.notesHint" class="sm:col-span-2">
            <UTextarea v-model="form.notes" :maxlength="2000" :rows="4" autoresize class="w-full" />
          </UFormField>
        </fieldset>
        <div v-if="open" class="flex flex-wrap items-center gap-2">
          <UButton type="submit" icon="i-lucide-save" :label="t.save" :loading="busy" :disabled="busy || !dirty" />
          <span v-if="dirty" class="text-sm text-amber-700">{{ de.forms.unsaved }}</span>
          <div class="flex flex-wrap gap-2 sm:ml-auto">
            <UButton
              v-if="canTakeOver" type="button" color="success" icon="i-lucide-user-plus" :label="t.takeOver" :disabled="busy || !childNamed"
              :title="childNamed ? undefined : t.takeOverNeedsName" @click="startTakeOver"
            />
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
        <p v-if="open && !canTakeOver" class="text-xs text-gray-500">{{ t.takeOverNoRight }}</p>
        <p v-else-if="open && !childNamed" class="text-xs text-gray-500">{{ t.takeOverNeedsName }}</p>
      </form>

      <VisitsDocuments kind="info" :record-id="visit.id" :owner-name="visit.familyName" :documents="visit.documents" :editable="open" @changed="refresh" />
      <VisitsForms kind="info" :record-id="visit.id" :forms="visit.forms" :templates="visit.templates" :editable="open" :refresh-list="refresh" />

      <div class="flex justify-end">
        <UButton color="error" variant="ghost" icon="i-lucide-trash-2" :label="t.deleteRecord" @click="remove" />
      </div>
    </template>

    <UModal v-model:open="takeOverOpen" :title="t.takeOverTitle">
      <template #body>
        <form class="space-y-3" @submit.prevent="confirmTakeOver">
          <p class="text-sm text-gray-600">{{ t.takeOverIntro }}</p>
          <p class="text-sm font-medium">{{ form.childFirstName }} {{ form.childLastName }}<template v-if="form.desiredStart"> · {{ t.fields.desiredStart }}: {{ formatDate(form.desiredStart) }}</template></p>
          <UFormField :label="t.takeOverBirthDate" required>
            <DateTextInput v-model="takeOver.birthDate" :label="t.takeOverBirthDate" class="w-full" required />
          </UFormField>
          <UFormField v-if="visit?.documents.length" :label="t.takeOverType" required>
            <USelect v-model="takeOver.documentTypeId" :items="typeItems" class="w-full" />
          </UFormField>
          <div class="flex gap-2">
            <UButton type="submit" color="success" :label="t.takeOver" :loading="busy" :disabled="busy || !takeOver.birthDate" />
            <UButton type="button" color="neutral" variant="ghost" :label="de.common.cancel" @click="takeOverOpen = false" />
          </div>
        </form>
      </template>
    </UModal>
  </div>
</template>
