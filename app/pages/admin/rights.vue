<script setup lang="ts">
import { RIGHTS_ROLES, type BundleId, type BundleScope, type RightsRole } from '#shared/domain/permissionBundles'
import type { RightsChangeDto, RightsDto, RoleRightsDto } from '#shared/types/api'
import { de } from '~/locales/de'
import {
  bundleTitle, changedBundles, dropPreview, includedIn, includedOnly, roleDraft, switchOff, switchOn, withScope, type RoleDraft,
} from '~/utils/rights'

/**
 * Mehr → Rechte und Rollen, only for the Träger (spec Rechte und Rollen Teil 2 §3): the switches of Leitung,
 * Gruppenleitung and Mitarbeiter by area (Teil 3), with the scope of the children switches. Switching one on brings what
 * it needs along (a notice), switching one off asks when others depend on it. The edits of all roles are saved together; each role can go back to
 * the Grundeinstellung on its own. The server applies the same relations again when saving.
 */
const t = de.rights
useHead({ title: t.title })
useUnsavedGuard()

const { can } = useCan()
const allowed = computed(() => can('rights.manage'))
if (!allowed.value) await navigateTo('/', { replace: true })

const { data, error } = await useFetch<RightsDto>('/api/rights', { key: 'rights', immediate: allowed.value })
const ROLES = RIGHTS_ROLES
const roleName = (role: RightsRole) => de.users.roles[role]

// The stored state and the edits per role; replaced role by role from the answers of saving (no reload, so the edits of
// the other role stay).
const stored = ref<Record<RightsRole, RoleDraft> | null>(null)
const drafts = ref<Record<RightsRole, RoleDraft> | null>(null)
watch(data, (value) => {
  if (!value || stored.value) return
  const byRole = (role: RightsRole) => roleDraft(value.roles.find(rights => rights.role === role)!)
  stored.value = { admin: byRole('admin'), group_lead: byRole('group_lead'), observer: byRole('observer') }
  drafts.value = { admin: byRole('admin'), group_lead: byRole('group_lead'), observer: byRole('observer') }
}, { immediate: true })
function take(answer: RoleRightsDto) {
  if (!stored.value || !drafts.value) return
  stored.value[answer.role] = roleDraft(answer)
  drafts.value[answer.role] = roleDraft(answer)
}

/** The Grundeinstellung of each switch (it never changes). */
const defaults = computed(() => {
  const map = new Map<string, { enabled: boolean; scope: BundleScope | null }>()
  for (const rights of data.value?.roles ?? []) {
    for (const state of rights.bundles) map.set(`${rights.role}:${state.id}`, { enabled: state.defaultEnabled, scope: state.defaultScope })
  }
  return map
})
function differsFromDefault(role: RightsRole, id: BundleId, draft: RoleDraft | undefined): boolean {
  const base = defaults.value.get(`${role}:${id}`)
  const state = draft?.[id]
  if (!base || !state) return false
  return state.enabled !== base.enabled || (state.enabled && state.scope !== base.scope)
}
const roleDirty = (role: RightsRole) => !!drafts.value && !!stored.value && changedBundles(drafts.value[role], stored.value[role]).length > 0
const dirty = useDirty(() => ROLES.some(roleDirty))
const atDefault = (role: RightsRole) => !!stored.value && (data.value?.bundles ?? []).every(bundle => !differsFromDefault(role, bundle.id, stored.value![role]))

/** The rows by area, in the page order of the catalog. */
const areas = computed(() => (data.value?.areas ?? []).map(area => ({
  ...area,
  bundles: (data.value?.bundles ?? []).filter(bundle => bundle.area === area.id).map(bundle => ({
    ...bundle,
    requiresText: bundle.requires.length > 0 ? t.requires(bundle.requires.map(bundleTitle)) : null,
    includedInText: includedIn(bundle.id).length > 0 ? t.includedIn(includedIn(bundle.id).map(bundleTitle)) : null,
  })),
})))
const scopeItems = (['group', 'facility'] as const).map(scope => ({ label: t.scopes[scope], value: scope }))

