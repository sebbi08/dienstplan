<script setup lang="ts">
import { todayIso } from '#shared/domain/dates'
import type { ClosureDto, ClosureMode } from '#shared/types/api'
import { de } from '~/locales/de'
import { formatDate } from '~/utils/format'

const { data: list, refresh } = await useFetch<ClosureDto[]>('/api/closures')
const run = useAction(refresh)
const confirm = useConfirm()
const form = reactive<{ startDate: string; endDate: string; label: string; mode: ClosureMode }>({
  startDate: todayIso(), endDate: todayIso(), label: '', mode: 'vacation',
})
const modeItems = (['vacation', 'closure_day'] as const).map(mode => ({ label: de.closures.modes[mode], value: mode }))

async function create() {
  const ok = await run(() => $fetch<unknown>('/api/closures', { method: 'POST', body: { ...form } }), de.common.saved)
  if (ok) form.label = ''
}

async function remove(closure: ClosureDto) {
  if (await confirm(de.closures.confirmDelete)) run(() => $fetch<unknown>(`/api/closures/${closure.id}`, { method: 'DELETE' }), de.common.deleted)
}
</script>

<template>
  <div class="max-w-4xl space-y-4">
    <h1 class="text-2xl font-semibold">{{ de.closures.title }}</h1>
    <p v-if="!list?.length" class="text-sm text-gray-500">{{ de.closures.empty }}</p>
    <table v-else class="w-full overflow-hidden rounded-lg bg-white text-sm ring-1 ring-gray-200">
      <thead class="bg-gray-100 text-left text-xs text-gray-600">
        <tr><th class="px-3 py-2">{{ de.closures.from }}</th><th class="px-3 py-2">{{ de.closures.to }}</th><th class="px-3 py-2">{{ de.closures.label }}</th><th class="px-3 py-2">{{ de.closures.mode }}</th><th /></tr>
      </thead>
      <tbody>
        <tr v-for="closure in list" :key="closure.id" class="border-t border-gray-100">
          <td class="px-3 py-2">{{ formatDate(closure.startDate) }}</td>
          <td class="px-3 py-2">{{ formatDate(closure.endDate) }}</td>
          <td class="px-3 py-2">{{ closure.label }}</td>
          <td class="px-3 py-2">{{ de.closures.modes[closure.mode] }}</td>
          <td class="px-3 py-2 text-right"><UButton size="xs" color="error" variant="ghost" icon="i-lucide-trash-2" :aria-label="de.common.delete" @click="remove(closure)" /></td>
        </tr>
      </tbody>
    </table>
    <form class="grid gap-3 rounded-lg bg-white p-4 ring-1 ring-gray-200 sm:grid-cols-4 sm:items-end" @submit.prevent="create">
      <h2 class="font-semibold sm:col-span-4">{{ de.closures.create }}</h2>
      <p class="text-xs text-gray-500 sm:col-span-4">{{ de.closures.hint }}</p>
      <UFormField :label="de.closures.from"><UInput v-model="form.startDate" type="date" class="w-full" required /></UFormField>
      <UFormField :label="de.closures.to"><UInput v-model="form.endDate" type="date" class="w-full" required /></UFormField>
      <UFormField :label="de.closures.label"><UInput v-model="form.label" maxlength="100" class="w-full" required /></UFormField>
      <UFormField :label="de.closures.mode"><USelect v-model="form.mode" :items="modeItems" class="w-full" /></UFormField>
      <div class="sm:col-span-4"><UButton type="submit" icon="i-lucide-plus" :label="de.common.add" /></div>
    </form>
  </div>
</template>
