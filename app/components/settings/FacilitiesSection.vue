<script setup lang="ts">
import { de } from '~/locales/de'

/** Träger only: list the facilities, rename them and add a new one (it copies the Dienste and Pflichtdienste of the first). */
const { data, refresh } = useFacilities()
const run = useAction(refresh)

// One draft per facility. A refresh only touches drafts that have no unsaved edit (or are new), so typing in one row
// survives saving another.
const names = reactive<Record<number, string>>({})
const stored = new Map<number, string>()
function syncNames(saved?: number) {
  for (const facility of data.value?.facilities ?? []) {
    const untouched = names[facility.id] === undefined || names[facility.id] === stored.get(facility.id)
    if (untouched || facility.id === saved) names[facility.id] = facility.name
    stored.set(facility.id, facility.name)
  }
}
watch(data, () => syncNames(), { immediate: true })
const newName = ref('')

async function rename(id: number) {
  if (await run(() => $fetch<unknown>(`/api/facilities/${id}`, { method: 'PUT', body: { name: names[id] } }), de.common.saved)) syncNames(id)
}

async function create() {
  if (await run(() => $fetch<unknown>('/api/facilities', { method: 'POST', body: { name: newName.value } }), de.common.saved)) newName.value = ''
}
</script>

<template>
  <section class="space-y-3 rounded-lg bg-white p-4 ring-1 ring-gray-200">
    <h2 class="font-semibold">{{ de.facilities.title }}</h2>
    <form v-for="facility in data?.facilities ?? []" :key="facility.id" class="flex flex-wrap items-end gap-3" @submit.prevent="rename(facility.id)">
      <UFormField :label="de.facilities.name"><UInput v-model="names[facility.id]" maxlength="80" required /></UFormField>
      <UButton type="submit" color="neutral" variant="outline" :label="de.facilities.rename" />
    </form>
    <form class="flex flex-wrap items-end gap-3 border-t border-gray-100 pt-3" @submit.prevent="create">
      <UFormField :label="de.facilities.name"><UInput v-model="newName" maxlength="80" required /></UFormField>
      <UButton type="submit" icon="i-lucide-plus" :label="de.facilities.add" />
    </form>
    <p class="text-xs text-gray-500">{{ de.facilities.hint }}</p>
  </section>
</template>
