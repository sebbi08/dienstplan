<script setup lang="ts">
import { formatTime, parseTime } from '#shared/domain/time'
import { de } from '~/locales/de'

/**
 * Adds or changes one time record (minute-precise; end required).
 * The parent closes the dialog once saving succeeded, so a rejected entry keeps the typed times.
 */
const props = defineProps<{ title: string; initial: { start: number; end: number | null } | null }>()
const open = defineModel<boolean>('open', { required: true })
const emit = defineEmits<{ submit: [value: { start: number; end: number }] }>()
const form = reactive({ start: '', end: '' })
const error = ref('')

watch(open, (isOpen) => {
  if (!isOpen) return
  form.start = props.initial ? formatTime(props.initial.start) : ''
  form.end = props.initial?.end != null ? formatTime(props.initial.end) : ''
  error.value = ''
})

function submit() {
  const start = parseTime(form.start)
  const end = parseTime(form.end)
  if (start === null || end === null) {
    error.value = de.spanErrors.missing_times
    return
  }
  if (end <= start) {
    error.value = de.spanErrors.end_before_start
    return
  }
  emit('submit', { start, end })
}
</script>

<template>
  <UModal v-model:open="open" :title="title">
    <template #body>
      <form class="grid grid-cols-2 gap-3" @submit.prevent="submit">
        <UFormField :label="de.modal.start"><TimeInput v-model="form.start" any-minute autofocus /></UFormField>
        <UFormField :label="de.modal.end"><TimeInput v-model="form.end" any-minute /></UFormField>
        <p v-if="error" class="col-span-2 text-sm text-red-600">{{ error }}</p>
        <div class="col-span-2 flex justify-end gap-2">
          <UButton color="neutral" variant="ghost" :label="de.common.cancel" @click="open = false" />
          <UButton type="submit" :label="de.common.save" />
        </div>
      </form>
    </template>
  </UModal>
</template>
