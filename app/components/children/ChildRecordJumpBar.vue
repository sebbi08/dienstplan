<script setup lang="ts">
import { de } from '~/locales/de'
import { RECORD_SECTIONS, currentRecordSection, recordScrollTarget, recordSectionId, type RecordSection } from '~/utils/recordJump'

/**
 * The sticky bar below the child's name: one chip per section of the record that is shown (Stammdaten, Bezugspersonen,
 * Gesundheit … Unfälle), a tap scrolls there and the section in view is highlighted. It sticks right below the header
 * (on phones the header slides away while scrolling down, then the bar moves up to the top) and scrolls sideways when
 * the chips do not fit (tablet, phone). The address is not changed, so the guard for unsaved answers is not involved.
 * The sections are the elements `recordSectionId(key)` of the page; an empty one (a section not shown) is left out.
 */
const t = de.children.jump
const { user } = useUserSession()

const bar = useTemplateRef<HTMLElement>('bar')
const list = useTemplateRef<HTMLElement>('list')
const shown = ref<RecordSection[]>([])
const current = ref<RecordSection | null>(null)
/** Where the bar sticks: the bottom of the header as far as it is in view (0 when it slid away). */
const offset = ref(0)
/** The section just jumped to: highlighted at the end of the page, where it cannot reach the top; until the user scrolls. */
let preferred: RecordSection | null = null

const header = () => document.querySelector<HTMLElement>('[data-app-header]')
const sectionElement = (key: RecordSection) => document.getElementById(recordSectionId(key))
/** The header slides away while scrolling down on phones (not at the tablet, whose header stays). */
const headerHides = () => window.matchMedia('(max-width: 767.98px)').matches && user.value?.role !== 'terminal'

function scan() {
  shown.value = RECORD_SECTIONS.filter(key => sectionElement(key)?.firstElementChild)
}

function measure() {
  offset.value = Math.max(0, Math.round(header()?.getBoundingClientRect().bottom ?? 0))
  const tops = shown.value.map(key => ({ key, top: sectionElement(key)?.getBoundingClientRect().top ?? Infinity }))
  const line = offset.value + (bar.value?.offsetHeight ?? 0) + 16
  const atBottom = window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 4
  current.value = currentRecordSection(tops, line, { atBottom, preferred, viewportHeight: window.innerHeight })
}

let frame = 0
function update() {
  if (frame) return
  frame = requestAnimationFrame(() => {
    frame = 0
    scan()
    measure()
  })
}
const releasePreferred = () => { preferred = null }

function jump(key: RecordSection) {
  const element = sectionElement(key)
  if (!element) return
  preferred = key
  current.value = key
  const top = recordScrollTarget(element.getBoundingClientRect().top, window.scrollY, {
    header: Math.round(header()?.offsetHeight ?? 0), bar: bar.value?.offsetHeight ?? 0, headerHides: headerHides(),
  })
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
  window.scrollTo({ top, behavior: reduced ? 'auto' : 'smooth' })
  // The keyboard continues in the section reached (its heading or first control).
  element.querySelector<HTMLElement>('h2')?.setAttribute('tabindex', '-1')
  element.querySelector<HTMLElement>('h2')?.focus({ preventScroll: true })
}

// The chip of the current section stays in view in the sideways scrolling row.
watch(current, (key) => {
  const row = list.value
  const chip = key ? row?.querySelector<HTMLElement>(`[data-section="${key}"]`) : null
  if (!row || !chip) return
  const left = chip.offsetLeft - row.clientWidth / 2 + chip.offsetWidth / 2
  row.scrollTo({ left: Math.max(0, left), behavior: 'smooth' })
})

let observer: MutationObserver | null = null
onMounted(() => {
  scan()
  measure()
  window.addEventListener('scroll', update, { passive: true })
  window.addEventListener('resize', update, { passive: true })
  for (const name of ['wheel', 'touchstart', 'keydown'] as const) window.addEventListener(name, releasePreferred, { passive: true })
  header()?.addEventListener('transitionend', update)
  // Sections that appear or vanish later (a reload, an edit form, data loaded by a section).
  const record = bar.value?.parentElement
  if (record) {
    observer = new MutationObserver(update)
    observer.observe(record, { childList: true, subtree: true })
  }
})
onBeforeUnmount(() => {
  window.removeEventListener('scroll', update)
  window.removeEventListener('resize', update)
  for (const name of ['wheel', 'touchstart', 'keydown'] as const) window.removeEventListener(name, releasePreferred)
  header()?.removeEventListener('transitionend', update)
  observer?.disconnect()
  if (frame) cancelAnimationFrame(frame)
})
</script>

<template>
  <nav
    ref="bar" :aria-label="t.label"
    class="sticky z-30 -mx-4 min-h-[3.3rem] border-b border-gray-200 bg-gray-50/95 px-4 py-2 backdrop-blur print:hidden"
    :style="{ top: `${offset}px` }"
  >
    <!-- The chips come after mounting (they follow the sections on the page); the height is kept so nothing jumps. -->
    <ul ref="list" class="flex gap-1.5 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
      <li v-for="key in shown" :key="key" class="shrink-0">
        <a
          :href="`#${recordSectionId(key)}`" :data-section="key" :aria-current="current === key ? 'location' : undefined"
          class="inline-flex min-h-9 items-center whitespace-nowrap rounded-full px-3 text-sm ring-1 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
          :class="current === key ? 'bg-sky-600 font-semibold text-white ring-sky-600' : 'bg-white text-gray-700 ring-gray-200 hover:bg-gray-100'"
          @click.prevent="jump(key)"
        >
          {{ t.sections[key] }}
        </a>
      </li>
    </ul>
  </nav>
</template>
