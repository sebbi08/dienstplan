<script setup lang="ts">
import { parseIsoDate, todayIso } from '#shared/domain/dates'
import { isValidLeaveExtraDays, LEAVE_EXTRA_DAYS_MAX, LEAVE_EXTRA_REASON_MAX } from '#shared/domain/leave'
import { de } from '~/locales/de'
import { errorCode, errorMessage } from '~/utils/errors'

/**
 * „Zusatztag nur für dieses Jahr“ (employee page, under „Urlaubsanspruch“): Jahr (this year by default), Tage (1 by
 * default, half days allowed) and a required Begründung. The days count only in that year; the server checks the same.
 */
const props = defineProps<{ employeeId: number; name: string }>()
const open = defineModel<boolean>('open', { required: true })
const emit = defineEmits<{ saved: [] }>()
const toast = useToast()

const form = reactive({ year: parseIsoDate(todayIso()).year, days: 1, reason: '' })
const saving = ref(false)
const valid = computed(() => Number.isInteger(form.year) && isValidLeaveExtraDays(form.days) && form.reason.trim() !== '')
watch(open, (isOpen) => {
  if (isOpen) Object.assign(form, { year: parseIsoDate(todayIso()).year, days: 1, reason: '' })
})

async function save() {
  if (!valid.value || saving.value) return
  saving.value = true
  try {
    await $fetch<{ id: number }>(`/api/employees/${props.employeeId}/leave-extra-days`, {
      method: 'POST', body: { year: form.year, days: form.days, reason: form.reason.trim() },
    })
    toast.add({ title: de.common.saved, color: 'success' })
    open.value = false
    emit('saved')
  }
  catch (failure) {
    if (errorCode(failure) !== 'facility_changed') toast.add({ title: errorMessage(failure), color: 'error' })
  }
  finally {
    saving.value = false
  }
}
</script>

<template>
  <UModal v-model:open="open" :title="de.leaveExtraDays.dialogTitle(name)">
    <template #body>
      <form class="space-y-3" @submit.prevent="save">
        <p class="text-sm text-gray-500">{{ de.leaveExtraDays.hint }}</p>
        <div class="grid gap-3 sm:grid-cols-2">
          <UFormField :label="de.leaveExtraDays.year">
            <UInput v-model.number="form.year" type="number" min="2000" max="2100" class="w-full" required />
          </UFormField>
          <UFormField :label="de.leaveExtraDays.days" :help="de.leaveExtraDays.daysHint">
            <UInput v-model.number="form.days" type="number" step="0.5" min="0.5" :max="LEAVE_EXTRA_DAYS_MAX" class="w-full" required />
          </UFormField>
        </div>
        <UFormField :label="de.leaveExtraDays.reason" required>
          <UInput v-model="form.reason" :maxlength="LEAVE_EXTRA_REASON_MAX" :placeholder="de.leaveExtraDays.reasonPlaceholder" class="w-full" required />
        </UFormField>
        <div class="flex justify-end gap-2">
          <UButton color="neutral" variant="ghost" :label="de.common.cancel" @click="open = false" />
          <UButton type="submit" icon="i-lucide-plus" :label="de.leaveExtraDays.save" :loading="saving" :disabled="!valid" />
        </div>
      </form>
    </template>
  </UModal>
</template>
