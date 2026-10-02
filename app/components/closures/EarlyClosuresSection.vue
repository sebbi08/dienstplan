<script setup lang="ts">
import { parseIsoDate, todayIso, weekday } from '#shared/domain/dates'
import { formatTime, parseTime } from '#shared/domain/time'
import type { EarlyClosureDto } from '#shared/types/api'
import { de } from '~/locales/de'
import { formatDayShort } from '~/utils/format'

/** Admin-only year list of days the facility closed earlier (part of the closures page); no effect on working hours. */
const year = ref(parseIsoDate(todayIso()).year)
const { data: list, refresh } = await useFetch<EarlyClosureDto[]>('/api/early-closures', { query: { year } })
const run = useAction(refresh)
const confirm = useConfirm()
const toast = useToast()

const emptyForm = () => ({ id: null as number | null, date: todayIso(), closedFrom: '', reason: '' })
const form = reactive(emptyForm())

function edit(closure: EarlyClosureDto) {
  Object.assign(form, { id: closure.id, date: closure.date, closedFrom: formatTime(closure.closedFrom), reason: closure.reason })
}

function reset() {
  Object.assign(form, emptyForm())
}

async function save() {
  const closedFrom = parseTime(form.closedFrom)
  if (closedFrom === null) {
    toast.add({ title: de.common.invalidTimeAnyMinute, color: 'error' })
    return
  }
  const body = { date: form.date, closedFrom, reason: form.reason }
  const ok = await run(() => form.id
    ? $fetch<unknown>(`/api/early-closures/${form.id}`, { method: 'PUT', body })
    : $fetch<unknown>('/api/early-closures', { method: 'POST', body }), de.common.saved)
  if (ok) {
    const saved = parseIsoDate(form.date).year
    reset()
    year.value = saved
  }
}

async function remove(closure: EarlyClosureDto) {
  if (await confirm(de.earlyClosures.confirmDelete)) run(() => $fetch<unknown>(`/api/early-closures/${closure.id}`, { method: 'DELETE' }), de.common.deleted)
}
</script>

<template>
  <section class="space-y-4">
    <div class="flex flex-wrap items-center gap-3">
      <h2 class="text-xl font-semibold">{{ de.earlyClosures.title }}</h2>
      <div class="flex items-center gap-1">
        <UButton icon="i-lucide-chevron-left" color="neutral" variant="ghost" :aria-label="de.earlyClosures.previousYear" @click="year--" />
        <span class="min-w-16 text-center text-xl font-semibold">{{ year }}</span>
        <UButton icon="i-lucide-chevron-right" color="neutral" variant="ghost" :aria-label="de.earlyClosures.nextYear" @click="year++" />
      </div>
      <UButton
        class="ml-auto" color="neutral" variant="outline" icon="i-lucide-printer" :label="de.earlyClosures.print"
        :to="`/admin/print/early-closures/${year}`" target="_blank"
      />
    </div>
    <p class="text-sm text-gray-500">{{ de.earlyClosures.hint }}</p>

    <p v-if="!list?.length" class="text-sm text-gray-500">{{ de.earlyClosures.empty }}</p>
    <table v-else class="w-full overflow-hidden rounded-lg bg-white text-sm ring-1 ring-gray-200">
      <thead class="bg-gray-100 text-left text-xs text-gray-600">
        <tr>
          <th class="px-3 py-2">{{ de.earlyClosures.date }}</th><th class="px-3 py-2">{{ de.earlyClosures.closedFrom }}</th>
          <th class="px-3 py-2">{{ de.earlyClosures.reason }}</th><th />
        </tr>
      </thead>
      <tbody>
        <tr v-for="closure in list" :key="closure.id" class="border-t border-gray-100" :class="form.id === closure.id ? 'bg-sky-50' : ''">
          <td class="whitespace-nowrap px-3 py-2">{{ formatDayShort(closure.date, weekday(closure.date)) }}{{ closure.date.slice(0, 4) }}</td>
          <td class="px-3 py-2">{{ formatTime(closure.closedFrom) }} Uhr</td>
          <td class="px-3 py-2">{{ closure.reason }}</td>
          <td class="whitespace-nowrap px-3 py-2 text-right">
            <UButton size="xs" color="neutral" variant="ghost" icon="i-lucide-pencil" :aria-label="de.common.edit" @click="edit(closure)" />
            <UButton size="xs" color="error" variant="ghost" icon="i-lucide-trash-2" :aria-label="de.common.delete" @click="remove(closure)" />
          </td>
        </tr>
      </tbody>
    </table>

    <form class="grid gap-3 rounded-lg bg-white p-4 ring-1 ring-gray-200 sm:grid-cols-4 sm:items-end" @submit.prevent="save">
      <h2 class="font-semibold sm:col-span-4">{{ form.id ? de.earlyClosures.edit : de.earlyClosures.create }}</h2>
      <UFormField :label="de.earlyClosures.date"><UInput v-model="form.date" type="date" class="w-full" required /></UFormField>
      <UFormField :label="de.earlyClosures.closedFrom"><TimeInput v-model="form.closedFrom" any-minute /></UFormField>
      <UFormField :label="de.earlyClosures.reason" class="sm:col-span-2">
        <UInput v-model="form.reason" maxlength="200" :placeholder="de.earlyClosures.reasonPlaceholder" class="w-full" required />
      </UFormField>
      <div class="flex gap-2 sm:col-span-4">
        <UButton type="submit" :icon="form.id ? 'i-lucide-check' : 'i-lucide-plus'" :label="form.id ? de.common.save : de.common.add" />
        <UButton v-if="form.id" color="neutral" variant="ghost" :label="de.common.cancel" @click="reset" />
      </div>
    </form>
  </section>
</template>
