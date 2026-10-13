<script setup lang="ts">
import type { SchoolSettingsDto } from '#shared/types/api'
import { de } from '~/locales/de'

/** The school cutoff of the facility: the Träger changes it, the Leitung sees it. */
const { data, refresh } = await useFetch<SchoolSettingsDto>('/api/school-settings', { key: 'school-settings' })
const { user } = useUserSession()
const isProvider = computed(() => user.value?.role === 'provider')
const { busy, run } = useBusyAction(refresh)

const month = ref(6)
const day = ref(30)
const age = ref(6)
watch(data, (value) => {
  if (!value) return
  month.value = value.cutoffMonth
  day.value = value.cutoffDay
  age.value = value.ageYears
}, { immediate: true })

const monthItems = de.months.map((label, index) => ({ label, value: index + 1 }))
const ageItems = Array.from({ length: 5 }, (_, index) => ({ label: String(index + 4), value: index + 4 }))

const save = () => run(() => $fetch<unknown>('/api/school-settings', {
  method: 'PUT', body: { cutoffMonth: month.value, cutoffDay: day.value, ageYears: age.value },
}), de.common.saved)

const s = de.schoolChildren
</script>

<template>
  <section v-if="data" class="space-y-2 rounded-lg bg-white p-4 ring-1 ring-gray-200">
    <h2 class="font-semibold">{{ s.title }}</h2>
    <form v-if="isProvider" class="flex flex-wrap items-end gap-3" @submit.prevent="save">
      <UFormField :label="s.cutoff">
        <span class="flex items-center gap-2">
          <UInput v-model.number="day" type="number" min="1" max="31" step="1" class="w-20" :aria-label="s.day" required />
          <USelect v-model="month" :items="monthItems" class="w-36" :aria-label="s.month" />
        </span>
      </UFormField>
      <UFormField :label="s.age"><USelect v-model="age" :items="ageItems" class="w-24" /></UFormField>
      <UButton type="submit" :label="de.common.save" :loading="busy" :disabled="busy" />
    </form>
    <template v-else>
      <dl class="flex flex-wrap gap-x-8 gap-y-1 text-sm">
        <div><dt class="text-xs text-gray-500">{{ s.cutoff }}</dt><dd>{{ data.cutoffDay }}. {{ de.months[data.cutoffMonth - 1] }}</dd></div>
        <div><dt class="text-xs text-gray-500">{{ s.age }}</dt><dd>{{ data.ageYears }}</dd></div>
      </dl>
      <p class="text-xs text-gray-500">{{ s.readOnly }}</p>
    </template>
    <p class="text-xs text-gray-500">{{ s.hint }}</p>
    <p class="text-xs text-gray-500">{{ s.hintBirthday }}</p>
  </section>
</template>
