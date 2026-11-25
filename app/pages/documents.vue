<script setup lang="ts">
import { de } from '~/locales/de'
import { signaturesLocation } from '~/utils/areaTabs'
import { chosenDocumentTab, documentTabs, type DocumentTab } from '~/utils/documents'

/**
 * „Dokumente“ (under „Mehr“ for the managers, under „Meins“ for Mitarbeiter, from the start page at the tablet): the tab
 * „Bögen“ with the form templates of the active facility (formTemplates.manage) and the tab „Zum Ausdrucken“ (key
 * `templates`) with the blank PDF forms to print or fill in (printTemplates.view; the tablet without an unlock) – both
 * with a short line saying what is in them – and the tab „Wissen“ with the knowledge library
 * (knowledge.view: every account, the tablet; with „Gelesen und verstanden“, the open ones counted in the tab). Only the
 * tabs the viewer may use show; `?tab=` opens one (the old addresses /templates and /admin/forms send here with it). The
 * former tab „Unterschriften“ is a tab of Mitarbeitende now: `?tab=signatures` sends there.
 */
definePageMeta({
  middleware: [to => (to.query.tab === 'signatures' ? navigateTo(signaturesLocation(to), { replace: true }) : undefined)],
})
useHead({ title: de.documents.title })
const { user } = useUserSession()
const { can } = useCan()
const onTablet = computed(() => user.value?.role === 'terminal')
const tabs = computed(() => (user.value ? documentTabs({ role: user.value.role, can }) : []))

const route = useRoute()
const tab = ref<DocumentTab | null>(chosenDocumentTab(route.query.tab, tabs.value))
// A link to the other tab (or a change of the rights) opens it without a reload.
watch([() => route.query.tab, tabs], () => {
  tab.value = chosenDocumentTab(route.query.tab, tabs.value)
})
function selectTab(next: DocumentTab) {
  tab.value = next
  // The address names the tab, so a reload or a shared link opens it again.
  navigateTo({ query: { ...route.query, tab: next }, hash: route.hash }, { replace: true })
}
function onTabKey(event: KeyboardEvent) {
  const keys = tabs.value
  const index = keys.indexOf(tab.value ?? 'forms')
  const last = keys.length - 1
  const next = { ArrowRight: index === last ? 0 : index + 1, ArrowLeft: index <= 0 ? last : index - 1, Home: 0, End: last }[event.key]
  if (next === undefined || !keys[next]) return
  event.preventDefault()
  selectTab(keys[next])
  nextTick(() => document.getElementById(`documents-tab-${keys[next]}`)?.focus())
}
const TAB_ICONS: Record<DocumentTab, string> = {
  forms: 'i-lucide-clipboard-list', templates: 'i-lucide-printer', knowledge: 'i-lucide-book-open',
}
/** The entries the account's employee still has to confirm (loaded by the layout for the menu). */
const { data: knowledgeOpen } = useNuxtData<{ count: number }>('knowledge-open-count')
const tabLabel = (key: DocumentTab) => (key === 'knowledge' ? de.knowledge.tabLabel(knowledgeOpen.value?.count ?? 0) : de.documents.tabs[key])
</script>

<template>
  <div class="mx-auto max-w-5xl space-y-4">
    <div class="flex flex-wrap items-center gap-3">
      <h1 class="text-2xl font-semibold">{{ de.documents.title }}</h1>
      <UButton
        v-if="onTablet" size="lg" color="neutral" variant="outline" icon="i-lucide-arrow-left" :label="de.terminal.toStart" to="/terminal"
        class="ml-auto"
      />
    </div>

    <div
      v-if="tabs.length > 1" role="tablist" :aria-label="de.documents.tabsLabel" class="grid gap-2"
      :class="tabs.length > 2 ? 'grid-cols-3 sm:max-w-xl' : 'grid-cols-2 sm:max-w-md'"
    >
      <button
        v-for="key in tabs" :id="`documents-tab-${key}`" :key="key" type="button" role="tab"
        :aria-selected="tab === key" :tabindex="tab === key ? 0 : -1" aria-controls="documents-tab-panel"
        class="flex min-h-12 min-w-0 items-center justify-center gap-2 rounded-xl px-2 py-2 text-base font-semibold ring-1 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
        :class="tab === key ? 'bg-sky-600 text-white ring-sky-600' : 'bg-white text-gray-700 ring-gray-300 hover:bg-gray-50'"
        @click="selectTab(key)" @keydown="onTabKey"
      >
        <UIcon :name="TAB_ICONS[key]" class="size-5 shrink-0" aria-hidden="true" />
        <span class="min-w-0 text-left">
          <span class="block truncate">{{ tabLabel(key) }}</span>
          <!-- The short line of „Bögen“ and „Zum Ausdrucken“ (from 640 px in the tab, on phones below the tabs). -->
          <span
            v-if="de.documents.tabHints[key]" class="hidden text-xs font-normal leading-snug sm:block"
            :class="tab === key ? 'text-sky-50' : 'text-gray-500'"
          >{{ de.documents.tabHints[key] }}</span>
        </span>
      </button>
    </div>
    <h2 v-else-if="tab" class="sr-only">{{ de.documents.tabs[tab] }}</h2>
    <p v-if="tab && de.documents.tabHints[tab]" class="text-sm text-gray-600" :class="tabs.length > 1 ? 'sm:hidden' : ''">{{ de.documents.tabHints[tab] }}</p>

    <div id="documents-tab-panel" :role="tabs.length > 1 ? 'tabpanel' : undefined" :aria-labelledby="tabs.length > 1 && tab ? `documents-tab-${tab}` : undefined">
      <FormsTemplateEditor v-if="tab === 'forms'" />
      <TemplatesLibrary v-else-if="tab === 'templates'" class="max-w-3xl" />
      <KnowledgeLibrary v-else-if="tab === 'knowledge'" class="max-w-3xl" />
    </div>
  </div>
</template>
