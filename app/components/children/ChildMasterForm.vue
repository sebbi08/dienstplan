<script setup lang="ts">
import { todayIso } from '#shared/domain/dates'
import { isManager } from '#shared/domain/roles'
import type { AdmissionStatus } from '#shared/domain/children'
import type { ChildMasterInput, ChildMasterUpdateInput, ChildRecordDto } from '#shared/types/api'
import { de } from '~/locales/de'
import { orNull } from '~/utils/children'
import { errorMessage } from '~/utils/errors'
import { formatDate } from '~/utils/format'

/**
 * Master data (Stammdaten): the section of the record, or, without `child`, the form that creates a new child.
 * Whoever may edit child records can choose a group and care type (`canPickGroup`; the group list for the child pages is
 * readable for everyone who sees child records); without that right the stored group is kept as it is.
 */
/** `reload` re-reads the record after a save (not needed while creating); the guard in `save` holds until it is done. */
const props = defineProps<{ child?: ChildRecordDto; lookups: ReturnType<typeof useChildLookups>; reload?: () => Promise<unknown>; initialStatus?: AdmissionStatus }>()
const run = useAction(async () => { await props.reload?.() })
const { groups, careTypes, staff, canPickGroup, groupName, careTypeName } = props.lookups

const creating = !props.child
const editing = ref(creating)
const today = todayIso()

const empty = { lastName: '', firstName: '', birthDate: '', address: '', groupId: 0, careTypeId: 0, admissionStatus: 'contract' as AdmissionStatus, waitlistedOn: '', entryDate: '', plannedEntryDate: '', infoMeetingDate: '', schoolStartDate: '', primarySchool: '', schoolDistrict: '', keyEducatorId: 0, note: '' }
const form = reactive({ ...empty })
/**
 * The group the form was filled with. It goes along with every save, so the server takes only another group than this
 * one as a group change: a form that was open while a planned change was applied does not undo it.
 */
let loadedGroupId: number | null = null
function reset() {
  const master = props.child?.master
  loadedGroupId = master?.groupId ?? null
  Object.assign(form, master
    ? {
        ...master, groupId: master.groupId ?? 0, careTypeId: master.careTypeId ?? 0, keyEducatorId: master.keyEducatorId ?? 0,
        waitlistedOn: master.waitlistedOn ?? '', entryDate: master.entryDate ?? '', plannedEntryDate: master.plannedEntryDate ?? '',
        infoMeetingDate: master.infoMeetingDate ?? '', schoolStartDate: master.schoolStartDate ?? '',
      }
    : { ...empty, admissionStatus: props.initialStatus ?? 'contract', waitlistedOn: props.initialStatus === 'waitlist' ? today : '' })
}
reset()
// Another section's save refreshes the record; do not wipe what is being typed here.
watch(() => props.child?.master, () => { if (!editing.value) reset() })
watch(editing, (value) => { if (value) reset() })

const waitlisted = computed(() => form.admissionStatus === 'waitlist')
// A waitlist entry has no entry date (the wish goes into "geplanter Eintritt") and is dated; the date is pre-filled with today.
watch(waitlisted, (value) => {
  if (!value) return
  form.entryDate = ''
  if (!form.waitlistedOn) form.waitlistedOn = today
})
// A child that has already started cannot become a waitlist entry again (the server refuses it); for such a record the
// "Stand" is only shown.
const mayChooseStatus = computed(() => creating || props.child?.status === 'planned')
const statusItems = [
  { label: de.children.admission.waitlist, value: 'waitlist' },
  { label: de.children.admission.contract, value: 'contract' },
]

const { user } = useUserSession()
/** Managers plan group changes; a Vormerkung only has a desired group and an archived record cannot change. */
const canPlanChange = computed(() =>
  !!props.child && !!props.reload && isManager(user.value?.role)
  && props.child.master.admissionStatus !== 'waitlist' && props.child.status !== 'archived')
const changeDialog = ref(false)
const confirm = useConfirm()
const { busy: changeBusy, run: runChange } = useBusyAction(async () => { await props.reload?.() })
async function removeChange() {
  const change = props.child?.pendingGroupChange
  if (change && await confirm(de.groupChange.confirmDelete)) runChange(() => $fetch<unknown>(`/api/child-group-changes/${change.id}`, { method: 'DELETE' }), de.common.deleted)
}

const showGroup = computed(() => (canPickGroup.value && groups.value.length > 0) || (!creating && props.child!.master.groupId !== null))
const groupItems = computed(() => [{ label: de.children.noGroup, value: 0 }, ...groups.value.map(group => ({ label: group.name, value: group.id }))])
const staffItems = computed(() => [{ label: de.children.noKeyEducator, value: 0 }, ...staff.value.map(person => ({ label: person.name, value: person.id }))])
const careTypeItems = computed(() => [{ label: de.children.noSelection, value: 0 }, ...careTypes.value.map(type => ({ label: type.name, value: type.id }))])

