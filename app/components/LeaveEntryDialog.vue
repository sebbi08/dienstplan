<script setup lang="ts">
import { SPECIAL_LEAVE_REASONS, SPECIAL_LEAVE_TEXT_MAX } from '#shared/domain/specialLeave'
import type { LeaveEntryKind, LeaveEntryResultDto } from '#shared/types/api'
import { de } from '~/locales/de'
import { errorCode, errorMessage } from '~/utils/errors'
import { leaveEntryToast } from '~/utils/leaveEntry'

/**
 * „Urlaub eintragen“ for one employee (employee page, „Urlaubsplanung“): Von, Bis and the kind, past days too. The
 * server books only the person's working days; duties on the days are replaced only after asking (cells_occupied),
 * Krank, Fortbildung and the like always stay. `min`/`max` limit the dates (e.g. the coming year's block). Sonderurlaub
 * asks for the „Begründung“ (a reason of the list, „Sonstiges“ with a text; a text with any reason).
 */
const props = defineProps<{ employeeId: number; name: string; min?: string; max?: string }>()
const open = defineModel<boolean>('open', { required: true })
const emit = defineEmits<{ saved: [] }>()
const confirm = useConfirm()
const toast = useToast()

const KINDS: LeaveEntryKind[] = ['vacation', 'special_leave', 'overtime_off']
const kindItems = KINDS.map(kind => ({ label: de.leaveEntry.kinds[kind], value: kind }))
const form = reactive<{ from: string; to: string; kind: LeaveEntryKind; reason: string; reasonText: string }>({
  from: '', to: '', kind: 'vacation', reason: 'none', reasonText: '',
})
const reasonItems = [
  { label: de.specialLeave.reasonNone, value: 'none' },
  ...SPECIAL_LEAVE_REASONS.map(reason => ({ label: de.specialLeave.reasons[reason], value: reason })),
]
const isSpecial = computed(() => form.kind === 'special_leave')
const reasonMissing = computed(() => isSpecial.value && form.reason === 'other' && !form.reasonText.trim())
const saving = ref(false)
watch(open, (isOpen) => {
  if (isOpen) Object.assign(form, { from: '', to: '', kind: 'vacation', reason: 'none', reasonText: '' })
})

function send(overwrite: boolean) {
  return $fetch<LeaveEntryResultDto>(`/api/employees/${props.employeeId}/leave-entries`, {
    method: 'POST',
    body: {
      from: form.from, to: form.to, kind: form.kind, overwrite,
      ...(isSpecial.value ? { specialLeaveReason: form.reason === 'none' ? null : form.reason, specialLeaveText: form.reasonText.trim() || null } : {}),
    },
  })
}

function failed(failure: unknown) {
  if (errorCode(failure) !== 'facility_changed') toast.add({ title: errorMessage(failure), color: 'error' })
}

async function save() {
  if (!form.from || !form.to || saving.value || reasonMissing.value) return
  saving.value = true
  try {
    let result: LeaveEntryResultDto
    try {
      result = await send(false)
    }
    catch (failure) {
      const data = (failure as { data?: { data?: { code?: string; details?: { days?: number; entries?: boolean } } } }).data?.data
      if (data?.code !== 'cells_occupied') return failed(failure)
      const question = de.leavePlanning.overwriteConfirm(data.details?.days ?? 0, de.leaveEntry.kinds[form.kind], data.details?.entries)
      if (!await confirm(question, { confirmLabel: de.leaveEntry.overwrite, danger: false })) return
      try {
        result = await send(true)
      }
      catch (again) {
        return failed(again)
      }
    }
    toast.add(leaveEntryToast(result, de.leaveEntry.kindNames[form.kind]))
    open.value = false
    emit('saved')
  }
  finally {
    saving.value = false
  }
}
</script>

<template>
  <UModal v-model:open="open" :title="de.leaveEntry.title(name)">
    <template #body>
      <form class="space-y-3" @submit.prevent="save">
        <p class="text-sm text-gray-500">{{ de.leaveEntry.hint }}</p>
        <UFormField :label="de.leaveEntry.kind">
          <URadioGroup v-model="form.kind" orientation="horizontal" :items="kindItems" />
        </UFormField>
        <div class="grid gap-3 sm:grid-cols-2">
          <UFormField :label="de.leaveEntry.from">
            <DateTextInput v-model="form.from" :label="de.leaveEntry.from" :min="min" :max="max" class="w-full" required />
          </UFormField>
          <UFormField :label="de.leaveEntry.to">
            <DateTextInput v-model="form.to" :label="de.leaveEntry.to" :min="form.from || min" :max="max" class="w-full" required />
          </UFormField>
        </div>
        <template v-if="isSpecial">
          <UFormField :label="de.specialLeave.reason">
            <USelect v-model="form.reason" :items="reasonItems" class="w-full" />
          </UFormField>
          <UFormField :label="de.specialLeave.text" :help="de.specialLeave.textHint" :required="form.reason === 'other'">
            <UInput v-model="form.reasonText" :maxlength="SPECIAL_LEAVE_TEXT_MAX" class="w-full" />
          </UFormField>
        </template>
        <div class="flex justify-end gap-2">
          <UButton color="neutral" variant="ghost" :label="de.common.cancel" @click="open = false" />
          <UButton type="submit" icon="i-lucide-calendar-plus" :label="de.leaveEntry.save" :loading="saving" :disabled="!form.from || !form.to || reasonMissing" />
        </div>
      </form>
    </template>
  </UModal>
</template>
