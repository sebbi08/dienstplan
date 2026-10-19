<script setup lang="ts">
import { de } from '~/locales/de'
import { type OverviewColumn, type OverviewSection, triSymbol, triText } from '~/utils/childrenOverview'

/**
 * One sheet of the children overview as a table: the child's name first, then the sheet's columns, the children
 * under a heading row per group. On screen it scrolls sideways inside its frame while the name column stands still
 * (a tablet in portrait); `print` gives the bordered, wrapping version of the print page.
 */
const props = defineProps<{ columns: OverviewColumn[]; sections: OverviewSection[]; showGroups: boolean; print?: boolean }>()

const triColor = (value: boolean | null) => (value === true ? 'text-green-700' : value === false ? 'text-red-700' : 'text-gray-400')

const th = computed(() => (props.print ? 'border border-gray-400 px-1.5 py-1 text-left align-bottom font-semibold' : 'px-3 py-2 text-left align-bottom font-medium'))
const td = computed(() => (props.print ? 'border border-gray-400 px-1.5 py-1 align-top' : 'px-3 py-2 align-top'))
// The name column stays in place while the table scrolls sideways; its own background lets the cells pass beneath.
const sticky = 'sticky left-0 z-10 shadow-[1px_0_0_0_var(--color-gray-200)]'
const headName = computed(() => (props.print ? th.value : [th.value, sticky, 'bg-gray-100']))
const rowName = computed(() => (props.print ? [td.value, 'text-left font-medium'] : [td.value, sticky, 'min-w-32 max-w-48 bg-white text-left font-medium']))
// Long texts (allergies, addresses) and lists get room on screen; on paper the columns share the page width.
const wide = computed(() => (props.print ? '' : 'min-w-40 max-w-72'))
</script>

<template>
  <!-- `relative` keeps the screen-reader texts (absolutely placed) inside the scrolling frame, not widening the page. -->
  <div :class="print ? '' : 'relative overflow-x-auto rounded-lg bg-white ring-1 ring-gray-200'">
    <table :class="print ? 'w-full border-collapse text-xs' : 'min-w-full text-sm'">
      <thead :class="print ? 'bg-gray-100' : 'bg-gray-100 text-xs text-gray-600'">
        <tr>
          <th :class="headName" scope="col">{{ de.children.fields.lastName }}, {{ de.children.fields.firstName }}</th>
          <th v-for="column in columns" :key="column.key" :class="th" scope="col" :title="column.title">
            <template v-if="print">{{ column.label }}</template>
            <!-- A tap on the head shows the full text (a tablet has no hover); the title serves the mouse. -->
            <UPopover v-else :content="{ side: 'bottom', align: 'start' }">
              <button type="button" class="whitespace-nowrap text-left underline decoration-dotted underline-offset-2 hover:text-gray-900">
                {{ column.label }}
              </button>
              <template #content>
                <p class="max-w-64 p-2 text-sm font-normal text-gray-800">{{ column.title }}</p>
              </template>
            </UPopover>
          </th>
        </tr>
      </thead>
      <tbody v-for="section in sections" :key="section.key">
        <tr v-if="showGroups" :class="print ? 'break-after-avoid' : 'border-t border-gray-200 bg-gray-50'">
          <th :colspan="columns.length + 1" :class="[td, 'text-left']" scope="rowgroup">
            <span v-if="print" class="text-sm font-semibold">{{ section.name }}</span>
            <!-- Stays readable at the left edge while the table scrolls sideways. -->
            <span v-else class="sticky left-3 inline-block text-xs font-semibold uppercase tracking-wide text-gray-500">{{ section.name }}</span>
          </th>
        </tr>
        <tr v-for="row in section.rows" :key="row.id" :class="print ? 'break-inside-avoid' : 'border-t border-gray-100'">
          <th :class="rowName" scope="row">
            <template v-if="print">{{ row.lastName }}, {{ row.firstName }}</template>
            <NuxtLink v-else :to="`/children/${row.id}`" class="text-sky-700 hover:underline">{{ row.lastName }}, {{ row.firstName }}</NuxtLink>
          </th>
          <td v-for="column in columns" :key="column.key" :class="td">
            <template v-for="cell in [column.cell(row)]" :key="cell.kind">
              <span v-if="cell.kind === 'tri'" class="whitespace-nowrap">
                <span :class="triColor(cell.value)" class="font-semibold" aria-hidden="true">{{ triSymbol(cell.value) }}</span>
                <span class="sr-only">{{ triText(cell.value) }}</span>
                <span v-if="cell.date" class="ml-1 text-gray-700">{{ cell.date }}</span>
              </span>
              <span v-else-if="cell.kind === 'text'" :class="column.wide ? [wide, 'whitespace-pre-line break-words'] : 'whitespace-nowrap'" class="block">{{ cell.text }}</span>
              <ul v-else-if="cell.lines.length" :class="wide" class="space-y-1">
                <li v-for="(line, index) in cell.lines" :key="index" :class="line.danger ? 'text-red-700' : ''">
                  <span :class="line.danger ? 'font-semibold' : ''">{{ line.text }}</span>
                  <span
                    v-for="(detail, at) in line.details" :key="at" class="block text-xs"
                    :class="line.danger ? 'whitespace-pre-line break-words' : 'whitespace-nowrap text-gray-600'"
                  >{{ detail }}</span>
                </li>
              </ul>
            </template>
          </td>
        </tr>
      </tbody>
    </table>
  </div>
</template>
