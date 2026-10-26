<script setup lang="ts">
import { todayIso } from '#shared/domain/dates'
import type { ChildRecordDto } from '#shared/types/api'
import { de } from '~/locales/de'
import { formatDate } from '~/utils/format'

/**
 * Leaving (Abmeldung) and, for the Träger, moving the record to another facility. Managers only; "Sofort löschen"
 * lives in the archive tab. The server decides who may do what as well.
 */
/** `reload` re-reads the record; the busy flag stays on until it is done, so the next action works on fresh data. */
const props = defineProps<{ child: ChildRecordDto; reload: () => Promise<unknown> }>()
const { rights } = useChildRights()
const manager = computed(() => !!rights.value?.isManager)
// Moving to another facility is for the Träger in the office only (never at the tablet).
const isProvider = computed(() => !!rights.value?.canMoveFacility)

const { busy, run } = useBusyAction(() => props.reload())
const confirm = useConfirm()
const toast = useToast()

const name = computed(() => `${props.child.master.firstName} ${props.child.master.lastName}`)
const leftOn = ref(todayIso())

async function leave() {
  if (!leftOn.value) return
  if (await confirm(de.childLifecycle.confirmLeave(name.value, formatDate(leftOn.value)), { confirmLabel: de.childLifecycle.leave })) {
    run(() => $fetch<unknown>(`/api/children/${props.child.id}/leave`, { method: 'POST', body: { leftOn: leftOn.value } }), de.common.saved)
  }
}
// A waitlist entry cannot leave (the server says 400 waitlist_cannot_leave); it is deleted with everything on it.
const waitlisted = computed(() => props.child.master.admissionStatus === 'waitlist')
async function deleteWaitlist() {
  if (!await confirm(de.children.admission.confirmDeleteWaitlist, { confirmLabel: de.children.admission.deleteWaitlist })) return
  const ok = await run(() => $fetch<unknown>(`/api/children/${props.child.id}`, { method: 'DELETE' }))
  if (ok) {
    toast.add({ title: de.common.deleted, color: 'success' })
    // The record is gone, so the page would only answer "not found" now.
    await navigateTo('/children')
  }
}

// Moving: the Träger works in one facility at a time, so the others are the possible targets.
const { data: facilities } = useFacilities()
const targets = computed(() => (facilities.value?.facilities ?? []).filter(facility => facility.id !== facilities.value?.activeId))
const targetItems = computed(() => targets.value.map(facility => ({ label: facility.name, value: facility.id })))
const targetId = ref(0)

async function move() {
  const target = targets.value.find(facility => facility.id === targetId.value)
  if (!target || !await confirm(de.childLifecycle.confirmMove(target.name), { confirmLabel: de.childLifecycle.moveAction, danger: false })) return
  const ok = await run(() => $fetch<unknown>(`/api/children/${props.child.id}/facility`, { method: 'PUT', body: { facilityId: target.id } }))
  if (ok) {
    // The record is gone from this facility, so the page would only answer "not found" now.
    toast.add({ title: de.childLifecycle.moved, color: 'success' })
    await navigateTo('/children')
  }
}
</script>

<template>
  <section v-if="manager" class="space-y-3 rounded-lg bg-white p-4 ring-1 ring-gray-200">
    <h2 class="font-semibold">{{ de.childLifecycle.title }}</h2>

    <div v-if="waitlisted">
      <UButton color="error" variant="outline" icon="i-lucide-trash-2" :label="de.children.admission.deleteWaitlist" :disabled="busy" @click="deleteWaitlist" />
    </div>
    <div v-else-if="child.leftOn" class="flex flex-wrap items-center gap-3 text-sm">
      <span>{{ de.childLifecycle.leavesOn(formatDate(child.leftOn)) }}<template v-if="child.purgeOn"> · {{ de.childLifecycle.purgeOn(formatDate(child.purgeOn)) }}</template></span>
      <ChildrenUnleaveButton :child-id="child.id" :disabled="busy" :refresh="reload" />
    </div>
    <form v-else class="flex flex-wrap items-end gap-3" @submit.prevent="leave">
      <UFormField :label="de.childLifecycle.leftOn"><DateTextInput v-model="leftOn" required /></UFormField>
      <UButton type="submit" color="error" variant="outline" :label="de.childLifecycle.leave" :disabled="busy || !leftOn" />
    </form>

    <form v-if="isProvider && targets.length" class="flex flex-wrap items-end gap-3 border-t border-gray-100 pt-3" @submit.prevent="move">
      <UFormField :label="de.childLifecycle.moveTarget">
        <USelect v-model="targetId" :items="targetItems" class="w-56" :placeholder="de.childLifecycle.moveTarget" />
      </UFormField>
      <UButton type="submit" color="neutral" variant="outline" :label="de.childLifecycle.move" :disabled="busy || !targetId" />
    </form>
  </section>
</template>
