<script setup lang="ts">
import { addDays, todayIso } from '#shared/domain/dates'
import { de } from '~/locales/de'
import { errorCode, errorMessage } from '~/utils/errors'

/**
 * "Abmeldung zurücknehmen". A child whose school start is already reached would be deregistered again at once, so the
 * server answers `school_start_required` and this button then asks for a new, future school start in a dialog. The dialog
 * stays open when saving fails. `refresh` re-reads what the page shows; it runs before the busy flag goes off.
 */
const props = defineProps<{ childId: number; label?: string; ariaLabel?: string; size?: 'xs' | 'sm'; disabled?: boolean; refresh: () => Promise<unknown> }>()
const { busy, guard } = useBusy()
const toast = useToast()
const open = ref(false)
const schoolStartDate = ref('')
const tomorrow = computed(() => addDays(todayIso(), 1))

/** Sends the request; false when it failed (the dialog opens when the server wants a new school start and none was sent). */
function send(body?: { schoolStartDate: string }): Promise<boolean> {
  return guard(async () => {
    try {
      await $fetch<unknown>(`/api/children/${props.childId}/unleave`, { method: 'POST', body })
    }
    catch (error) {
      if (!body && errorCode(error) === 'school_start_required') {
        schoolStartDate.value = ''
        open.value = true
      }
      else if (errorCode(error) !== 'facility_changed') toast.add({ title: errorMessage(error), color: 'error' })
      return false
    }
    // The child is back among the active ones, so the row (and this component) may disappear with the refresh.
    open.value = false
    await props.refresh()
    toast.add({ title: de.common.saved, color: 'success' })
    return true
  })
}
const unleave = () => send()
const submit = () => {
  if (schoolStartDate.value) send({ schoolStartDate: schoolStartDate.value })
}
</script>

<template>
  <span class="inline-flex">
    <UButton
      size="xs" color="neutral" variant="outline" :label="label ?? de.childLifecycle.unleave" :aria-label="ariaLabel"
      :loading="busy" :disabled="busy || disabled" @click="unleave"
    />
    <UModal v-model:open="open" :title="de.childLifecycle.unleave">
      <template #body>
        <form class="space-y-3" @submit.prevent="submit">
          <p class="text-sm">{{ de.errors.school_start_required }}</p>
          <UFormField :label="de.schoolChildren.newSchoolStart" required>
            <UInput v-model="schoolStartDate" type="date" :min="tomorrow" class="w-full" required />
          </UFormField>
          <div class="flex gap-2">
            <UButton type="submit" :label="de.childLifecycle.unleave" :loading="busy" :disabled="busy || !schoolStartDate" />
            <UButton type="button" color="neutral" variant="ghost" :label="de.common.cancel" :disabled="busy" @click="open = false" />
          </div>
        </form>
      </template>
    </UModal>
  </span>
</template>
