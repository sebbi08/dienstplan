<script setup lang="ts">
import type { PDFDocumentLoadingTask } from 'pdfjs-dist/legacy/build/pdf.mjs'
import { de } from '~/locales/de'
import { documentFileUrl } from '~/utils/children'

/**
 * Shows a child document inside the app (used at the tablet): PDFs page by page and photos, all drawn on canvases. The
 * file only lives in memory and is dropped when the viewer closes or unmounts - e.g. when the tablet locks and the
 * app navigates away - so nothing is stored on the device and there is no link to the file address. A canvas, unlike
 * an image, offers no "save image" on a long press; the context menu and the touch callout are suppressed as well.
 * `mimeType` may be empty (the completeness view does not know it); the answer's content type is used then.
 */
const props = defineProps<{ documentId: number; title: string; mimeType: string }>()
const open = defineModel<boolean>('open', { default: false })

const status = ref<'loading' | 'ready' | 'failed'>('loading')
const kind = ref<'pdf' | 'image'>('pdf')
const pageCount = ref(0)
const pagesEl = ref<HTMLElement | null>(null)

let loadingTask: PDFDocumentLoadingTask | null = null
/** Counts the loads; a load that finds a newer number (closed, reopened or unmounted meanwhile) stops. */
let generation = 0

function release() {
  generation++
  // Destroying the loading task also destroys its document and stops the worker's work for it.
  void loadingTask?.destroy()
  loadingTask = null
  // Canvases hold the rendered pages; resetting their size frees the bitmap memory right away.
  for (const canvas of pagesEl.value?.querySelectorAll('canvas') ?? []) {
    canvas.width = 0
    canvas.height = 0
  }
  pageCount.value = 0
}

/** The canvas of page `number` once Vue has rendered it. */
function pageCanvas(number: number): HTMLCanvasElement | null {
  return pagesEl.value?.querySelector<HTMLCanvasElement>(`canvas[data-page="${number}"]`) ?? null
}

/** Draws a photo on a canvas, at most as wide as the viewer; the decoded image and its blob address are dropped after. */
async function renderImage(data: ArrayBuffer, type: string, current: number) {
  kind.value = 'image'
  pageCount.value = 1
  await nextTick()
  const canvas = pageCanvas(1)
  if (!canvas) throw new Error('no canvas')
  const url = URL.createObjectURL(new Blob([data], { type }))
  try {
    const image = new Image()
    image.src = url
    await image.decode()
    if (current !== generation) return
    const ratio = Math.min(window.devicePixelRatio || 1, 2)
    const cssWidth = Math.min(image.naturalWidth, pagesEl.value?.clientWidth || 600)
    const scale = Math.min(1, (cssWidth * ratio) / image.naturalWidth)
    canvas.width = Math.max(1, Math.round(image.naturalWidth * scale))
    canvas.height = Math.max(1, Math.round(image.naturalHeight * scale))
    canvas.style.width = `${cssWidth}px`
    const context = canvas.getContext('2d')
    if (!context) throw new Error('no canvas')
    context.drawImage(image, 0, 0, canvas.width, canvas.height)
    status.value = 'ready'
  }
  finally {
    URL.revokeObjectURL(url)
  }
}

async function renderPdf(data: ArrayBuffer, current: number) {
  // The legacy build carries the polyfills the main build leaves out (Promise.try, Math.sumPrecise …), so older
  // tablet browsers can show PDFs too.
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs')
  if (current !== generation) return
  pdfjs.GlobalWorkerOptions.workerSrc = new URL('pdfjs-dist/legacy/build/pdf.worker.min.mjs', import.meta.url).toString()
  const task = pdfjs.getDocument({ data: new Uint8Array(data), enableXfa: false })
  loadingTask = task
  const document = await task.promise
  if (current !== generation) return void task.destroy()
  kind.value = 'pdf'
  pageCount.value = document.numPages
  status.value = 'ready'
  await nextTick()
  const ratio = Math.min(window.devicePixelRatio || 1, 2)
  for (let number = 1; number <= document.numPages; number++) {
    const canvas = pageCanvas(number)
    if (!canvas) return
    const page = await document.getPage(number)
    if (current !== generation) return
    const width = pagesEl.value?.clientWidth || 600
    const base = page.getViewport({ scale: 1 })
    const viewport = page.getViewport({ scale: (width / base.width) * ratio })
    canvas.width = Math.floor(viewport.width)
    canvas.height = Math.floor(viewport.height)
    await page.render({ canvas, viewport }).promise
    page.cleanup()
    if (current !== generation) return
  }
}

async function load() {
  release()
  const current = generation
  status.value = 'loading'
  try {
    const response = await $fetch.raw<ArrayBuffer>(documentFileUrl(props.documentId), { responseType: 'arrayBuffer' })
    if (current !== generation) return
    const data = response._data
    if (!data) throw new Error('empty')
    const type = props.mimeType || response.headers.get('content-type')?.split(';')[0]?.trim() || ''
    if (type === 'application/pdf') {
      await renderPdf(data, current)
    }
    else if (type === 'image/jpeg' || type === 'image/png') {
      await renderImage(data, type, current)
    }
    else {
      throw new Error('unsupported type')
    }
  }
  catch {
    if (current === generation) {
      release()
      status.value = 'failed'
    }
  }
}

watch(open, (isOpen) => {
  if (isOpen) void load()
  else release()
}, { immediate: true })
onBeforeUnmount(release)
</script>

<template>
  <UModal v-model:open="open" :title="title" :ui="{ content: 'sm:max-w-4xl' }" :description="title">
    <template #body>
      <p v-if="status === 'failed'" class="text-sm text-red-700" role="alert">{{ de.childDocuments.viewerFailed }}</p>
      <p v-else-if="status === 'loading'" class="text-sm text-gray-500">{{ de.childDocuments.viewerLoading }}</p>
      <!-- No long-press menu ("save image", "share"), no text selection and no dragging the pages out. -->
      <div ref="pagesEl" class="space-y-3 select-none" style="-webkit-touch-callout: none" @contextmenu.prevent @dragstart.prevent>
        <canvas
          v-for="number in pageCount" :key="number" :data-page="number" draggable="false"
          class="block rounded bg-white ring-1 ring-gray-200" :class="kind === 'image' ? 'mx-auto h-auto max-w-full' : 'w-full'"
          role="img" :aria-label="kind === 'image' ? title : `${title} – ${number}/${pageCount}`"
        />
      </div>
    </template>
  </UModal>
</template>
