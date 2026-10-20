<script setup lang="ts">
import { todayIso } from '#shared/domain/dates'
import type { ChildRecordDto } from '#shared/types/api'
import { de } from '~/locales/de'
import { formatDate } from '~/utils/format'

/**
 * „Entwicklungsdokumentation“ in the record: the latest „Erledigt“ (date and person), the next due day, and the buttons
 * „Erledigt“ and „Rückgängig“ as the server allows them. `reload` re-reads the record; the busy flag stays on until it
 * is done, so a second tap cannot store the documentation twice.
 */
const props = defineProps<{ child: ChildRecordDto; reload: () => Promise<unknown> }>()
const { busy, run } = useBusyAction(async () => {
  await Promise.all([props.reload(), refreshNuxtData('children-reminders')])
})
const confirm = useConfirm()
const r = de.reminders

const doc = computed(() => props.child.developmentDoc)
const overdue = computed(() => doc.value.nextDue !== null && doc.value.nextDue <= todayIso())

/** Which button's request runs (for its spinner; both are disabled meanwhile). */
const pending = ref<'done' | 'undo' | null>(null)
async function send(kind: 'done' | 'undo', action: () => Promise<unknown>, message: string) {
  pending.value = kind
  try {
    await run(action, message)
  }
  finally {
    pending.value = null
  }
}

function markDone() {
  if (busy.value) return
  send('done', () => $fetch<unknown>(`/api/children/${props.child.id}/development-docs`, { method: 'POST' }), r.doneSaved)
}

async function undo() {
  const last = doc.value.lastDone
  if (!last || busy.value) return
  if (!await confirm(r.confirmUndo(formatDate(last.date)), { confirmLabel: r.undo, danger: true })) return
  send('undo', () => $fetch<unknown>(`/api/children/development-docs/${last.id}`, { method: 'DELETE' }), r.undone)
}
</script>

<template>
  <ChildrenChildSection :title="r.section" :can-edit="false">
    <template #actions>
      <UButton
        v-if="doc.canUndo && doc.lastDone" class="min-h-11" color="neutral" variant="ghost" icon="i-lucide-undo-2"
        :label="r.undo" :loading="pending === 'undo'" :disabled="busy" @click="undo"
      />
      <UButton
        v-if="doc.canDone" class="min-h-11" icon="i-lucide-check" :label="r.done" :loading="pending === 'done'" :disabled="busy"
        @click="markDone"
      />
    </template>
    <ul class="space-y-1 text-sm">
      <li>{{ doc.lastDone ? r.lastDone(formatDate(doc.lastDone.date), doc.lastDone.name) : r.neverDone }}</li>
      <li v-if="child.status === 'active'" :class="overdue ? 'font-medium text-red-700' : ''">
        {{ doc.nextDue ? r.nextDue(formatDate(doc.nextDue)) : r.noReminder }}
      </li>
    </ul>
  </ChildrenChildSection>
</template>
