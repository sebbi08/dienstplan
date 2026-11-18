<script setup lang="ts">
import type { IsoDate } from '#shared/domain/types'
import type { GroupMergeInput } from '#shared/types/api'
import { de } from '~/locales/de'
import { reloadAfterFailure } from '~/utils/attendanceMerge'

/**
 * „Gruppen zusammenlegen“: the facility's groups as large toggle buttons (a group already in a merge of today cannot be
 * chosen); at least two, then „Zusammenlegen“. The server checks the same and answers in German. A refused request
 * reloads the day data too (another tablet may have merged meanwhile), so the taken groups and the list are current;
 * the same groups merged again simply succeed (the server finds that merge).
 */
const props = defineProps<{
  groups: { id: number; name: string }[]
  /** Groups already in a merge of today. */
  taken: number[]
  date: IsoDate
  reload: () => Promise<unknown>
}>()
const open = defineModel<boolean>('open', { default: false })
const { busy, run } = useBusyAction(() => props.reload())
const s = de.attendance.merge

const chosen = ref<number[]>([])
watch(open, (value) => {
  if (value) chosen.value = []
}, { immediate: true })
// A group merged meanwhile (seen after a reload) cannot stay chosen.
watch(() => props.taken, taken => (chosen.value = chosen.value.filter(id => !taken.includes(id))))

const isChosen = (id: number) => chosen.value.includes(id)
function toggle(id: number) {
  chosen.value = isChosen(id) ? chosen.value.filter(entry => entry !== id) : [...chosen.value, id]
}

async function save() {
  if (chosen.value.length < 2) return
  const body: GroupMergeInput = { date: props.date, groupIds: chosen.value }
  const request = () => run(() => $fetch<{ id: number }>('/api/attendance/merges', { method: 'POST', body }), s.saved)
  if (await reloadAfterFailure(request, props.reload)) open.value = false
}
</script>

<template>
  <UModal v-model:open="open" :title="s.title">
    <template #body>
      <form class="space-y-4" @submit.prevent="save">
        <p class="text-sm text-gray-600">{{ s.hint }}</p>
        <div class="grid grid-cols-1 gap-2 sm:grid-cols-2" role="group" :aria-label="s.title">
          <UButton
            v-for="group in groups" :key="group.id" type="button" size="xl" class="min-h-14 justify-start"
            :color="isChosen(group.id) ? 'primary' : 'neutral'" :variant="isChosen(group.id) ? 'solid' : 'outline'"
            :icon="isChosen(group.id) ? 'i-lucide-square-check' : 'i-lucide-square'" :aria-pressed="isChosen(group.id)"
            :disabled="busy || taken.includes(group.id)" @click="toggle(group.id)"
          >
            <span class="flex min-w-0 flex-col items-start text-left">
              <span class="truncate">{{ group.name }}</span>
              <span v-if="taken.includes(group.id)" class="text-xs font-normal">{{ s.taken }}</span>
            </span>
          </UButton>
        </div>
        <div class="flex gap-2">
          <UButton
            type="submit" size="xl" icon="i-lucide-merge" :label="s.save" :loading="busy" :disabled="busy || chosen.length < 2"
          />
          <UButton type="button" size="xl" color="neutral" variant="ghost" :label="de.common.close" :disabled="busy" @click="open = false" />
        </div>
      </form>
    </template>
  </UModal>
</template>
