<script setup lang="ts">
import type { BundleId, RightsRole } from '#shared/domain/permissionBundles'
import type { RightsDto } from '#shared/types/api'
import { de } from '~/locales/de'

/**
 * „Rechte der Rollen“ on the users page (Träger): what Leitung and Mitarbeiter may do as the rights page has them set
 * now (GET /api/rights), read only; the Träger has every right, the tablet its fixed pages. Changed on „Rechte und
 * Rollen“.
 */
const t = de.rights
const { data, error } = useFetch<RightsDto>('/api/rights', { key: 'rights-overview', lazy: true })
const ROLES: readonly RightsRole[] = ['admin', 'observer']

const stateOf = (role: RightsRole, id: BundleId) => data.value?.roles.find(rights => rights.role === role)?.bundles.find(state => state.id === id)
const areas = computed(() => (data.value?.areas ?? []).map(area => ({
  ...area, bundles: (data.value?.bundles ?? []).filter(bundle => bundle.area === area.id),
})))
</script>

<template>
  <section class="space-y-3 rounded-lg bg-white p-4 ring-1 ring-gray-200">
    <h2 class="font-semibold">{{ de.users.rightsTitle }}</h2>
    <p class="text-sm text-gray-500">
      {{ t.overviewHint }} <NuxtLink to="/admin/rights" class="text-sky-700 hover:underline">{{ de.users.rightsPage }}</NuxtLink>
    </p>
    <p v-if="error" class="text-sm text-red-700">{{ t.loadFailed }}</p>
    <div v-else-if="data" class="overflow-x-auto">
      <table class="w-full text-sm">
        <thead class="text-left text-xs text-gray-600">
          <tr>
            <th class="px-2 py-1" />
            <th v-for="role in ROLES" :key="role" class="whitespace-nowrap px-2 py-1 text-center">{{ de.users.roles[role] }}</th>
          </tr>
        </thead>
        <tbody>
          <template v-for="area in areas" :key="area.id">
            <tr><th colspan="3" scope="colgroup" class="bg-gray-50 px-2 py-1 text-left text-xs font-semibold text-gray-600">{{ area.label }}</th></tr>
            <tr v-for="bundle in area.bundles" :key="bundle.id" class="border-t border-gray-100">
              <td class="px-2 py-1">{{ bundle.label }}</td>
              <td v-for="role in ROLES" :key="role" class="whitespace-nowrap px-2 py-1 text-center">
                <template v-if="stateOf(role, bundle.id)?.enabled">
                  <span class="font-semibold text-green-700" :aria-label="de.users.rightYes">✓</span>
                  <span v-if="stateOf(role, bundle.id)?.scope" class="ml-1 text-xs text-gray-500">{{ t.scopes[stateOf(role, bundle.id)!.scope!] }}</span>
                </template>
                <span v-else class="text-gray-300" :aria-label="de.users.rightNo">–</span>
              </td>
            </tr>
          </template>
        </tbody>
      </table>
    </div>
    <ul class="space-y-0.5 text-xs text-gray-500">
      <li>{{ t.overviewProvider }}</li>
      <li>{{ t.overviewTablet }}</li>
      <li>{{ t.ownData }}</li>
      <li>{{ t.exceptionsWhere }}</li>
    </ul>
  </section>
</template>
