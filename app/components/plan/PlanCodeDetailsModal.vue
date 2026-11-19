<script setup lang="ts">
import { isEligibleChildOn } from '#shared/domain/childSickDays'
import { SPECIAL_LEAVE_REASONS, SPECIAL_LEAVE_TEXT_MAX } from '#shared/domain/specialLeave'
import type { CodeDto, EmployeeChildrenDto, EntryInput } from '#shared/types/api'
import { de } from '~/locales/de'
import { formatDate } from '~/utils/format'

/**
 * Details of a full-day code before it is entered in the selected cells: „Kind krank“ asks „Welches Kind?“ (optional,
 * the person's children under 12 or with a disability on the first selected day; only for one person and with the
 * right to see the children, employees.personal); „Sonderurlaub“ asks for the „Begründung“ (a reason of the list,
 * „Sonstiges“ with a text), which only Leitung, Träger and the person see – the plan shows only „Sonderurlaub“.
 */
const props = defineProps<{ code: CodeDto | null; employeeId: number | null; date: string | null }>()
const open = defineModel<boolean>('open', { required: true })
const emit = defineEmits<{ submit: [entry: EntryInput] }>()
const t = de.staffChildren

const childId = ref<number>(0)
const children = ref<EmployeeChildrenDto['children']>([])
const loading = ref(false)
const reason = ref('none')
const reasonText = ref('')
const reasonItems = [
  { label: de.specialLeave.reasonNone, value: 'none' },
  ...SPECIAL_LEAVE_REASONS.map(key => ({ label: de.specialLeave.reasons[key], value: key })),
]
const reasonMissing = computed(() => props.code?.key === 'special_leave' && reason.value === 'other' && !reasonText.value.trim())
watch(open, async (isOpen) => {
  if (!isOpen) return
  childId.value = 0
  reason.value = 'none'
  reasonText.value = ''
  children.value = []
  if (props.code?.key !== 'child_sick' || props.employeeId === null) return
  loading.value = true
  try {
    children.value = (await $fetch<EmployeeChildrenDto>(`/api/employees/${props.employeeId}/children`)).children
  }
  catch {
    children.value = []
  }
  finally {
    loading.value = false
  }
})
const eligible = computed(() => children.value.filter(child => props.date !== null && isEligibleChildOn(child, props.date)))
const childItems = computed(() => [
  { label: t.noChild, value: 0 },
  ...eligible.value.map(child => ({ label: t.childLabel(child.firstName, formatDate(child.birthDate)), value: child.id })),
])

function submit() {
  if (!props.code || reasonMissing.value) return
  emit('submit', props.code.key === 'special_leave'
    ? { kind: 'code', codeId: props.code.id, specialLeaveReason: reason.value === 'none' ? null : reason.value, specialLeaveText: reasonText.value.trim() || null }
    : { kind: 'code', codeId: props.code.id, employeeChildId: childId.value || null })
  open.value = false
}
</script>

<template>
  <UModal v-model:open="open" :title="code?.label ?? ''">
    <template #body>
      <form class="space-y-3" @submit.prevent="submit">
        <template v-if="code?.key === 'child_sick'">
          <p v-if="loading" class="text-sm text-gray-500">{{ t.loading }}</p>
          <p v-else-if="!eligible.length" class="text-sm text-gray-500">{{ t.noEligible }}</p>
          <UFormField v-else :label="t.whichChild">
            <USelect v-model="childId" :items="childItems" class="w-full" />
          </UFormField>
        </template>
        <template v-else-if="code?.key === 'special_leave'">
          <UFormField :label="de.specialLeave.reason">
            <USelect v-model="reason" :items="reasonItems" class="w-full" />
          </UFormField>
          <UFormField :label="de.specialLeave.text" :help="de.specialLeave.textHint" :required="reason === 'other'">
            <UInput v-model="reasonText" :maxlength="SPECIAL_LEAVE_TEXT_MAX" class="w-full" />
          </UFormField>
        </template>
        <div class="flex justify-end gap-2">
          <UButton color="neutral" variant="ghost" :label="de.common.cancel" @click="open = false" />
          <UButton type="submit" :label="t.enter" :disabled="loading || reasonMissing" />
        </div>
      </form>
    </template>
  </UModal>
</template>
