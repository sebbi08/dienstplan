<script setup lang="ts">
import type { ChildRecordDto, ReviewSection } from '#shared/types/api'
import { de } from '~/locales/de'
import { formatDate } from '~/utils/format'

/**
 * "Seit dem Gruppenwechsel am … nicht bestätigt": shown for a section of the record that a group change left unconfirmed,
 * with the button that confirms it (for whoever may edit the record). `named` puts the field in front of the text, for
 * the banners that share a section with other fields (Betreuungsform, Bezugserzieher in the master data).
 */
/** `reload` re-reads the record; the busy flag stays on until it is done, so the banner is gone (or still there) when the button works again. */
const props = defineProps<{ child: ChildRecordDto; section: ReviewSection; reload: () => Promise<unknown>; named?: boolean }>()
const { busy, run } = useBusyAction(() => props.reload())

const since = computed(() => props.child.reviews[props.section] ?? null)
const confirmSection = () => run(() => $fetch<unknown>(`/api/children/${props.child.id}/confirm`, { method: 'POST', body: { section: props.section } }), de.common.saved)
</script>

<template>
  <div v-if="since" class="flex flex-wrap items-center gap-3 rounded-lg bg-amber-50 p-3 text-sm text-amber-900 ring-1 ring-amber-200" role="status">
    <UIcon name="i-lucide-triangle-alert" class="size-5 shrink-0" aria-hidden="true" />
    <p class="min-w-0 flex-1">
      <strong v-if="named" class="font-medium">{{ de.groupChange.sections[section] }}: </strong>{{ de.groupChange.unconfirmed(formatDate(since)) }}
    </p>
    <UButton
      v-if="child.canEdit" size="xs" color="neutral" variant="outline" icon="i-lucide-check" :label="de.groupChange.confirm"
      :loading="busy" :disabled="busy" @click="confirmSection"
    />
  </div>
</template>