const toast = useToast()
const confirm = useConfirm()
async function toggle(role: RightsRole, id: BundleId, event: Event) {
  const input = event.target as HTMLInputElement
  if (!drafts.value) return
  const draft = drafts.value[role]
  if (input.checked) {
    const { draft: next, pulledIn } = switchOn(draft, id, role)
    drafts.value[role] = next
    if (pulledIn.length > 0) toast.add({ title: t.pulledIn(pulledIn.map(bundleTitle)), color: 'info' })
    return
  }
  const dependents = dropPreview(draft, id)
  if (dependents.length > 0 && !(await confirm(t.dropConfirm(dependents.map(bundleTitle)), { confirmLabel: t.dropConfirmLabel, danger: true }))) {
    input.checked = true
    return
  }
  drafts.value[role] = switchOff(drafts.value[role], id).draft
}
/** Sets the scope; the children switches that cap or are capped by it follow (a notice says which). */
function setScope(role: RightsRole, id: BundleId, scope: BundleScope) {
  if (!drafts.value) return
  const { draft, alsoChanged } = withScope(drafts.value[role], id, scope)
  drafts.value[role] = draft
  if (alsoChanged.length > 0) toast.add({ title: t.scopeAlong(alsoChanged.map(bundleTitle), t.scopes[scope]), color: 'info' })
}

const run = useAction()
const saving = ref(false)
async function save() {
  if (!drafts.value || !stored.value || !dirty.value) return
  saving.value = true
  try {
    for (const role of ROLES) {
      const bundles = changedBundles(drafts.value[role], stored.value[role])
      if (bundles.length === 0) continue
      const ok = await run(async () => {
        const answer = await $fetch<RoleRightsDto & RightsChangeDto>(`/api/rights/roles/${role}`, { method: 'PUT', body: { bundles } })
        take(answer)
      }, `${roleName(role)}: ${de.common.saved}`)
      if (!ok) return
    }
  }
  finally {
    saving.value = false
  }
}
function discard() {
  if (!stored.value) return
  drafts.value = {
    admin: { ...stored.value.admin }, group_lead: { ...stored.value.group_lead }, observer: { ...stored.value.observer },
  }
}
async function reset(role: RightsRole) {
  if (!(await confirm(t.resetConfirm(roleName(role)), { confirmLabel: t.resetLabel, danger: true }))) return
  await run(async () => take(await $fetch<RoleRightsDto>(`/api/rights/roles/${role}/reset`, { method: 'POST' })), t.resetDone(roleName(role)))
}

// On a phone or a narrow tablet one role at a time (three columns with the scope selects do not fit next to the labels).
const phoneRole = ref<RightsRole>('admin')
const cellClass = (role: RightsRole) => (role === phoneRole.value ? 'table-cell' : 'hidden md:table-cell')
</script>

