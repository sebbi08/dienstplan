<script setup lang="ts">
import { de } from '~/locales/de'
import { FACILITY_GROUP, type TeamMeetingHeaderForm } from '~/utils/teamMeetings'

/** The header of a team meeting to type in: Datum, Uhrzeit, Gruppe (or the whole facility), Teilnehmer, Protokollführung. */
const props = defineProps<{ groups: { id: number; name: string }[] }>()
const form = defineModel<TeamMeetingHeaderForm>({ required: true })
const t = de.teamMeetings

const groupItems = computed(() => [
  { label: t.wholeFacility, value: FACILITY_GROUP },
  ...props.groups.map(group => ({ label: group.name, value: String(group.id) })),
])
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
    <UFormField :label="t.participants" class="col-span-2">
      <UInput v-model="form.participants" maxlength="300" size="lg" :placeholder="t.participantsPlaceholder" class="w-full" />
    </UFormField>
  </div>
</template>
