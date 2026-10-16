<script setup lang="ts">
import { addDays } from '#shared/domain/dates'
import type { IsoDate } from '#shared/domain/types'
import type { AbsenceKind, AttendanceAbsenceInput, AttendanceChildDto } from '#shared/types/api'
import { de } from '~/locales/de'
import { ABSENCE_KINDS } from '~/utils/attendance'

/**
 * "Abwesend" (spec §3.5): sick / vacation / excused for this day or up to an end date (entered ahead, e.g. a holiday).
 * The server only fills care days without a stay and says how many it changed. An absence of the day can be removed.
 */
const props = defineProps<{ child: AttendanceChildDto; date: IsoDate; reload: () => Promise<unknown> }>()
const open = defineModel<boolean>('open', { default: false })
const { busy, run } = useBusyAction(() => props.reload())
const toast = useToast()
const s = de.attendance

const form = reactive<{ kind: AbsenceKind | null; until: IsoDate }>({ kind: null, until: props.date })
watch(open, (value) => {
  if (!value) return
  Object.assign(form, { kind: props.child.absence, until: props.date })
}, { immediate: true })

/** The server takes ranges of up to a year. */
const latest = computed(() => addDays(props.date, 365))
const valid = computed(() => form.kind !== null && form.until >= props.date && form.until <= latest.value)

async function send(kind: AbsenceKind | null, to: IsoDate) {
  let changed = 0
  const body: AttendanceAbsenceInput = { childId: props.child.childId, from: props.date, to, kind }
  const ok = await run(async () => {
    changed = (await $fetch<{ changed: number }>('/api/attendance/absence', { method: 'PUT', body })).changed
  })
  if (!ok) return
  if (kind === null) toast.add({ title: de.common.saved, color: 'success' })
  else if (changed > 0) toast.add({ title: s.absent.saved(changed), color: 'success' })
  else toast.add({ title: s.absent.nothing, color: 'warning' })
  open.value = false
}

function save() {
  if (valid.value) send(form.kind, form.until)
}
</script>

<template>
  <UModal v-model:open="open" :title="s.absent.title(child.name)">
    <template #body>
      <form class="space-y-4" @submit.prevent="save">
        <fieldset>
          <legend class="mb-1 text-sm font-medium">{{ s.absent.kind }}</legend>
          <div class="grid grid-cols-3 gap-2" role="radiogroup">
            <UButton
              v-for="kind in ABSENCE_KINDS" :key="kind" type="button" size="xl" block role="radio" :aria-checked="form.kind === kind"
              :variant="form.kind === kind ? 'solid' : 'outline'" :color="form.kind === kind ? 'primary' : 'neutral'"
              :label="s.absence[kind]" @click="form.kind = kind"
            />
          </div>
        </fieldset>
        <UFormField :label="s.absent.until" :help="s.absent.hint">
          <UInput v-model="form.until" type="date" size="xl" :min="date" :max="latest" required />
        </UFormField>
        <div class="flex flex-wrap gap-2">
          <UButton type="submit" size="xl" :label="de.common.save" :loading="busy" :disabled="busy || !valid" />
          <UButton type="button" size="xl" color="neutral" variant="ghost" :label="de.common.cancel" :disabled="busy" @click="open = false" />
          <UButton
            v-if="child.absence" type="button" size="xl" color="error" variant="outline" class="ml-auto" icon="i-lucide-x"
            :label="s.absent.remove" :disabled="busy" @click="send(null, date)"
          />
        </div>
      </form>
    </template>
  </UModal>
</template>