<template>
  <div class="max-w-5xl space-y-4">
    <h1 class="text-2xl font-semibold">{{ t.title }}</h1>
    <p class="text-sm text-gray-600">{{ t.intro }}</p>
    <p class="text-sm text-gray-500">{{ t.exceptionsWhere }}</p>
    <p v-if="error" class="text-sm text-red-700">{{ t.loadFailed }}</p>

    <template v-if="data && drafts">
      <div class="flex flex-wrap gap-2">
        <UButton
          v-for="role in ROLES" :key="role" color="neutral" variant="outline" size="sm" icon="i-lucide-rotate-ccw"
          :label="t.reset(roleName(role))" :disabled="atDefault(role) && !roleDirty(role)" @click="reset(role)"
        />
      </div>

      <!-- On a phone: choose the role shown in the table. -->
      <div class="flex items-center gap-2 md:hidden" role="radiogroup" :aria-label="t.phoneRole">
        <span class="text-sm text-gray-600">{{ t.phoneRole }}:</span>
        <UButton
          v-for="role in ROLES" :key="role" size="sm" :color="phoneRole === role ? 'primary' : 'neutral'"
          :variant="phoneRole === role ? 'solid' : 'outline'" role="radio" :aria-checked="phoneRole === role" :label="roleName(role)"
          @click="phoneRole = role"
        />
      </div>

      <div class="overflow-x-auto rounded-lg bg-white ring-1 ring-gray-200">
        <table class="w-full text-sm">
          <thead class="bg-gray-100 text-left text-xs text-gray-600">
            <tr>
              <th class="px-3 py-2">{{ t.switchColumn }}</th>
              <th v-for="role in ROLES" :key="role" class="w-52 px-3 py-2" :class="cellClass(role)">{{ roleName(role) }}</th>
            </tr>
          </thead>
          <tbody>
            <template v-for="area in areas" :key="area.id">
              <tr><th :colspan="ROLES.length + 1" scope="colgroup" class="bg-gray-50 px-3 py-1.5 text-left text-xs font-semibold text-gray-600">{{ area.label }}</th></tr>
              <tr v-for="bundle in area.bundles" :key="bundle.id" class="border-t border-gray-100 align-top">
                <td class="px-3 py-2">
                  <div>{{ bundle.label }}</div>
                  <div v-if="bundle.requiresText" class="text-xs text-gray-500">{{ bundle.requiresText }}</div>
                  <div v-if="bundle.includedInText" class="text-xs text-gray-400">{{ bundle.includedInText }}</div>
                </td>
                <td v-for="role in ROLES" :key="role" class="px-3 py-2" :class="cellClass(role)">
                  <div class="flex flex-wrap items-center gap-2">
                    <!-- A finger-sized hit area on a phone; greyed while another switch of the role includes this one. -->
                    <label
                      class="-m-2 inline-flex min-h-11 min-w-11 items-center justify-center p-2 sm:m-0 sm:min-h-0 sm:min-w-0 sm:p-0"
                      :class="includedOnly(drafts[role], bundle.id).length > 0 ? 'cursor-not-allowed' : 'cursor-pointer'"
                      :title="includedOnly(drafts[role], bundle.id).length > 0 ? t.includedLocked(includedOnly(drafts[role], bundle.id).map(bundleTitle)) : undefined"
                    >
                      <input
                        type="checkbox" class="size-4 disabled:opacity-50" :checked="drafts[role][bundle.id].enabled"
                        :disabled="includedOnly(drafts[role], bundle.id).length > 0"
                        :aria-label="t.toggleLabel(bundleTitle(bundle.id), roleName(role))" @change="toggle(role, bundle.id, $event)"
                      >
                    </label>
                    <USelect
                      v-if="bundle.scoped && drafts[role][bundle.id].enabled" size="xs" class="w-40" :items="scopeItems"
                      :model-value="drafts[role][bundle.id].scope ?? undefined" :aria-label="t.scopeLabel(bundleTitle(bundle.id), roleName(role))"
                      @update:model-value="setScope(role, bundle.id, $event as BundleScope)"
                    />
                    <span
                      v-if="differsFromDefault(role, bundle.id, drafts[role])" class="text-amber-600" :title="t.changedFromDefault"
                      :aria-label="t.changedFromDefault"
                    >•</span>
                  </div>
                </td>
              </tr>
            </template>
          </tbody>
        </table>
      </div>
      <p class="text-xs text-gray-500">{{ t.differsHint }} {{ t.ownData }}</p>

      <section class="space-y-2 rounded-lg bg-gray-50 p-4 ring-1 ring-gray-200">
        <h2 class="font-semibold text-gray-600">{{ t.providerOnlyTitle }}</h2>
        <p class="text-xs text-gray-500">{{ t.providerOnlyHint }}</p>
        <ul class="grid gap-1 text-sm text-gray-500 sm:grid-cols-2">
          <li v-for="right in data.providerOnly" :key="right.key" class="flex items-start gap-2">
            <UBadge color="neutral" variant="subtle" size="sm" :label="t.providerOnlyBadge" class="shrink-0" />
            <span>{{ right.label }}</span>
          </li>
        </ul>
      </section>

      <div class="sticky bottom-0 z-10 flex flex-wrap items-center gap-2 border-t border-gray-200 bg-white/95 py-2">
        <span v-if="dirty" class="text-sm text-amber-700">{{ t.unsaved }}</span>
        <div class="ml-auto flex gap-2">
          <UButton color="neutral" variant="ghost" :label="t.discard" :disabled="!dirty" @click="discard" />
          <UButton :label="de.common.save" :disabled="!dirty" :loading="saving" @click="save" />
        </div>
      </div>
    </template>
  </div>
</template>
