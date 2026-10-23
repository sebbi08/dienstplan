<script setup lang="ts">
import type { HoursForm } from '~/utils/openingHours'
import { de } from '~/locales/de'

/** The table Monday to Friday (opening, closing, closed) and the minimum counts of one scope: the facility or a group. */
// `dirty`: the form differs from the stored hours (only then is there anything to save).
defineProps<{ busy?: boolean; removable?: boolean; dirty?: boolean }>()
const emit = defineEmits<{ save: []; remove: [] }>()
const form = defineModel<HoursForm>({ required: true })

const o = de.openingHours
const cell = 'px-1 py-1'
const countInput = 'w-16 rounded border border-gray-300 px-1 py-0.5'
</script>

<template>
  <form class="space-y-3" @submit.prevent="emit('save')">
    <div class="overflow-x-auto">
      <table class="text-sm">
        <thead class="text-left text-xs text-gray-500">
          <tr>
            <th :class="cell">{{ o.weekday }}</th><th :class="cell">{{ o.open }}</th><th :class="cell">{{ o.close }}</th>
            <th :class="cell">{{ o.closed }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="(day, index) in form.days" :key="index" class="border-t border-gray-100">
            <td :class="cell" class="pr-3 font-medium">{{ o.weekdays[index] }}</td>
            <td :class="cell">
              <TimeInput v-model="day.open" class="w-20" :disabled="day.closed" :aria-label="`${o.weekdays[index]} ${o.open}`" />
            </td>
            <td :class="cell">
              <TimeInput v-model="day.close" class="w-20" :disabled="day.closed" :aria-label="`${o.weekdays[index]} ${o.close}`" />
            </td>
            <td :class="cell" class="text-center">
              <input v-model="day.closed" type="checkbox" :aria-label="`${o.weekdays[index]} ${o.closed}`">
            </td>
          </tr>
        </tbody>
      </table>
    </div>
    <div class="flex flex-wrap gap-4">
      <label class="flex items-center gap-2 text-sm">
        {{ o.minAtOpening }}
        <input v-model.number="form.minAtOpening" type="number" min="1" max="20" :class="countInput">
      </label>
      <label class="flex items-center gap-2 text-sm">
        {{ o.minAtClosing }}
        <input v-model.number="form.minAtClosing" type="number" min="1" max="20" :class="countInput">
      </label>
    </div>
    <div class="flex flex-wrap gap-2">
      <UButton type="submit" :label="de.common.save" :loading="busy" :disabled="busy || !dirty" />
      <UButton v-if="removable" color="neutral" variant="outline" :label="o.removeOwn" :disabled="busy" @click="emit('remove')" />
    </div>
  </form>
</template>
