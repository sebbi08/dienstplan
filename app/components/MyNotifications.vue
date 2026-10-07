<script setup lang="ts">
import { weekday } from '#shared/domain/dates'
import { de } from '~/locales/de'
import { formatDayShort } from '~/utils/format'

/** Unread messages about changed duties, with "Gelesen" (on "Mein Dienstplan"). */
const { unread, markRead } = useMyNotifications()
const run = useAction()
</script>

<template>
  <UAlert
    v-if="unread.length" color="warning" variant="soft" icon="i-lucide-bell" :title="de.notifications.title(unread.length)"
  >
    <template #description>
      <div class="space-y-2">
        <div v-for="message in unread" :key="message.id" class="space-y-0.5">
          <p class="font-medium">{{ de.notifications.release(de.months[message.month - 1]!, message.year) }}</p>
          <ul class="space-y-0.5">
            <li v-for="change in message.changes" :key="change.date">
              {{ formatDayShort(change.date, weekday(change.date)) }}: {{ change.before }} → <span class="font-semibold">{{ change.after }}</span>
            </li>
          </ul>
        </div>
        <UButton
          size="xs" color="warning" variant="outline" icon="i-lucide-check" :label="de.notifications.markRead"
          @click="run(() => markRead(unread.map(message => message.id)))"
        />
      </div>
    </template>
  </UAlert>
</template>
