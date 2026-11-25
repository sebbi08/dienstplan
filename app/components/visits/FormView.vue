<script setup lang="ts">
import type { VisitFormDto } from '#shared/types/api'
import { de } from '~/locales/de'
import { errorMessage } from '~/utils/errors'

/** One form of a visit, filled in with the form panel (read only without the right or once the record is taken over). */
const props = defineProps<{ formId: number; editable: boolean; refreshList: () => Promise<unknown> }>()
const emit = defineEmits<{ dirty: [value: boolean] }>()
const { data: form, error, status, refresh } = useFetch<VisitFormDto>(() => `/api/visit-forms/${props.formId}`, { key: `visit-form-${props.formId}` })
const refreshBoth = () => Promise.all([refresh(), props.refreshList()])
</script>

<template>
  <div class="min-w-0 space-y-3 py-2">
    <p v-if="status === 'pending' && !form" class="text-sm text-gray-500">{{ de.childForms.loading }}</p>
    <p v-else-if="error || !form" class="text-sm text-red-700">{{ errorMessage(error) }}</p>
    <FormsFormPanel
      v-else :key="form.id" :form="form" :save-url="`/api/visit-forms/${form.id}`" :editable="editable && form.editable"
      :refresh="refreshBoth" @dirty="emit('dirty', $event)"
    />
  </div>
</template>
