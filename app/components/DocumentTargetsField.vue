<script setup lang="ts">
import type { DocumentScope } from '#shared/domain/documentTargets'
import type { DocumentTargetOptionsDto } from '#shared/types/api'
import { de } from '~/locales/de'
import { facilitiesForGroups, setGroupLimit, toggleGroup, toggleId, type TargetsForm } from '~/utils/documentTargets'

/**
 * „Gilt für“ of a Vorlage or an entry of „Wissen“ (shared/domain/documentTargets.ts): the facilities (the Träger: the
 * active facility's own, all facilities or the ones chosen; everyone else only the own facility, not shown as a choice)
 * and per facility „alle Gruppen“ or the groups chosen. `options` comes from the server (every facility for the Träger).
 */
const props = defineProps<{
  options: DocumentTargetOptionsDto | null
  /** The Träger's right for items of all or the chosen facilities. */
  canGlobal: boolean
  /** The active facility (the own one). */
  facilityId: number | null
  facilityName: string
  /** The ids of the checkboxes start with this (unique on the page). */
  idPrefix: string
}>()
const form = defineModel<TargetsForm>({ required: true })
const t = de.documentTargets

const scopeItems = computed(() => [
  { label: props.facilityName ? t.scopeFacility(props.facilityName) : t.scopeThisFacility, value: 'facility' as DocumentScope },
  { label: t.scopeAll, value: 'all' as DocumentScope },
  { label: t.scopeSelected, value: 'selected' as DocumentScope },
])
/** The facilities whose groups can be limited: the own one, the ones chosen, or every facility. */
const groupFacilities = computed(() => facilitiesForGroups(props.options, form.value, props.facilityId))
/** No facility chosen (also an item whose chosen facilities are all gone): highlighted until one is. */
const noFacility = computed(() => props.canGlobal && form.value.scope === 'selected' && form.value.facilityIds.length === 0)
const limited = (facilityId: number) => form.value.groupTargets.some(target => target.facilityId === facilityId)
/** Limited to groups in the facility but none chosen (also when the chosen ones were all deleted): asks for one. */
const noGroupIn = (facilityId: number) => form.value.groupTargets.some(target => target.facilityId === facilityId && target.groupIds.length === 0)
const noGroup = computed(() => groupFacilities.value.some(facility => noGroupIn(facility.id)))
const chosen = (facilityId: number, groupId: number) =>
  form.value.groupTargets.find(target => target.facilityId === facilityId)?.groupIds.includes(groupId) ?? false
</script>

<template>
  <fieldset class="grid gap-3 rounded-md bg-gray-50 p-3" :class="noFacility || noGroup ? 'ring-2 ring-amber-400' : ''">
    <legend class="px-1 text-sm font-semibold">{{ t.title }}</legend>
    <p v-if="!options" class="text-sm text-gray-500">{{ t.loading }}</p>
    <template v-else>
      <UFormField v-if="canGlobal" :label="t.facilities">
        <URadioGroup v-model="form.scope" :items="scopeItems" />
      </UFormField>
      <UAlert v-if="noFacility" color="warning" variant="soft" icon="i-lucide-triangle-alert" :title="t.pickFacility" />
      <div v-if="canGlobal && form.scope === 'selected'" class="grid gap-1 pl-1 sm:grid-cols-2">
        <UCheckbox
          v-for="facility in options.facilities" :key="facility.id" :label="facility.name" class="min-h-10 items-center"
          :model-value="form.facilityIds.includes(facility.id)" @update:model-value="form = toggleId(form, facility.id)"
        />
      </div>
      <div class="grid gap-2">
        <p class="text-sm font-medium">{{ t.groups }}</p>
        <p class="text-xs text-gray-500">{{ t.groupsHint }}</p>
        <div v-for="facility in groupFacilities" :key="facility.id" class="rounded-md bg-white p-2 ring-1 ring-gray-200">
          <p v-if="groupFacilities.length > 1" class="text-sm font-medium">{{ facility.name }}</p>
          <!-- Still limited although its groups are all gone: the choice stays, to go back to „alle Gruppen“. -->
          <p v-if="!facility.groups.length && !limited(facility.id)" class="text-xs text-gray-500">{{ t.noGroups }}</p>
          <template v-else>
            <URadioGroup
              :model-value="limited(facility.id) ? 'some' : 'all'" orientation="horizontal"
              :items="[{ label: t.allGroups, value: 'all' }, { label: t.someGroups, value: 'some' }]"
              :aria-label="t.groupsOf(facility.name)"
              @update:model-value="value => form = setGroupLimit(form, facility.id, value === 'some')"
            />
            <div v-if="limited(facility.id)" class="mt-1 grid gap-1 pl-1 sm:grid-cols-2">
              <UCheckbox
                v-for="group in facility.groups" :id="`${idPrefix}-group-${group.id}`" :key="group.id" :label="group.name"
                class="min-h-10 items-center" :model-value="chosen(facility.id, group.id)"
                @update:model-value="form = toggleGroup(form, facility.id, group.id)"
              />
            </div>
            <p v-if="noGroupIn(facility.id)" class="mt-1 text-xs font-medium text-amber-700">{{ t.pickOneGroup }}</p>
          </template>
        </div>
      </div>
    </template>
  </fieldset>
</template>
