<script setup lang="ts">
import { isYouthExamKey, MAX_REQUIREMENT_INTERVAL_MONTHS } from '#shared/domain/requirements'
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

/**
 * `months` keeps its value while "einmalig" is chosen, so switching back brings it up again. `first`: the second record
 * is due this many months after the start of employment (Betriebsarzt, AMR 2.1), null = after `months` as well; the
 * checkbox „Zweiter Termin ab Arbeitsbeginn“ switches it on (12) and off.
 */
interface Draft { name: string; mode: 'recurring' | 'once'; months: number; first: number | null }
const DEFAULT_MONTHS = 24
const DEFAULT_FIRST_MONTHS = 12
const setFirst = (draft: Draft, on: boolean | 'indeterminate') => { draft.first = on === true ? DEFAULT_FIRST_MONTHS : null }

// § 34 Abs. 5a IfSG: an own kind about a Belehrung besides the built-in one is probably the same; the hint says what to do.
const ownBriefings = computed(() => (types.value ?? []).some(type => type.builtinKey === 'ifsg_briefing')
  ? (types.value ?? []).filter(type => type.builtinKey === null && type.name.toLocaleLowerCase('de').includes('belehrung')).map(type => type.name)
  : [])
const toDraft = (type: RequirementTypeDto): Draft => ({
  name: type.name, mode: type.intervalMonths === null ? 'once' : 'recurring', months: type.intervalMonths ?? DEFAULT_MONTHS,
  first: type.firstIntervalMonths,
})
const key = (draft: Draft) => JSON.stringify([draft.name, draft.mode, draft.months, draft.first])

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
const emptyKind = (): Draft => ({ name: '', mode: 'recurring', months: DEFAULT_MONTHS, first: null })
const newKind = reactive(emptyKind())

const intervalItems: { label: string; value: Draft['mode'] }[] = [
  { label: de.requirements.recurring, value: 'recurring' }, { label: de.requirements.once, value: 'once' },
]
// The first interval with a recurring kind (null switches it off); with „einmalig“ it is left out and the server keeps it.
const body = (draft: Draft) => ({
  name: draft.name, intervalMonths: draft.mode === 'once' ? null : draft.months,
  ...(draft.mode === 'once' ? {} : { firstIntervalMonths: draft.first }),
})

/** A kind's draft would save something else than it has (the months do not count while "einmalig" is chosen). */
function kindDirty(type: RequirementTypeDto): boolean {
  const draft = drafts[type.id]
  return !!draft && !sameValue(body(draft), body(toDraft(type)))
}
const newKindDirty = computed(() => newKind.name.trim() !== '')
useDirty(() => newKindDirty.value || (types.value ?? []).some(kindDirty))

async function save(id: number) {
  const draft = drafts[id]
  const type = types.value?.find(candidate => candidate.id === id)
  if (!type || !kindDirty(type)) return
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
    <MoreHint class="text-xs text-gray-500" :text="de.requirements.settingsHint" :more="de.requirements.settingsHintMore" />
    <p v-if="ownBriefings.length" class="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-800">{{ de.requirements.ownBriefingHint(ownBriefings.join('“, „')) }}</p>
    <template v-for="type in types ?? []" :key="type.id">
      <form v-if="drafts[type.id]" class="flex flex-wrap items-center gap-2" @submit.prevent="save(type.id)">
        <UInput v-model="drafts[type.id]!.name" maxlength="80" required size="sm" class="w-64" :aria-label="de.requirements.name" />
        <span v-if="isYouthExamKey(type.builtinKey)" class="text-sm text-gray-600">{{ de.requirements.youthInterval }}</span>
        <USelect v-else v-model="drafts[type.id]!.mode" :items="intervalItems" size="sm" class="w-40" :aria-label="de.requirements.interval" />
        <label v-if="!isYouthExamKey(type.builtinKey) && drafts[type.id]!.mode === 'recurring'" class="flex items-center gap-1 text-sm">
          {{ de.requirements.everyPrefix }}
          <template v-if="drafts[type.id]!.first !== null">
            {{ de.requirements.firstPrefix }}
            <UInput
              v-model.number="drafts[type.id]!.first" type="number" min="1" :max="MAX_REQUIREMENT_INTERVAL_MONTHS" step="1" required size="sm"
              class="w-20" :aria-label="de.requirements.firstToggle"
            />
            {{ de.requirements.thenPrefix(drafts[type.id]!.first ?? 0) }}
          </template>
          <UInput v-model.number="drafts[type.id]!.months" type="number" min="1" :max="MAX_REQUIREMENT_INTERVAL_MONTHS" step="1" required size="sm" class="w-20" />
          {{ de.requirements.months(drafts[type.id]!.months) }}
        </label>
        <UCheckbox
          v-if="!isYouthExamKey(type.builtinKey) && drafts[type.id]!.mode === 'recurring'" size="sm" :label="de.requirements.firstToggle"
          :model-value="drafts[type.id]!.first !== null" @update:model-value="setFirst(drafts[type.id]!, $event)"
        />
        <UButton v-if="kindDirty(type)" type="submit" size="sm" color="neutral" variant="outline" :label="de.common.save" />
        <UButton
          v-if="type.builtinKey === null" size="sm" color="error" variant="ghost" icon="i-lucide-trash-2"
          :aria-label="de.common.delete" @click="remove(type)"
        />
        <span v-else class="inline-flex items-center gap-1 text-xs text-gray-500">
          {{ de.requirements.builtin }}
          <InfoHint v-if="type.builtinKey && de.requirements.builtinRules[type.builtinKey]" :text="de.requirements.builtinRules[type.builtinKey]!" />
        </span>
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
        <template v-if="newKind.first !== null">
          {{ de.requirements.firstPrefix }}
          <UInput
            v-model.number="newKind.first" type="number" min="1" :max="MAX_REQUIREMENT_INTERVAL_MONTHS" step="1" required size="sm"
            class="w-20" :aria-label="de.requirements.firstToggle"
          />
          {{ de.requirements.thenPrefix(newKind.first ?? 0) }}
        </template>
        <UInput v-model.number="newKind.months" type="number" min="1" :max="MAX_REQUIREMENT_INTERVAL_MONTHS" step="1" required size="sm" class="w-20" />
        {{ de.requirements.months(newKind.months) }}
      </label>
      <UCheckbox
        v-if="newKind.mode === 'recurring'" size="sm" :label="de.requirements.firstToggle"
        :model-value="newKind.first !== null" @update:model-value="setFirst(newKind, $event)"
      />
      <UButton type="submit" size="sm" icon="i-lucide-plus" :label="de.requirements.addKind" :disabled="!newKindDirty" />
    </form>
  </section>
</template>
