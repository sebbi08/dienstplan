<script setup lang="ts">
import type { HelpCandidateDto } from '#shared/types/api'
import { de } from '~/locales/de'
import { errorMessage } from '~/utils/errors'
import { monthTitle } from '~/utils/format'

/** Adds someone of another facility as a helper (own column) to this facility's plan for the month. */
const open = defineModel<boolean>('open', { required: true })
const props = defineProps<{ year: number; month: number }>()
const emit = defineEmits<{ done: [] }>()

const run = useAction(async () => emit('done'))
const candidates = ref<HelpCandidateDto[] | null>(null)
const loadError = ref<string | null>(null)
const employeeId = ref<number | undefined>(undefined)
/** Counts the loads, so an answer to an earlier opening of the dialog is ignored. */
let loadId = 0

watch(open, async (isOpen) => {
  if (!isOpen) return
  const id = ++loadId
  employeeId.value = undefined
  candidates.value = null
  loadError.value = null
  try {
    const loaded = await $fetch<HelpCandidateDto[]>('/api/help-outs/candidates', {
      query: { year: props.year, month: props.month },
    })
    if (id === loadId) candidates.value = loaded
  }
  catch (error) {
    if (id === loadId) loadError.value = errorMessage(error)
  }
})

const items = computed(() => (candidates.value ?? []).map(candidate => ({
  label: de.helpers.candidate(candidate.name, candidate.facilityName), value: candidate.employeeId,
})))

async function submit() {
  if (employeeId.value === undefined) return
  const ok = await run(() => $fetch<unknown>('/api/help-outs', {
    method: 'POST', body: { employeeId: employeeId.value, year: props.year, month: props.month },
  }), de.helpers.added)
  if (ok) open.value = false
}
</script>

<template>
  <UModal v-model:open="open" :title="de.helpers.title">
    <template #body>
      <form class="space-y-3" @submit.prevent="submit">
        <p class="text-sm text-gray-500">{{ de.helpers.hint(monthTitle(year, month)) }}</p>
        <UAlert v-if="loadError" color="error" variant="soft" :title="loadError" />
        <p v-else-if="candidates && !candidates.length" class="text-sm">{{ de.helpers.none }}</p>
        <UFormField v-else :label="de.helpers.person">
          <USelectMenu
            v-model="employeeId" :items="items" value-key="value" class="w-full"
            :loading="candidates === null" :search-input="{ placeholder: de.helpers.search }"
          />
        </UFormField>
        <div class="flex justify-end gap-2">
          <UButton color="neutral" variant="ghost" :label="de.common.cancel" @click="open = false" />
          <UButton type="submit" :label="de.common.add" :disabled="employeeId === undefined" />
        </div>
      </form>
    </template>
  </UModal>
</template>
