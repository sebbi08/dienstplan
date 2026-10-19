<script setup lang="ts">
import { todayIso } from '#shared/domain/dates'
import { formatTime } from '#shared/domain/time'
import type { DayMeal } from '#shared/domain/meals'
import type { MealSettingsDto, PlannedMealDto } from '#shared/types/api'
import { de } from '~/locales/de'
import { parseClock } from '~/utils/attendance'
import { formatDate, formatDayMonth } from '~/utils/format'

/**
 * The meals of the facility (Leitung and Träger): those of today with „Ändern“ and „Entfernen“, „Essen hinzufügen“,
 * and the changes from today on („Geplante und heutige Änderungen“), which can be taken back. Every change applies
 * from a day on („gilt ab“, today at the earliest); earlier days keep the meals they had.
 */
const { data, refresh } = await useFetch<MealSettingsDto>('/api/meals', { key: 'meal-settings' })
const { busy, run } = useBusyAction(refresh)
const toast = useToast()
const confirm = useConfirm()
const s = de.attendance

// One open form at a time: a change or the removal of a meal of today, or a new meal.
interface Form { kind: 'add' | 'change' | 'remove'; mealId: number | null; name: string; time: string; validFrom: string }
const form = ref<Form | null>(null)
const today = ref(todayIso())
const openForm = (kind: Form['kind'], meal?: DayMeal) => {
  today.value = todayIso()
  form.value = {
    kind, mealId: meal?.mealId ?? null, name: meal?.name ?? '', time: meal ? formatTime(meal.time) : '', validFrom: today.value,
  }
}
const isOpen = (kind: Form['kind'], mealId: number | null) => form.value?.kind === kind && form.value.mealId === mealId

// The list from the server counts from its today; keep the own one in step for „ab heute“.
watch(data, () => { today.value = todayIso() })

/** "heute" for today, otherwise "01.11.", with the year when it is not this year's. */
const dayText = (iso: string) => {
  if (iso === today.value) return s.plannedToday
  return iso.slice(0, 4) === today.value.slice(0, 4) ? formatDayMonth(iso) : formatDate(iso)
}
const plannedText = (entry: PlannedMealDto) => (entry.removed
  ? s.plannedMealRemoved(dayText(entry.validFrom), entry.name)
  : s.plannedMeal(dayText(entry.validFrom), entry.name, formatTime(entry.time)))

async function submit() {
  const current = form.value
  if (!current) return
  if (current.kind === 'remove') {
    if (current.mealId === null) return
    const ok = await confirm(s.confirmMealRemove(current.name, formatDate(current.validFrom)), { confirmLabel: s.mealRemove })
    if (!ok) return
    const done = await run(() => $fetch<unknown>(`/api/meals/${current.mealId}`, { method: 'DELETE', query: { validFrom: current.validFrom } }), de.common.saved)
    if (done) form.value = null
    return
  }
  const time = parseClock(current.time)
  if (time === null) {
    toast.add({ title: de.errors.attendance_time_invalid, color: 'error' })
    return
  }
  const body = { name: current.name, time, validFrom: current.validFrom }
  const done = await run(() => (current.kind === 'add'
    ? $fetch<unknown>('/api/meals', { method: 'POST', body })
    : $fetch<unknown>(`/api/meals/${current.mealId}`, { method: 'PUT', body })), de.common.saved)
  if (done) form.value = null
}

async function cancelPlanned(entry: PlannedMealDto) {
  // A meal that is only there from today on is gone today, and so are today's ticks for it.
  const text = entry.cancelRemovesMeal && entry.validFrom === todayIso()
    ? s.confirmCancelTodayMeal(plannedText(entry), entry.name)
    : s.confirmCancelPlanned(plannedText(entry))
  if (!(await confirm(text, { confirmLabel: s.cancelPlanned }))) return
  await run(() => $fetch<unknown>(`/api/meals/versions/${entry.versionId}`, { method: 'DELETE' }), s.plannedCancelled)
}
</script>

<template>
  <div v-if="data" class="space-y-2 border-t border-gray-200 pt-3">
    <h3 class="font-semibold">{{ s.mealsTitle }}</h3>
    <p class="text-xs text-gray-500">{{ s.mealsHint }}</p>
    <p v-if="!data.current.length" class="text-sm text-gray-600">{{ s.noMeals }}</p>
    <ul v-else class="divide-y divide-gray-100 rounded-md ring-1 ring-gray-200">
      <li v-for="meal in data.current" :key="meal.mealId" class="space-y-2 px-3 py-2">
        <div class="flex flex-wrap items-center gap-2">
          <span class="font-medium">{{ meal.name }}</span>
          <span class="tabular-nums text-gray-600">{{ formatTime(meal.time) }}</span>
          <span class="ml-auto flex gap-1">
            <UButton size="xs" color="neutral" variant="outline" icon="i-lucide-pencil" :label="s.mealChange" :disabled="busy" @click="openForm('change', meal)" />
            <UButton size="xs" color="error" variant="ghost" icon="i-lucide-trash-2" :label="s.mealRemove" :disabled="busy" @click="openForm('remove', meal)" />
          </span>
        </div>
        <SettingsMealForm
          v-if="form && (isOpen('change', meal.mealId) || isOpen('remove', meal.mealId))" v-model:name="form.name" v-model:time="form.time"
          v-model:valid-from="form.validFrom" :kind="form.kind" :busy="busy" :min="today" @submit="submit" @cancel="form = null"
        />
      </li>
    </ul>
    <SettingsMealForm
      v-if="form && isOpen('add', null)" v-model:name="form.name" v-model:time="form.time" v-model:valid-from="form.validFrom"
      :kind="form.kind" :busy="busy" :min="today" @submit="submit" @cancel="form = null"
    />
    <UButton v-else size="sm" color="neutral" variant="outline" icon="i-lucide-plus" :label="s.mealAdd" :disabled="busy" @click="openForm('add')" />

    <template v-if="data.planned.length">
      <h4 class="pt-2 text-sm font-semibold">{{ s.plannedMeals }}</h4>
      <ul class="space-y-1">
        <li v-for="entry in data.planned" :key="entry.versionId" class="flex flex-wrap items-center gap-2 text-sm">
          <span>{{ plannedText(entry) }}</span>
          <UButton size="xs" color="neutral" variant="ghost" icon="i-lucide-undo-2" :label="s.cancelPlanned" :disabled="busy" @click="cancelPlanned(entry)" />
        </li>
      </ul>
    </template>
  </div>
</template>
