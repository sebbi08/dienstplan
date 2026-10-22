<script setup lang="ts">
import { todayIso } from '#shared/domain/dates'
import { presetVersions } from '#shared/domain/staffing/presets'
import type { StaffingResetDto, StaffingSettingsDto, StaffingValueDto } from '#shared/types/api'
import { de } from '~/locales/de'
import { errorMessage } from '~/utils/errors'
import { formatDate } from '~/utils/format'
import { formatDecimal, parseDecimal, staffingPathLabel, staffingSections, type StaffingSection } from '~/utils/staffing'
import { inState } from '~/utils/states'

/**
 * Einstellungen → Personalschlüssel: the state's preset valid today with every number, grouped and labelled. The Träger
 * changes numbers for the facility (saving sends the active overrides), resets one or all; the Leitung only reads.
 */
const t = de.staffing
const toast = useToast()
const confirm = useConfirm()
const { busy, guard } = useBusy()
// Awaited, so the drafts are filled before the server renders the fields (watchers do not run there later on).
const { data, error } = await useStaffingSettings()

const canEdit = computed(() => !!data.value?.canEdit)
const values = computed(() => new Map((data.value?.values ?? []).map(value => [value.path, value])))

/** The sections of the preset; values without a label (none in the presets, a test checks it) go into "Weitere Werte". */
const sections = computed<StaffingSection[]>(() => {
  const value = data.value
  if (!value) return []
  const result = staffingSections(value.preset)
  const described = new Set(result.flatMap(section => section.blocks.flatMap(block => block.fields.map(field => field.path))))
  const rest = value.values.filter(entry => !described.has(entry.path))
  if (rest.length) {
    result.push({ key: 'fte', title: t.sections.other, blocks: [{ title: null, fields: rest.map(entry => ({ path: entry.path, label: entry.path, unit: '' })) }] })
  }
  return result
})
const hasPresence = computed(() => (data.value?.preset.presence.length ?? 0) > 0)

// One draft per value; a reload keeps a draft with an unsaved edit unless `force` says the server's value wins.
const drafts = reactive<Record<string, string>>({})
const stored = new Map<string, number>()
function sync(force: boolean | string[] = false) {
  for (const entry of data.value?.values ?? []) {
    const draft = drafts[entry.path]
    const forced = force === true || (Array.isArray(force) && force.includes(entry.path))
    if (forced || draft === undefined || parseDecimal(draft) === stored.get(entry.path)) drafts[entry.path] = formatDecimal(entry.value)
    stored.set(entry.path, entry.value)
  }
}
watch(data, () => sync(), { immediate: true })

const draftValue = (path: string) => parseDecimal(drafts[path] ?? '')
/** The draft differs from the state's value (shown as „geändert“). */
const changed = (entry: StaffingValueDto) => (canEdit.value ? draftValue(entry.path) !== entry.preset : entry.overridden)
const labelOf = (path: string) => (data.value ? staffingPathLabel(path, [data.value.preset, ...presetVersions(data.value.land)]) : path)

async function request<T extends StaffingSettingsDto>(action: () => Promise<T>, success?: string): Promise<T | null> {
  let result: T | null = null
  await guard(async () => {
    try {
      result = await action()
      data.value = result
      if (success) toast.add({ title: success, color: 'success' })
      return true
    }
    catch (failure) {
      toast.add({ title: errorMessage(failure), color: 'error' })
      return false
    }
  })
  return result
}

async function save() {
  const overrides: Record<string, number> = {}
  for (const entry of data.value?.values ?? []) {
    const value = draftValue(entry.path)
    if (value === null) return void toast.add({ title: t.invalidNumber(labelOf(entry.path)), color: 'error' })
    if (value !== entry.preset) overrides[entry.path] = value
  }
  if (await request(() => $fetch<StaffingSettingsDto>('/api/staffing-settings', { method: 'PUT', body: { overrides } }), de.common.saved)) sync(true)
}

/** Deletes one stored override (also one that no longer applies); a draft that was never saved is only put back. */
async function reset(path: string) {
  const entry = values.value.get(path)
  const storedOverride = entry?.overridden || data.value?.ignored.some(item => item.path === path)
  if (!storedOverride) {
    if (entry) drafts[path] = formatDecimal(entry.preset)
    return
  }
  const result = await request(() => $fetch<StaffingResetDto>('/api/staffing-settings', { method: 'DELETE', query: { path } }), de.common.saved)
  if (!result) return
  sync(result.droppedOthers ? true : [path])
  if (result.droppedOthers) toast.add({ title: t.droppedOthers, color: 'warning' })
}

async function resetAll() {
  if (!await confirm(t.resetAllConfirm, { confirmLabel: t.resetAll })) return
  if (await request(() => $fetch<StaffingResetDto>('/api/staffing-settings', { method: 'DELETE' }), de.common.saved)) sync(true)
}

const anyStored = computed(() => (data.value?.values.some(entry => entry.overridden) ?? false) || (data.value?.ignored.length ?? 0) > 0)
const today = todayIso()
const laterVersions = computed(() => (data.value?.versions ?? []).filter(version => version.validFrom > today))

const cell = 'px-2 py-1'
</script>

