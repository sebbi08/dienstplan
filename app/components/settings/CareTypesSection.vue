<script setup lang="ts">
import { formatTime, parseTime } from '#shared/domain/time'
import type { CareTypeDto } from '#shared/types/api'
import { de } from '~/locales/de'

/** Care types (Betreuungsformen) of the facility: a name and the booked time window. */
interface Form { id: number | null; name: string; start: string; end: string; sortOrder: number }

const toast = useToast()
const { forms, newForm, busy, save, remove } = useTypeList<CareTypeDto, Form>({
  url: '/api/care-types',
  key: 'settings-care-types',
  // The child pages offer the same list; keep them in step.
  refreshKeys: ['care-types'],
  empty: () => ({ id: null, name: '', start: '', end: '', sortOrder: 0 }),
  toForm: type => ({ id: type.id, name: type.name, start: formatTime(type.start), end: formatTime(type.end), sortOrder: type.sortOrder }),
  toBody: (form) => {
    const start = parseTime(form.start)
    const end = parseTime(form.end)
    if (start === null || end === null) {
      toast.add({ title: de.settings.invalidTime, color: 'error' })
      return null
    }
    return { name: form.name, start, end, sortOrder: form.sortOrder }
  },
})

const cell = 'px-1 py-1'
const textInput = 'w-full rounded border border-gray-300 px-1 py-0.5'
</script>

<template>
  <section class="space-y-2 rounded-lg bg-white p-4 ring-1 ring-gray-200">
    <h2 class="font-semibold">{{ de.childSettings.careTypes }}</h2>
    <p class="text-xs text-gray-500">{{ de.childSettings.careTypesHint }}</p>
    <div class="overflow-x-auto">
      <table class="w-full text-sm">
        <thead class="text-left text-xs text-gray-500">
          <tr>
            <th :class="cell">{{ de.settings.label }}</th><th :class="cell">{{ de.settings.start }}</th><th :class="cell">{{ de.settings.end }}</th>
            <th :class="cell">{{ de.settings.sortOrder }}</th><th />
          </tr>
        </thead>
        <tbody>
          <tr v-for="form in [...forms, newForm]" :key="form.id ?? 'new'" class="border-t border-gray-100">
            <td :class="cell"><input v-model="form.name" maxlength="80" :class="textInput" :aria-label="de.settings.label"></td>
            <td :class="cell"><TimeInput v-model="form.start" class="w-20" :aria-label="de.settings.start" @keydown.enter="save(form)" /></td>
            <td :class="cell"><TimeInput v-model="form.end" class="w-20" :aria-label="de.settings.end" @keydown.enter="save(form)" /></td>
            <td :class="cell"><input v-model.number="form.sortOrder" type="number" min="0" max="10000" class="w-16 rounded border border-gray-300 px-1 py-0.5" :aria-label="de.settings.sortOrder" :disabled="!form.id"></td>
            <td :class="cell" class="whitespace-nowrap text-right">
              <UButton size="xs" :label="form.id ? de.common.save : de.common.add" :disabled="busy" @click="save(form)" />
              <UButton v-if="form.id" size="xs" color="error" variant="ghost" icon="i-lucide-trash-2" :aria-label="de.common.delete" :disabled="busy" @click="remove(form)" />
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </section>
</template>
