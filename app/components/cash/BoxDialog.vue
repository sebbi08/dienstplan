<script setup lang="ts">
import { parseIsoDate, todayIso } from '#shared/domain/dates'
import type { CashBoxDto } from '#shared/types/api'
import { de } from '~/locales/de'
import { centsInput, parseStartBalance } from '~/utils/cash'

/** Create a box (box = null) or change, archive, reactivate or delete one. */
const props = defineProps<{ box: CashBoxDto | null }>()
const open = defineModel<boolean>('open', { required: true })
const emit = defineEmits<{ saved: [] }>()

const { data: groups } = useGroups()
const run = useAction()
const confirm = useConfirm()

const FACILITY = 'facility'
const form = reactive({ name: '', kind: 'cash' as 'cash' | 'account', scope: FACILITY, startYear: 2026, startMonth: 1, startBalance: '0,00' })
const error = ref('')
// The start month and balance are fixed once the start month is closed (spec Kasse §3).
const startLocked = computed(() => props.box?.closedThrough != null)

watch(open, (isOpen) => {
  if (!isOpen) return
  const box = props.box
  const today = parseIsoDate(todayIso())
  Object.assign(form, box
    ? { name: box.name, kind: box.kind, scope: box.groupId === null ? FACILITY : String(box.groupId), startYear: box.startYear, startMonth: box.startMonth, startBalance: centsInput(box.startBalance) }
    : { name: '', kind: 'cash', scope: FACILITY, startYear: today.year, startMonth: today.month, startBalance: '0,00' })
  error.value = ''
})

const kindItems = [{ label: de.cash.kinds.cash, value: 'cash' }, { label: de.cash.kinds.account, value: 'account' }]
const scopeItems = computed(() => [
  { label: de.cash.facility, value: FACILITY },
  ...(groups.value ?? []).map(group => ({ label: group.name, value: String(group.id) })),
])
// The start month is at most the running month (the server refuses later ones with cash_start_future).
const current = parseIsoDate(todayIso())
const monthItems = computed(() => de.months.map((label, index) => ({
  label, value: index + 1, disabled: Number(form.startYear) >= current.year && index + 1 > current.month,
})))
watch(() => form.startYear, (year) => {
  if (Number(year) >= current.year && form.startMonth > current.month) form.startMonth = current.month
})

async function save() {
  const startBalance = parseStartBalance(form.startBalance)
  if (startBalance === null) {
    error.value = de.cash.invalidAmount
    return
  }
  const values = {
    name: form.name.trim(), kind: form.kind, groupId: form.scope === FACILITY ? null : Number(form.scope),
    startYear: Number(form.startYear), startMonth: Number(form.startMonth), startBalance,
  }
  const box = props.box
  const ok = box
    ? await run(() => $fetch(`/api/cash/boxes/${box.id}`, { method: 'PUT', body: { ...values, archived: box.archived } }), de.common.saved)
    : await run(() => $fetch('/api/cash/boxes', { method: 'POST', body: values }), de.common.saved)
  if (ok) {
    open.value = false
    emit('saved')
  }
}

/** Archives or reactivates the box as it is stored; unsaved changes in the form are not sent along. */
async function toggleArchived() {
  const box = props.box
  if (!box) return
  if (!box.archived && !(await confirm(de.cash.archiveConfirm(box.name), { confirmLabel: de.cash.archive }))) return
  const { name, kind, groupId, startYear, startMonth, startBalance } = box
  const body = { name, kind, groupId, startYear, startMonth, startBalance, archived: !box.archived }
  if (await run(() => $fetch(`/api/cash/boxes/${box.id}`, { method: 'PUT', body }), de.common.saved)) {
    open.value = false
    emit('saved')
  }
}

async function remove() {
  const box = props.box
  if (!box || !(await confirm(de.cash.deleteConfirm(box.name)))) return
  if (await run(() => $fetch(`/api/cash/boxes/${box.id}`, { method: 'DELETE' }), de.common.deleted)) {
    open.value = false
    emit('saved')
  }
}
</script>

<template>
  <UModal v-model:open="open" :title="box ? de.cash.edit : de.cash.create">
    <template #body>
      <form class="grid grid-cols-2 gap-3" @submit.prevent="save()">
        <UFormField :label="de.cash.name" class="col-span-2">
          <UInput v-model="form.name" maxlength="60" class="w-full" required autofocus />
        </UFormField>
        <UFormField :label="de.cash.kind" class="col-span-2">
          <URadioGroup v-model="form.kind" orientation="horizontal" :items="kindItems" />
        </UFormField>
        <UFormField :label="de.cash.scope" class="col-span-2">
          <USelect v-model="form.scope" :items="scopeItems" class="w-full" />
        </UFormField>
        <UFormField :label="de.cash.startMonth">
          <USelect v-model="form.startMonth" :items="monthItems" class="w-full" :disabled="startLocked" />
        </UFormField>
        <UFormField :label="de.cash.startYear">
          <UInput v-model="form.startYear" type="number" min="2000" :max="current.year" class="w-full" :disabled="startLocked" required />
        </UFormField>
        <UFormField :label="`${de.cash.startBalance} (€)`" class="col-span-2" :description="startLocked ? de.cash.startLocked : de.cash.startBalanceHint">
          <UInput v-model="form.startBalance" inputmode="decimal" class="w-full" :disabled="startLocked" />
        </UFormField>
        <p v-if="box && box.canDelete" class="col-span-2 text-xs text-gray-500">{{ de.cash.deleteHint }}</p>
        <p v-if="error" class="col-span-2 text-sm text-red-600">{{ error }}</p>
        <div class="col-span-2 flex flex-wrap gap-2">
          <UButton v-if="box && box.canDelete" color="error" variant="ghost" icon="i-lucide-trash-2" :label="de.common.delete" @click="remove" />
          <UButton
            v-if="box" color="neutral" variant="outline" :icon="box.archived ? 'i-lucide-archive-restore' : 'i-lucide-archive'"
            :label="box.archived ? de.cash.activate : de.cash.archive" @click="toggleArchived"
          />
          <UButton class="ml-auto" color="neutral" variant="ghost" :label="de.common.cancel" @click="open = false" />
          <UButton type="submit" :label="de.common.save" />
        </div>
      </form>
    </template>
  </UModal>
</template>