function payload(): ChildMasterInput {
  return {
    lastName: form.lastName, firstName: form.firstName, birthDate: form.birthDate, address: form.address,
    // Without the right to read the groups the form keeps the group it was filled with (null for a new child).
    groupId: canPickGroup.value ? form.groupId || null : loadedGroupId,
    careTypeId: form.careTypeId || null,
    entryDate: waitlisted.value ? null : orNull(form.entryDate), plannedEntryDate: orNull(form.plannedEntryDate),
    admissionStatus: form.admissionStatus, waitlistedOn: waitlisted.value ? orNull(form.waitlistedOn) : null,
    infoMeetingDate: orNull(form.infoMeetingDate), schoolStartDate: orNull(form.schoolStartDate),
    primarySchool: form.primarySchool, schoolDistrict: form.schoolDistrict, keyEducatorId: form.keyEducatorId || null,
    note: form.note,
  }
}

const { busy, guard } = useBusy()
async function create(): Promise<boolean> {
  try {
    const { id } = await $fetch<{ id: number }>('/api/children', { method: 'POST', body: payload() })
    // The guard in save() holds until the navigation is done, so the child cannot be created twice.
    await navigateTo(`/children/${id}`)
    return true
  }
  catch (error) {
    useToast().add({ title: errorMessage(error), color: 'error' })
    return false
  }
}
async function save() {
  const ok = await guard(() => creating
    ? create()
    : run(() => $fetch<unknown>(`/api/children/${props.child!.id}/master`, { method: 'PUT', body: { ...payload(), baseGroupId: loadedGroupId } satisfies ChildMasterUpdateInput }), de.common.saved))
  if (ok && !creating) editing.value = false
}

function cancel() {
  if (creating) {
    navigateTo('/children')
    return
  }
  reset()
  editing.value = false
}

const f = de.children.fields
const a = de.children.admission
/** The school start the facility's cutoff yields; the manual date wins over it. Not known while a child is created. */
const computedText = computed(() => (props.child ? de.schoolChildren.computed(formatDate(props.child.computedSchoolStart)) : ''))
const rows = computed<{ label: string; value: string; multiline?: boolean; hint?: string; badge?: string }[]>(() => {
  const master = props.child?.master
  if (!master) return []
  const date = (value: string | null) => (value ? formatDate(value) : '')
  return [
    { label: f.birthDate, value: date(master.birthDate) },
    { label: f.address, value: master.address, multiline: true },
    ...(showGroup.value ? [{ label: f.group, value: groupName(master.groupId) }] : []),
    { label: f.careType, value: careTypeName(master.careTypeId) ?? '' },
    { label: a.label, value: master.admissionStatus === 'waitlist' ? a.waitlist : a.contract },
    ...(master.admissionStatus === 'waitlist' ? [{ label: a.waitlistedOn, value: date(master.waitlistedOn) }] : []),
    { label: f.entryDate, value: date(master.entryDate) },
    { label: f.plannedEntryDate, value: date(master.plannedEntryDate) },
    { label: f.infoMeetingDate, value: date(master.infoMeetingDate) },
    {
      label: f.schoolStartDate, value: date(master.schoolStartDate), hint: computedText.value,
      badge: master.schoolStartDate !== null ? de.schoolChildren.deviating : '',
    },
    { label: f.primarySchool, value: master.primarySchool },
    { label: f.schoolDistrict, value: master.schoolDistrict },
    { label: f.keyEducator, value: props.child?.keyEducatorName ?? '' },
    { label: f.note, value: master.note, multiline: true },
  ]
})
</script>

