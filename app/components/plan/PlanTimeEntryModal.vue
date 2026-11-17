<script setup lang="ts">
import { formatDuration } from '#shared/domain/time'
import type { CodeDto, EntryInput } from '#shared/types/api'
import { de } from '~/locales/de'
import { allowsFullDay, allowsHomeOffice, timeEntryInput } from '~/utils/timeEntry'
import { workTime } from '~/utils/workTime'

const props = defineProps<{ code: CodeDto | null }>()
const open = defineModel<boolean>('open', { required: true })
const emit = defineEmits<{ submit: [entry: EntryInput] }>()

const form = reactive({ start: '', end: '', breakStart: '', breakEnd: '', note: '', homeOffice: false })
const error = ref('')
const hint = computed(() => workTime(form))
const title = computed(() => (props.code ? de.modal.codeTitle(props.code.label) : de.modal.specialTitle))
/** „Homeoffice – zählt ohne Stempeln“ fits working time only: a special shift or a timed code (Büro, VZ), with or without times. */
const homeOfficeAllowed = computed(() => allowsHomeOffice(props.code))
/** A timed code (Büro, VZ) may stay without times: the whole day. */
const fullDayAllowed = computed(() => allowsFullDay(props.code))

watch(open, (isOpen) => {
  if (!isOpen) return
  Object.assign(form, { start: '', end: '', breakStart: '', breakEnd: '', note: '', homeOffice: false })
  error.value = ''
})

function submit() {
  const result = timeEntryInput(form, props.code)
  if ('error' in result) {
    error.value = result.error
    return
  }
  emit('submit', result.entry)
  open.value = false
}
</script>

<template>
  <UModal v-model:open="open" :title="title">
    <template #body>
      <form class="grid grid-cols-2 gap-3" @submit.prevent="submit">
        <UFormField :label="de.modal.start"><TimeInput v-model="form.start" autofocus /></UFormField>
        <UFormField :label="de.modal.end"><TimeInput v-model="form.end" /></UFormField>
        <p v-if="fullDayAllowed" class="col-span-2 text-sm text-gray-600">{{ de.modal.fullDayHint }}</p>
        <UFormField :label="de.modal.breakStart"><TimeInput v-model="form.breakStart" /></UFormField>
        <UFormField :label="de.modal.breakEnd"><TimeInput v-model="form.breakEnd" /></UFormField>
        <p v-if="hint" class="col-span-2 text-sm text-gray-700" aria-live="polite">
          {{ de.modal.workTime(formatDuration(hint.present), formatDuration(hint.worked)) }} ·
          <span :class="hint.ok ? 'text-green-700' : 'text-amber-700'">{{ de.modal.legalBreak(hint.required, hint.ok) }}</span>
        </p>
        <UFormField :label="de.modal.note" class="col-span-2"><UInput v-model="form.note" maxlength="200" class="w-full" /></UFormField>
        <UCheckbox
          v-if="homeOfficeAllowed" v-model="form.homeOffice" class="col-span-2" :label="de.modal.homeOffice"
          :description="de.modal.homeOfficeHint"
        />
        <p v-if="error" class="col-span-2 text-sm text-red-600">{{ error }}</p>
        <div class="col-span-2 flex justify-end gap-2">
          <UButton color="neutral" variant="ghost" :label="de.common.cancel" @click="open = false" />
          <UButton type="submit" :label="de.modal.save" />
        </div>
      </form>
    </template>
  </UModal>
</template>
