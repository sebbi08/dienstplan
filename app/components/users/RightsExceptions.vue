<script setup lang="ts">
import { BUNDLE_AREA_LABELS, BUNDLE_AREAS, BUNDLES, type BundleId, type BundleScope } from '#shared/domain/permissionBundles'
import type { RightsChangeDto, UserBundleStateDto, UserRightsDto, UserRightsInput } from '#shared/types/api'
import { de } from '~/locales/de'
import {
  bundleTitle, childEditingOverrides, childEditingRefusal, exceptionChoice, exceptionDropPreview, overridesWith, widenedAlong,
  type ExceptionChoice,
} from '~/utils/rights'

/**
 * The rights of one person (spec Rechte und Rollen Teil 2 §4), on the tab „Zugang“ and behind „Rechte“ on the users
 * page. The Träger (`mode` 'all') sees every switch with the role's state, the exception and what applies, and sets or
 * clears exceptions; the Leitung ('childrenEdit') only allows or takes away „eintragen und Akten ändern“ for a
 * Mitarbeiter (formerly „darf Kinderakten pflegen“). Every change is saved at once; the server checks who may change
 * what and keeps the dependencies.
 */
/** `expanded`: the list of switches open from the start (in the dialog of the users page). */
const props = defineProps<{ userId: number; mode: 'all' | 'childrenEdit'; expanded?: boolean }>()
const t = de.rights

const { data: rights, error } = useFetch<UserRightsDto>(() => `/api/users/${props.userId}/rights`, { lazy: true })
const editable = (id: BundleId) => rights.value?.editable.includes(id) ?? false
const stateOf = (id: BundleId) => rights.value?.bundles.find(bundle => bundle.id === id)

const areas = computed(() => BUNDLE_AREAS.map(area => ({
  id: area, label: BUNDLE_AREA_LABELS[area],
  bundles: BUNDLES.filter(def => def.area === area).map(def => ({ def, state: stateOf(def.id) }))
    .filter((row): row is { def: typeof row.def; state: UserBundleStateDto } => row.state !== undefined),
})))
const exceptionCount = computed(() => rights.value?.bundles.filter(bundle => bundle.override !== null).length ?? 0)
const choiceItems = (['role', 'grant', 'revoke'] as const).map(choice => ({ label: t.choices[choice], value: choice }))
const scopeItems = (['group', 'facility'] as const).map(scope => ({ label: t.scopes[scope], value: scope }))
const scopeText = (scope: BundleScope | null) => (scope ? ` (${t.scopes[scope]})` : '')

const toast = useToast()
const confirm = useConfirm()
const run = useAction()
const busy = ref(false)

/** Saves the complete list of exceptions; false when the server refused it (nothing changed then). */
async function save(overrides: UserRightsInput['overrides']): Promise<boolean> {
  busy.value = true
  try {
    return await run(async () => {
      const answer = await $fetch<UserRightsDto & RightsChangeDto>(`/api/users/${props.userId}/rights`, { method: 'PUT', body: { overrides } })
      rights.value = answer
      if (answer.pulledIn.length > 0) toast.add({ title: t.pulledIn(answer.pulledIn.map(bundleTitle)), color: 'info' })
      if (answer.dropped.length > 0) toast.add({ title: t.dropped(answer.dropped.map(bundleTitle)), color: 'info' })
    }, de.common.saved)
  }
  finally {
    busy.value = false
  }
}

/** Sets the exception of the switch; asks first when the change takes other switches away. */
async function choose(id: BundleId, choice: ExceptionChoice, scope: BundleScope | null = null) {
  const current = rights.value
  if (!current) return
  // A facility-wide children grant widens what caps it (e.g. „ansehen“) along with it.
  const { overrides, alsoChanged } = widenedAlong(current, id, overridesWith(current, id, choice, scope))
  const dropping = exceptionDropPreview(current, id, overrides)
  if (dropping.length > 0 && !(await confirm(t.dropConfirm(dropping.map(bundleTitle)), { confirmLabel: t.dropConfirmLabel, danger: true }))) return
  if (await save(overrides) && alsoChanged.length > 0) {
    toast.add({ title: t.scopeAlong(alsoChanged.map(bundleTitle), t.scopes.facility), color: 'info' })
  }
}

