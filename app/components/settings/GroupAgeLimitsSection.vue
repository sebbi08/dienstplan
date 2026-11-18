<script setup lang="ts">
import type { AgeLimitRuleDto } from '#shared/types/api'
import { de } from '~/locales/de'
import { ageLimitRuleText } from '~/utils/ageLimits'

/**
 * On the group's page: its age limits („von 0 bis unter 3 Jahren: höchstens 5 Kinder“, several, may overlap). Whoever
 * edits the groups (settings.groups, the Träger by default) changes them; the Leitung sees them. The list is saved as
 * a whole; the server checks every rule and answers a German error.
 */
const props = defineProps<{ groupId: number }>()
const { can } = useCan()
const canEdit = computed(() => can('settings.groups'))
const a = de.ageLimits

const { data, refresh } = useFetch<AgeLimitRuleDto[]>(() => `/api/groups/${props.groupId}/age-limits`, {
  key: `group-age-limits-${props.groupId}`,
})
// The Belegung and the hint on the Kinder page show the limits too.
const { busy, run } = useBusyAction(() => Promise.all([refresh(), refreshNuxtData(['children-occupancy', 'children-age-limit-warnings'])]))

interface DraftRule { fromYears: string; toYears: string; maxChildren: string }
const toDraft = (rules: AgeLimitRuleDto[]): DraftRule[] =>
  rules.map(rule => ({ fromYears: String(rule.fromYears), toYears: String(rule.toYears), maxChildren: String(rule.maxChildren) }))
const text = (value: unknown) => String(value ?? '').trim()
const same = (left: DraftRule[], right: DraftRule[]) => left.length === right.length
  && left.every((rule, index) => text(rule.fromYears) === text(right[index]!.fromYears) && text(rule.toYears) === text(right[index]!.toYears)
    && text(rule.maxChildren) === text(right[index]!.maxChildren))

const stored = computed(() => toDraft(data.value ?? []))
const drafts = ref<DraftRule[]>(toDraft(data.value ?? []))
// The drafts follow the stored list while they are not edited (a refresh keeps an unsaved edit).
watch(stored, (next, previous) => {
  if (same(drafts.value, previous ?? [])) drafts.value = toDraft(data.value ?? [])
})
const dirty = useDirty(() => canEdit.value && !same(drafts.value, stored.value))

function add() {
  drafts.value.push({ fromYears: '0', toYears: '3', maxChildren: '' })
}
function remove(index: number) {
  drafts.value.splice(index, 1)
}

/** An empty or non-numeric field goes to the server as -1, so it answers the German error for that field. */
const numberOf = (value: unknown) => {
  const number = Number(text(value))
  return text(value) === '' || !Number.isFinite(number) ? -1 : number
}

async function save() {
  if (!dirty.value) return
  const rules = drafts.value.map(rule => ({
    fromYears: numberOf(rule.fromYears), toYears: numberOf(rule.toYears), maxChildren: numberOf(rule.maxChildren),
  }))
  const ok = await run(() => $fetch<AgeLimitRuleDto[]>(`/api/groups/${props.groupId}/age-limits`, { method: 'PUT', body: { rules } }), de.common.saved)
  if (ok) drafts.value = toDraft(data.value ?? [])
}

const field = 'w-20'
</script>

<template>
  <section class="space-y-2 rounded-lg bg-white p-4 ring-1 ring-gray-200">
    <h2 class="font-semibold">{{ a.title }}</h2>
    <p class="text-xs text-gray-500">{{ a.hint }}</p>
    <form v-if="canEdit" class="space-y-2" @submit.prevent="save">
      <p v-if="!drafts.length" class="text-sm text-gray-500">{{ a.none }}</p>
      <ul class="space-y-2">
        <li v-for="(rule, index) in drafts" :key="index" class="flex flex-wrap items-center gap-2 text-sm">
          <span>{{ a.from }}</span>
          <UInput v-model="rule.fromYears" type="number" min="0" max="18" step="1" size="sm" :class="field" :aria-label="a.fromLabel" />
          <span>{{ a.to }}</span>
          <UInput v-model="rule.toYears" type="number" min="1" max="18" step="1" size="sm" :class="field" :aria-label="a.toLabel" />
          <span>{{ a.years }} {{ a.max }}</span>
          <UInput v-model="rule.maxChildren" type="number" min="0" max="200" step="1" size="sm" :class="field" :aria-label="a.maxLabel" />
          <span>{{ a.children }}</span>
          <UButton
            size="sm" color="neutral" variant="ghost" icon="i-lucide-trash-2" :aria-label="`${a.remove}: ${index + 1}`" :title="a.remove"
            :disabled="busy" @click="remove(index)"
          />
        </li>
      </ul>
      <div class="flex flex-wrap items-center gap-2">
        <UButton size="sm" color="neutral" variant="outline" icon="i-lucide-plus" :label="a.add" :disabled="busy" @click="add" />
        <UButton type="submit" size="sm" :label="de.common.save" :disabled="busy || !dirty" />
      </div>
    </form>
    <template v-else>
      <p v-if="!data?.length" class="text-sm text-gray-500">{{ a.none }}</p>
      <ul v-else class="list-disc space-y-0.5 pl-6 text-sm">
        <li v-for="(rule, index) in data" :key="index">{{ ageLimitRuleText(rule) }}</li>
      </ul>
      <p class="text-xs text-gray-500">{{ a.readOnly }}</p>
    </template>
  </section>
</template>
