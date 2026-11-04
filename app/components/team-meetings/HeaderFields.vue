<script setup lang="ts">
import { de } from '~/locales/de'
import { FACILITY_GROUP, toggleParticipant, type TeamMeetingHeaderForm } from '~/utils/teamMeetings'

/**
 * The header of a team meeting to type in: Datum, Uhrzeit, Gruppe (or the whole facility), Protokollführung and
 * „Teilnehmer“: ticked from the staff (they sign the minutes), then further ones typed in (they do not sign).
 */
const props = defineProps<{ groups: { id: number; name: string }[]; staff: { id: number; name: string; shortName: string }[] }>()
const form = defineModel<TeamMeetingHeaderForm>({ required: true })
const t = de.teamMeetings

const groupItems = computed(() => [
  { label: t.wholeFacility, value: FACILITY_GROUP },
  ...props.groups.map(group => ({ label: group.name, value: String(group.id) })),
])
function toggle(id: number, on: boolean) {
  form.value.participantIds = toggleParticipant(form.value.participantIds, props.staff, id, on)
}
</script>

<template>
  <div class="grid grid-cols-2 gap-3">
    <UFormField :label="t.date" required class="col-span-2 sm:col-span-1">
      <DateTextInput v-model="form.date" :label="t.date" size="lg" class="w-full" required />
    </UFormField>
    <UFormField :label="t.start" :hint="t.startHint" class="col-span-2 sm:col-span-1">
      <TimeInput v-model="form.start" any-minute size="lg" class="w-full" :aria-label="t.start" />
    </UFormField>
    <UFormField :label="t.group" class="col-span-2 sm:col-span-1">
      <USelect v-model="form.group" :items="groupItems" size="lg" class="w-full" :aria-label="t.group" />
    </UFormField>
    <UFormField :label="t.recorder" class="col-span-2 sm:col-span-1">
      <UInput v-model="form.recorder" maxlength="80" size="lg" class="w-full" />
    </UFormField>
    <fieldset class="col-span-2 min-w-0 space-y-2">
      <legend class="mb-1 text-sm font-medium">{{ t.participants }}</legend>
      <template v-if="staff.length">
        <p class="text-xs text-gray-500">{{ t.participantsPick }}</p>
        <ul class="grid max-h-64 gap-x-4 overflow-y-auto sm:grid-cols-2">
          <li v-for="person in staff" :key="person.id" class="min-w-0">
            <UCheckbox
              class="min-h-11 items-center" :model-value="form.participantIds.includes(person.id)"
              @update:model-value="toggle(person.id, !!$event)"
            >
              <template #label>
                <span class="break-words">{{ person.name }}</span>
                <span v-if="person.shortName" class="ml-1 text-gray-500">{{ person.shortName }}</span>
              </template>
            </UCheckbox>
          </li>
        </ul>
      </template>
      <UInput
        v-model="form.participants" maxlength="300" size="lg" :placeholder="t.participantsMorePlaceholder" class="w-full"
        :aria-label="t.participantsMorePlaceholder"
      />
    </fieldset>
  </div>
</template>