<template>
  <ChildrenChildSection
    v-model:editing="editing" :title="creating ? de.children.createTitle : de.children.sections.master"
    :stamp="child?.stamps.master ?? { updatedAt: null, updatedBy: null }" :can-edit="!!child?.canEdit"
  >
    <template v-if="canPlanChange && !child!.pendingGroupChange" #actions>
      <UButton size="xs" color="neutral" variant="outline" icon="i-lucide-arrow-right-left" :label="de.groupChange.plan" @click="changeDialog = true" />
    </template>
    <template v-if="child && reload" #banner>
      <ChildrenReviewBanner :child="child" section="careType" :reload="reload" named />
      <ChildrenReviewBanner :child="child" section="keyEducator" :reload="reload" named />
    </template>

    <!-- The planned change stands in the record for everyone who reads it; only managers change or delete it. -->
    <div v-if="child?.pendingGroupChange" class="mb-3 flex flex-wrap items-center gap-2 rounded-lg bg-sky-50 p-3 text-sm text-sky-900 ring-1 ring-sky-200">
      <UIcon name="i-lucide-arrow-right-left" class="size-4 shrink-0" aria-hidden="true" />
      <span class="min-w-0 flex-1">{{ de.groupChange.pending(formatDate(child.pendingGroupChange.date), child.pendingGroupChange.groupName) }}</span>
      <template v-if="canPlanChange">
        <UButton size="xs" color="neutral" variant="ghost" icon="i-lucide-pencil" :aria-label="de.common.edit" :disabled="changeBusy" @click="changeDialog = true" />
        <UButton size="xs" color="error" variant="ghost" icon="i-lucide-trash-2" :aria-label="de.common.delete" :loading="changeBusy" :disabled="changeBusy" @click="removeChange" />
      </template>
    </div>

    <dl class="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
      <div v-for="row in rows" :key="row.label" :class="row.multiline ? 'sm:col-span-2' : ''">
        <dt class="text-xs text-gray-500">{{ row.label }}</dt>
        <dd :class="row.multiline ? 'whitespace-pre-line' : ''">
          {{ row.value || de.children.noValue }}
          <UBadge v-if="row.badge" color="warning" variant="subtle" size="sm" class="ml-1" :label="row.badge" />
        </dd>
        <p v-if="row.hint" class="text-xs text-gray-500">{{ row.hint }}</p>
      </div>
    </dl>

    <template #edit>
      <form class="grid gap-3 sm:grid-cols-2" @submit.prevent="save">
        <UFormField :label="f.lastName" required><UInput v-model="form.lastName" maxlength="100" class="w-full" required /></UFormField>
        <UFormField :label="f.firstName" required><UInput v-model="form.firstName" maxlength="100" class="w-full" required /></UFormField>
        <UFormField :label="f.birthDate" required><UInput v-model="form.birthDate" type="date" :max="today" class="w-full" required /></UFormField>
        <UFormField v-if="showGroup && canPickGroup" :label="f.group"><USelect v-model="form.groupId" :items="groupItems" class="w-full" /></UFormField>
        <UFormField :label="f.careType"><USelect v-model="form.careTypeId" :items="careTypeItems" class="w-full" /></UFormField>
        <UFormField :label="f.address" class="sm:col-span-2"><UTextarea v-model="form.address" :rows="3" maxlength="500" class="w-full" /></UFormField>
        <UFormField v-if="mayChooseStatus" :label="a.label"><USelect v-model="form.admissionStatus" :items="statusItems" class="w-full" /></UFormField>
        <UFormField v-else :label="a.label"><p class="py-1.5 text-sm">{{ form.admissionStatus === 'waitlist' ? a.waitlist : a.contract }}</p></UFormField>
        <UFormField v-if="waitlisted" :label="a.waitlistedOn"><UInput v-model="form.waitlistedOn" type="date" class="w-full" /></UFormField>
        <UFormField :label="f.entryDate"><UInput v-model="form.entryDate" type="date" :disabled="waitlisted" class="w-full" /></UFormField>
        <UFormField :label="f.plannedEntryDate"><UInput v-model="form.plannedEntryDate" type="date" class="w-full" /></UFormField>
        <UFormField :label="f.infoMeetingDate"><UInput v-model="form.infoMeetingDate" type="date" class="w-full" /></UFormField>
        <UFormField :label="f.schoolStartDate" :help="computedText || undefined"><UInput v-model="form.schoolStartDate" type="date" class="w-full" /></UFormField>
        <UFormField :label="f.primarySchool"><UInput v-model="form.primarySchool" maxlength="200" class="w-full" /></UFormField>
        <UFormField :label="f.schoolDistrict"><UInput v-model="form.schoolDistrict" maxlength="100" class="w-full" /></UFormField>
        <UFormField :label="f.keyEducator"><USelect v-model="form.keyEducatorId" :items="staffItems" class="w-full" /></UFormField>
        <UFormField :label="f.note" class="sm:col-span-2"><UTextarea v-model="form.note" :rows="3" maxlength="2000" class="w-full" /></UFormField>
        <div class="flex gap-2 sm:col-span-2">
          <UButton type="submit" :label="creating ? (waitlisted ? a.createWaitlist : de.children.create) : de.common.save" :loading="busy" :disabled="busy" />
          <UButton type="button" color="neutral" variant="ghost" :label="de.common.cancel" @click="cancel" />
        </div>
      </form>
    </template>
  </ChildrenChildSection>
  <ChildrenGroupChangeDialog v-if="canPlanChange && child && reload" v-model:open="changeDialog" :child="child" :groups="groups" :reload="reload" />
</template>
