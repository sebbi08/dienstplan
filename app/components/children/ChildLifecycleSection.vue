<script setup lang="ts">
import { todayIso } from '#shared/domain/dates'
import { isManager } from '#shared/domain/roles'
import type { ChildRecordDto } from '#shared/types/api'
import { de } from '~/locales/de'
import { formatDate } from '~/utils/format'

/**
 * Leaving (Abmeldung) and, for the Träger, moving the record to another facility. Managers only; "Sofort löschen"
 * lives in the archive tab. The server decides who may do what as well.
 */
const props = defineProps<{ child: ChildRecordDto }>()
const emit = defineEmits<{ saved: [] }>()
const { user } = useUserSession()
const manager = computed(() => isManager(user.value?.role))
const isProvider = computed(() => user.value?.role === 'provider')

const runAction = useAction(async () => emit('saved'))
// One request at a time: no double submit.
const busy = ref(false)
async function run(action: () => Promise<unknown>, successMessage?: string): Promise<boolean> {
  if (busy.value) return false
  busy.value = true
  try {
    return await runAction(action, successMessage)
  }
  finally {
    busy.value = false
  }
}
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
const unleave = () => run(() => $fetch<unknown>(`/api/children/${props.child.id}/unleave`, { method: 'POST' }), de.common.saved)

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

    <div v-if="child.leftOn" class="flex flex-wrap items-center gap-3 text-sm">
      <span>{{ de.childLifecycle.leavesOn(formatDate(child.leftOn)) }}<template v-if="child.purgeOn"> · {{ de.childLifecycle.purgeOn(formatDate(child.purgeOn)) }}</template></span>
      <UButton size="xs" color="neutral" variant="outline" :label="de.childLifecycle.unleave" :disabled="busy" @click="unleave" />
    </div>
    <form v-else class="flex flex-wrap items-end gap-3" @submit.prevent="leave">
      <UFormField :label="de.childLifecycle.leftOn"><UInput v-model="leftOn" type="date" required /></UFormField>
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
