<script setup lang="ts">
/**
 * One list of „Dokumente“ → „Zum Ausdrucken“ or „Wissen“ as a bordered section: in „Alle“ one per subcategory (and
 * „Allgemein“), in the search one per „Kategorie › Unterkategorie“. The tinted header bar shows a folder icon, the name in
 * bold, „· 3 Einträge“ and a note on who sees it; a foldable one is a button (aria-expanded, aria-controls) with a chevron,
 * and folded it keeps its count. Without a title only the content shows (a single list, no section).
 */
const props = withDefaults(defineProps<{
  /** Unique on the page: the section's content gets the id `<sectionId>-body`. */
  sectionId: string
  title?: string | null
  /** „3 Einträge“, „1 Vorlage“. */
  count?: string
  /** E.g. „nur Leitung und Träger“; '' for none. */
  badge?: string
  collapsible?: boolean
}>(), { title: null, count: '', badge: '', collapsible: false })
const open = defineModel<boolean>('open', { default: true })
const bodyId = computed(() => `${props.sectionId}-body`)
const shown = computed(() => !props.collapsible || open.value)
</script>

<template>
  <section v-if="title !== null" class="overflow-hidden rounded-lg bg-white ring-1 ring-gray-300">
    <h3 class="text-sm">
      <component
        :is="collapsible ? 'button' : 'div'" :type="collapsible ? 'button' : undefined"
        :aria-expanded="collapsible ? open : undefined" :aria-controls="collapsible ? bodyId : undefined"
        class="flex min-h-11 w-full flex-wrap items-center gap-x-2 gap-y-1 bg-slate-100 px-4 py-2 text-left text-gray-900"
        :class="[
          shown ? 'border-b border-gray-300' : '',
          collapsible ? 'cursor-pointer hover:bg-slate-200/70 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-primary' : '',
        ]"
        @click="collapsible && (open = !open)"
      >
        <UIcon :name="shown ? 'i-lucide-folder-open' : 'i-lucide-folder'" class="size-4 shrink-0 text-sky-700" aria-hidden="true" />
        <span class="font-semibold break-words">{{ title }}</span>
        <span v-if="count" class="whitespace-nowrap text-gray-600">· {{ count }}</span>
        <span v-if="badge" class="whitespace-nowrap rounded bg-amber-100 px-1.5 py-0.5 text-xs text-amber-800">{{ badge }}</span>
        <UIcon
          v-if="collapsible" name="i-lucide-chevron-down" class="ml-auto size-5 shrink-0 text-gray-500 transition-transform print:hidden"
          :class="open ? 'rotate-180' : ''" aria-hidden="true"
        />
      </component>
    </h3>
    <div v-show="shown" :id="bodyId">
      <slot />
    </div>
  </section>
  <div v-else :id="bodyId">
    <slot />
  </div>
</template>
