<script setup lang="ts">
import { parseIsoDate, todayIso } from '#shared/domain/dates'
import type { ClosureDto, ClosureListItemDto, ClosureMode } from '#shared/types/api'
import { de } from '~/locales/de'
import { closureDefaultDate, closureYearFromQuery, closuresInYear } from '~/utils/closures'
import { formatDate, formatNumber } from '~/utils/format'
import { calendarTabs } from '~/utils/areaTabs'

/**
 * Kalender → Schließzeiten (former menu entry; /admin/closures sends here): one year switcher (kept in the address as ?year=) for the closures, the public holidays and the
 * earlier closings. All closures are loaded once and filtered here (a facility has only a few a year).
 */
const route = useRoute()
const router = useRouter()
const year = computed({
  get: () => closureYearFromQuery(route.query.year, parseIsoDate(todayIso()).year),
  set: value => router.replace({ query: { ...route.query, year: String(value) } }),
})

const { data: list, refresh } = await useFetch<ClosureListItemDto[]>('/api/closures')
const shown = computed(() => closuresInYear(list.value ?? [], year.value))
const run = useAction(refresh)
const confirm = useConfirm()
const form = reactive<{ startDate: string; endDate: string; label: string; mode: ClosureMode }>({
  startDate: todayIso(), endDate: todayIso(), label: '', mode: 'vacation',
})
watch(year, (value) => {
  const date = closureDefaultDate(todayIso(), value)
  Object.assign(form, { startDate: date, endDate: date })
}, { immediate: true })
const modeItems = (['vacation', 'closure_day'] as const).map(mode => ({ label: de.closures.modes[mode], value: mode }))

async function create() {
  const created = { ...form }
  const ok = await run(() => $fetch<unknown>('/api/closures', { method: 'POST', body: created }), de.common.saved)
  if (!ok) return
  form.label = ''
  // A closure entered for another year: show that year, so it does not seem to vanish.
  if (closuresInYear([created], year.value).length === 0) year.value = parseIsoDate(created.startDate).year
}

const editing = ref<ClosureDto | null>(null)
const editOpen = ref(false)
function edit(closure: ClosureDto) {
  editing.value = closure
  editOpen.value = true
}
/** Reloads the list (with its leave days); a closure moved out of the shown year takes the page to its year. */
async function edited(closure: ClosureDto) {
  await refresh()
  if (closuresInYear([closure], year.value).length === 0) year.value = parseIsoDate(closure.startDate).year
}

async function remove(closure: ClosureDto) {
  if (await confirm(de.closures.confirmDelete)) run(() => $fetch<unknown>(`/api/closures/${closure.id}`, { method: 'DELETE' }), de.common.deleted)
}
// The tabs of the page (a former menu entry each).
const { can: canTab } = useCan()
</script>

<template>
  <div class="max-w-4xl space-y-6">
    <AreaTabs :tabs="calendarTabs(canTab)" />
    <div class="flex flex-wrap items-center gap-3">
      <h1 class="text-2xl font-semibold">{{ de.closures.title }}</h1>
      <YearNav v-model="year" />
    </div>
    <p v-if="!shown.length" class="text-sm text-gray-500">{{ de.closures.emptyYear(year) }}</p>
    <table v-else class="w-full overflow-hidden rounded-lg bg-white text-sm ring-1 ring-gray-200">
      <thead class="bg-gray-100 text-left text-xs text-gray-600">
        <tr><th class="px-3 py-2">{{ de.closures.from }}</th><th class="px-3 py-2">{{ de.closures.to }}</th><th class="px-3 py-2">{{ de.closures.label }}</th><th class="px-3 py-2">{{ de.closures.mode }}</th><th class="px-3 py-2 text-right">{{ de.closures.leaveDays }}</th><th /></tr>
      </thead>
      <tbody>
        <tr v-for="closure in shown" :key="closure.id" class="border-t border-gray-100">
          <td class="px-3 py-2">{{ formatDate(closure.startDate) }}</td>
          <td class="px-3 py-2">{{ formatDate(closure.endDate) }}</td>
          <td class="px-3 py-2">{{ closure.label }}</td>
          <td class="px-3 py-2">{{ de.closures.modes[closure.mode] }}</td>
          <td class="px-3 py-2 text-right" :class="{ 'text-gray-500': closure.leaveDays === null }">
            {{ closure.leaveDays === null ? de.closures.noLeave : formatNumber(closure.leaveDays) }}
          </td>
          <td class="whitespace-nowrap px-3 py-2 text-right">
            <UButton size="xs" color="neutral" variant="ghost" icon="i-lucide-pencil" :aria-label="de.common.edit" @click="edit(closure)" />
            <UButton size="xs" color="error" variant="ghost" icon="i-lucide-trash-2" :aria-label="de.common.delete" @click="remove(closure)" />
          </td>
        </tr>
      </tbody>
    </table>
    <p v-if="shown.length" class="text-xs text-gray-500">{{ de.closures.leaveDaysHint }}</p>
    <ClosuresEditDialog v-model:open="editOpen" :closure="editing" @saved="edited" />
    <form class="grid gap-3 rounded-lg bg-white p-4 ring-1 ring-gray-200 sm:grid-cols-4 sm:items-end" @submit.prevent="create">
      <h2 class="font-semibold sm:col-span-4">{{ de.closures.create }}</h2>
      <p class="text-xs text-gray-500 sm:col-span-4">{{ de.closures.hint }}</p>
      <UFormField :label="de.closures.from"><DateTextInput v-model="form.startDate" :label="de.closures.from" class="w-full" required /></UFormField>
      <UFormField :label="de.closures.to"><DateTextInput v-model="form.endDate" :label="de.closures.to" class="w-full" required /></UFormField>
      <UFormField :label="de.closures.label"><UInput v-model="form.label" maxlength="100" class="w-full" required /></UFormField>
      <UFormField :label="de.closures.mode"><USelect v-model="form.mode" :items="modeItems" class="w-full" /></UFormField>
      <div class="sm:col-span-4"><UButton type="submit" icon="i-lucide-plus" :label="de.common.add" /></div>
    </form>

    <ClosuresHolidaysSection :year="year" class="border-t border-gray-200 pt-6" />
    <ClosuresEarlyClosuresSection v-model:year="year" class="border-t border-gray-200 pt-6" />
  </div>
</template>
