<script setup lang="ts">
import { formatTime, parseTime, validateSpan } from '#shared/domain/time'
import type { TimeSpan } from '#shared/domain/time'
import type { EntryDto } from '#shared/types/api'
import { de } from '~/locales/de'

/** Changes the times of one clicked entry; a fixed shift with other start/end becomes a special shift. */
const props = defineProps<{ entry: EntryDto | null }>()
const open = defineModel<boolean>('open', { required: true })
const emit = defineEmits<{ submit: [id: number, times: TimeSpan] }>()

const form = reactive({ start: '', end: '', breakStart: '', breakEnd: '' })
const error = ref('')
const isBreak = computed(() => props.entry?.kind === 'break')
const title = computed(() => {
  const entry = props.entry
  if (!entry) return ''
  const name = entry.kind === 'break' ? de.plan.breakEntry(entry.label.slice(1, -1)) : [entry.shortLabel, entry.label].filter(Boolean).join(' ')
  return de.modal.editTitle(name)
})
const timeText = (minutes: number | null) => (minutes === null ? '' : formatTime(minutes))
const becomesSpecial = computed(() => props.entry?.kind === 'shift'
  && (parseTime(form.start) !== props.entry.start || parseTime(form.end) !== props.entry.end))

watch(open, (isOpen) => {
  const entry = props.entry
  if (!isOpen || !entry) return
  Object.assign(form, {
    start: timeText(entry.start), end: timeText(entry.end),
    breakStart: timeText(entry.breakStart), breakEnd: timeText(entry.breakEnd),
  })
  error.value = ''
})

function submit() {
  if (!props.entry) return
  if ([form.start, form.end, form.breakStart, form.breakEnd].some(value => value.trim() && parseTime(value) === null)) {
    error.value = de.common.invalidTime
    return
  }
  const start = parseTime(form.start)
  const end = parseTime(form.end)
  if (start === null || end === null) {
    error.value = de.spanErrors.missing_times
    return
  }
  const breakStart = !isBreak.value && form.breakStart.trim() ? parseTime(form.breakStart) : null
  const breakEnd = !isBreak.value && form.breakEnd.trim() ? parseTime(form.breakEnd) : null
  const spanError = validateSpan({ start, end, breakStart, breakEnd })
  if (spanError) {
    error.value = de.spanErrors[spanError]
    return
  }
  emit('submit', props.entry.id, { start, end, breakStart, breakEnd })
  open.value = false
}
</script>

<template>
  <UModal v-model:open="open" :title="title">
    <template #body>
      <form class="grid grid-cols-2 gap-3" @submit.prevent="submit">
        <UFormField :label="de.modal.start"><TimeInput v-model="form.start" autofocus /></UFormField>
        <UFormField :label="de.modal.end"><TimeInput v-model="form.end" /></UFormField>
        <template v-if="!isBreak">
          <UFormField :label="de.modal.breakStart"><TimeInput v-model="form.breakStart" /></UFormField>
          <UFormField :label="de.modal.breakEnd"><TimeInput v-model="form.breakEnd" /></UFormField>
          <p class="col-span-2 text-xs text-gray-500">{{ de.modal.editBreakHint }}</p>
        </template>
        <p v-if="becomesSpecial" class="col-span-2 text-sm text-amber-700">{{ de.modal.becomesSpecial }}</p>
        <p v-if="error" class="col-span-2 text-sm text-red-600">{{ error }}</p>
        <div class="col-span-2 flex justify-end gap-2">
          <UButton color="neutral" variant="ghost" :label="de.common.cancel" @click="open = false" />
          <UButton type="submit" :label="de.common.save" />
        </div>
      </form>
    </template>
  </UModal>
</template>
