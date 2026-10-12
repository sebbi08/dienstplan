<script setup lang="ts">
import { MAX_REQUIREMENT_INTERVAL_MONTHS } from '#shared/domain/requirements'
import type { RequirementTypeDto } from '#shared/types/api'
import { de } from '~/locales/de'

/**
 * The facility's kinds of mandatory appointments (Leitung and Träger): name and after how many months a kind is due
 * again, or that it is needed once. The built-in kinds can be changed, but only the facility's own can be deleted.
 */
// Awaited, so the drafts below are filled before the page is rendered on the server.
const { data: types, refresh } = await useFetch<RequirementTypeDto[]>('/api/requirement-types', { default: () => [] })
const run = useAction(refresh)
const confirm = useConfirm()

/** `months` keeps its value while "einmalig" is chosen, so switching back brings it up again. */
interface Draft { name: string; mode: 'recurring' | 'once'; months: number }
const DEFAULT_MONTHS = 24
const toDraft = (type: RequirementTypeDto): Draft =>
  ({ name: type.name, mode: type.intervalMonths === null ? 'once' : 'recurring', months: type.intervalMonths ?? DEFAULT_MONTHS })
const key = (draft: Draft) => JSON.stringify([draft.name, draft.mode, draft.months])

// One draft per kind; a refresh keeps drafts with an unsaved edit (as for the group names).
const drafts = reactive<Record<number, Draft>>({})
const stored = new Map<number, string>()
function syncDrafts(saved?: number) {
  for (const type of types.value ?? []) {
    const draft = drafts[type.id]
    const fresh = toDraft(type)
    if (!draft || key(draft) === stored.get(type.id) || type.id === saved) drafts[type.id] = fresh
    stored.set(type.id, key(fresh))
  }
}
watch(types, () => syncDrafts(), { immediate: true })
const emptyKind = (): Draft => ({ name: '', mode: 'recurring', months: DEFAULT_MONTHS })
const newKind = reactive(emptyKind())

const intervalItems: { label: string; value: Draft['mode'] }[] = [
  { label: de.requirements.recurring, value: 'recurring' }, { label: de.requirements.once, value: 'once' },
]
const body = (draft: Draft) => ({ name: draft.name, intervalMonths: draft.mode === 'once' ? null : draft.months })

async function save(id: number) {
  const draft = drafts[id]
  if (draft && await run(() => $fetch<unknown>(`/api/requirement-types/${id}`, { method: 'PUT', body: body(draft) }), de.common.saved)) syncDrafts(id)
}

async function create() {
  if (await run(() => $fetch<unknown>('/api/requirement-types', { method: 'POST', body: body(newKind) }), de.common.saved)) {
    Object.assign(newKind, emptyKind())
  }
}

async function remove(type: RequirementTypeDto) {
  if (await confirm(de.requirements.deleteKindConfirm(type.name))) {
    run(() => $fetch<unknown>(`/api/requirement-types/${type.id}`, { method: 'DELETE' }), de.common.deleted)
  }
}
</script>

<template>
  <section class="space-y-2 rounded-lg bg-white p-4 ring-1 ring-gray-200">
    <h2 class="font-semibold">{{ de.requirements.kinds }}</h2>
    <p class="text-xs text-gray-500">{{ de.requirements.settingsHint }}</p>
    <template v-for="type in types ?? []" :key="type.id">
      <form v-if="drafts[type.id]" class="flex flex-wrap items-center gap-2" @submit.prevent="save(type.id)">
        <UInput v-model="drafts[type.id]!.name" maxlength="80" required size="sm" class="w-64" :aria-label="de.requirements.name" />
        <USelect v-model="drafts[type.id]!.mode" :items="intervalItems" size="sm" class="w-40" :aria-label="de.requirements.interval" />
        <label v-if="drafts[type.id]!.mode === 'recurring'" class="flex items-center gap-1 text-sm">
          {{ de.requirements.everyPrefix }}
          <UInput v-model.number="drafts[type.id]!.months" type="number" min="1" :max="MAX_REQUIREMENT_INTERVAL_MONTHS" step="1" required size="sm" class="w-20" />
          {{ de.requirements.months(drafts[type.id]!.months) }}
        </label>
        <UButton type="submit" size="sm" color="neutral" variant="outline" :label="de.common.save" />
        <UButton
          v-if="type.builtinKey === null" size="sm" color="error" variant="ghost" icon="i-lucide-trash-2"
          :aria-label="de.common.delete" @click="remove(type)"
        />
        <span v-else class="text-xs text-gray-500">{{ de.requirements.builtin }}</span>
      </form>
    </template>
    <form class="flex flex-wrap items-center gap-2 border-t border-gray-100 pt-2" @submit.prevent="create">
      <UInput
        v-model="newKind.name" maxlength="80" required size="sm" class="w-64"
        :placeholder="de.requirements.newKindPlaceholder" :aria-label="de.requirements.name"
      />
      <USelect v-model="newKind.mode" :items="intervalItems" size="sm" class="w-40" :aria-label="de.requirements.interval" />
      <label v-if="newKind.mode === 'recurring'" class="flex items-center gap-1 text-sm">
        {{ de.requirements.everyPrefix }}
        <UInput v-model.number="newKind.months" type="number" min="1" :max="MAX_REQUIREMENT_INTERVAL_MONTHS" step="1" required size="sm" class="w-20" />
        {{ de.requirements.months(newKind.months) }}
      </label>
      <UButton type="submit" size="sm" icon="i-lucide-plus" :label="de.requirements.addKind" />
    </form>
  </section>
</template>