<template>
  <section class="space-y-3 rounded-lg bg-white p-4 ring-1 ring-gray-200">
    <h2 class="font-semibold">{{ t.tab }}</h2>
    <p v-if="error" class="text-sm text-gray-600">{{ errorMessage(error) }}</p>
    <template v-else-if="data">
      <div class="space-y-1 text-sm text-gray-700">
        <p>{{ t.settingsHint(inState(data.land)) }} {{ t.method(t.methods[data.method]) }}.</p>
        <p class="text-xs text-gray-600">{{ t.source(data.source, formatDate(data.validFrom)) }}</p>
        <p v-if="data.confidence !== 'high'" class="flex items-center gap-1 font-medium text-amber-800">
          <UIcon name="i-lucide-triangle-alert" class="size-4" aria-hidden="true" /> {{ t.pleaseCheck }}
        </p>
        <p v-if="data.note" class="text-xs text-gray-600">{{ data.note }}</p>
        <p v-if="!data.periodCheck" class="text-xs text-gray-600">{{ t.presenceOnly(inState(data.land)) }}</p>
        <p v-if="laterVersions.length" class="text-xs text-gray-600">
          {{ t.versions }}: {{ laterVersions.map(version => t.versionLine(formatDate(version.validFrom), version.source)).join('; ') }}
        </p>
        <p class="text-xs text-gray-500">{{ canEdit ? t.editHint : t.readOnly }}</p>
      </div>

      <div v-if="data.ignored.length" class="rounded-md bg-amber-50 p-3 text-sm text-amber-900 ring-1 ring-amber-200">
        <p class="font-medium">{{ t.ignoredTitle }}</p>
        <ul class="mt-1 space-y-1">
          <li v-for="item in data.ignored" :key="item.path" class="flex flex-wrap items-center gap-2">
            <span>{{ t.ignoredItem(labelOf(item.path), formatDecimal(item.value), formatDecimal(item.preset)) }}</span>
            <UButton v-if="canEdit" size="xs" color="neutral" variant="outline" :label="t.removeIgnored" :disabled="busy" @click="reset(item.path)" />
          </li>
        </ul>
      </div>
      <ul v-if="data.upcomingIgnored.length" class="space-y-1 rounded-md bg-amber-50 p-3 text-sm text-amber-900 ring-1 ring-amber-200">
        <li v-for="item in data.upcomingIgnored" :key="`${item.validFrom}-${item.path}`">{{ t.upcoming(formatDate(item.validFrom), labelOf(item.path)) }}</li>
      </ul>

      <form class="space-y-3" @submit.prevent="save">
        <div v-for="section in sections" :key="section.title" class="space-y-1">
          <h3 class="text-sm font-semibold text-gray-800">{{ section.title }}</h3>
          <table class="w-full text-sm">
            <tbody>
              <template v-for="(block, blockIndex) in section.blocks" :key="blockIndex">
                <tr v-if="block.title">
                  <td colspan="3" class="px-2 pt-2 text-xs font-semibold text-gray-600">{{ block.title }}</td>
                </tr>
                <tr v-for="field in block.fields" :key="field.path" class="border-t border-gray-100" :class="values.get(field.path) && changed(values.get(field.path)!) ? 'bg-amber-50' : ''">
                  <td :class="cell" class="w-1/2">{{ field.label }}</td>
                  <td :class="cell" class="whitespace-nowrap">
                    <input
                      v-if="canEdit" v-model="drafts[field.path]" type="text" inputmode="decimal" class="w-24 rounded border border-gray-300 px-1 py-0.5 text-right"
                      :aria-label="labelOf(field.path)" :disabled="busy"
                    >
                    <span v-else class="font-medium tabular-nums">{{ values.get(field.path) ? formatDecimal(values.get(field.path)!.value) : '' }}</span>
                    <span v-if="field.unit" class="ml-1 text-gray-500">{{ field.unit }}</span>
                  </td>
                  <td :class="cell" class="text-xs">
                    <span v-if="values.get(field.path) && changed(values.get(field.path)!)" class="inline-flex flex-wrap items-center gap-2">
                      <span class="rounded bg-amber-200 px-1.5 py-0.5 font-medium text-amber-900">{{ t.changed }}</span>
                      <span class="text-gray-600">{{ t.presetValue(formatDecimal(values.get(field.path)!.preset)) }}</span>
                      <UButton
                        v-if="canEdit" size="xs" color="neutral" variant="ghost" icon="i-lucide-rotate-ccw" :label="t.reset"
                        :aria-label="t.resetOf(labelOf(field.path))" :disabled="busy" @click="reset(field.path)"
                      />
                    </span>
                  </td>
                </tr>
              </template>
            </tbody>
          </table>
        </div>
        <p v-if="!hasPresence" class="text-xs text-gray-500">{{ t.presenceNone }}</p>
        <div v-if="canEdit" class="flex flex-wrap gap-2">
          <UButton type="submit" :label="de.common.save" :disabled="busy" />
          <UButton v-if="anyStored" color="neutral" variant="outline" icon="i-lucide-rotate-ccw" :label="t.resetAll" :disabled="busy" @click="resetAll" />
        </div>
      </form>
      <p class="text-xs font-medium text-gray-800">{{ t.disclaimer }}</p>
    </template>
  </section>
</template>