const childEdit = computed(() => stateOf('childrenEdit'))
/** The reach the checkbox stands for: what applies now, or the own group a tick gives. */
const childEditScope = computed(() => t.scopes[(childEdit.value?.effective.enabled ? childEdit.value.effective.scope : null) ?? 'group'])
/** What the server would refuse (a switch of the Träger builds on it, or one it needs is missing): no tick then. */
const childEditRefusal = computed(() => (rights.value ? childEditingRefusal(rights.value) : null))
const childEditRefusalText = computed(() => {
  const refusal = childEditRefusal.value
  if (!refusal) return null
  const names = refusal.bundles.map(bundleTitle)
  return refusal.reason === 'dependent' ? t.childEditDependent(names) : t.childEditMissing(names)
})
async function toggleChildEditing(event: Event) {
  const input = event.target as HTMLInputElement
  const current = rights.value
  if (!current || childEditRefusal.value) {
    input.checked = !input.checked
    return
  }
  // A refused save keeps the stored state, so the box goes back to it.
  if (!(await save(childEditingOverrides(current, input.checked)))) input.checked = !input.checked
}
</script>

<template>
  <div class="space-y-2">
    <p v-if="error" class="text-sm text-red-700">{{ t.loadFailed }}</p>

    <!-- The Leitung: the one switch it may set for a Mitarbeiter. -->
    <div v-else-if="mode === 'childrenEdit'" class="space-y-1 text-sm">
      <label v-if="childEdit" class="flex min-h-11 items-center gap-2" :class="childEditRefusal ? 'text-gray-500' : 'cursor-pointer'">
        <input
          type="checkbox" class="size-4" :checked="childEdit.effective.enabled"
          :disabled="busy || !editable('childrenEdit') || childEditRefusal !== null" @change="toggleChildEditing"
        > {{ t.childEdit(childEditScope) }}
      </label>
      <p v-if="childEditRefusalText" class="text-xs text-amber-700">{{ childEditRefusalText }}</p>
      <p class="text-xs text-gray-500">{{ t.childEditHint }}</p>
    </div>

    <!-- The Träger: every switch, closed until asked for (34 rows). -->
    <details v-else class="group rounded-lg ring-1 ring-gray-200" :open="expanded">
      <summary class="flex min-h-11 cursor-pointer items-center gap-2 px-3 py-2 text-sm">
        <span class="font-semibold">{{ t.personTitle }}</span>
        <span class="text-gray-500">· {{ t.exceptionCount(exceptionCount) }}</span>
      </summary>
      <div class="space-y-2 border-t border-gray-100 p-3">
        <p class="text-xs text-gray-500">{{ t.personHint }}</p>
        <div v-if="rights" class="overflow-x-auto">
          <table class="w-full text-sm">
            <tbody>
              <template v-for="area in areas" :key="area.id">
                <tr><th colspan="3" scope="colgroup" class="bg-gray-50 px-2 py-1 text-left text-xs font-semibold text-gray-600">{{ area.label }}</th></tr>
                <tr v-for="row in area.bundles" :key="row.def.id" class="border-t border-gray-100 align-top">
                  <td class="px-2 py-1.5">
                    <div>{{ row.def.label }}</div>
                    <div class="text-xs text-gray-500">
                      {{ row.state.role.enabled ? t.roleOn : t.roleOff }}{{ scopeText(row.state.role.scope) }}
                    </div>
                  </td>
                  <td class="px-2 py-1.5">
                    <div class="flex flex-wrap items-center gap-1.5">
                      <USelect
                        size="xs" class="w-40" :items="choiceItems" :model-value="exceptionChoice(row.state)"
                        :disabled="busy || !editable(row.def.id)" :aria-label="t.choiceLabel(bundleTitle(row.def.id))"
                        @update:model-value="choose(row.def.id, $event as ExceptionChoice, row.state.override?.scope ?? null)"
                      />
                      <USelect
                        v-if="row.def.scoped && row.state.override?.effect === 'grant'" size="xs" class="w-40" :items="scopeItems"
                        :model-value="row.state.override.scope ?? undefined" :disabled="busy || !editable(row.def.id)"
                        :aria-label="t.scopeLabel(bundleTitle(row.def.id), rights.username)"
                        @update:model-value="choose(row.def.id, 'grant', $event as BundleScope)"
                      />
                    </div>
                  </td>
                  <td class="whitespace-nowrap px-2 py-1.5 text-xs" :class="row.state.effective.enabled ? 'font-semibold text-green-700' : 'text-gray-400'">
                    {{ row.state.effective.enabled ? t.applies : t.notApplies }}{{ row.state.effective.enabled ? scopeText(row.state.effective.scope) : '' }}
                  </td>
                </tr>
              </template>
            </tbody>
          </table>
        </div>
      </div>
    </details>
  </div>
</template>
