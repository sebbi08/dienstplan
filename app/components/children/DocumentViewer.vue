<script setup lang="ts">
import type { PDFDocumentLoadingTask } from 'pdfjs-dist'
import { de } from '~/locales/de'
import { documentFileUrl } from '~/utils/children'

/**
 * Shows a child document inside the app (used at the tablet): PDFs page by page on canvases, photos as an image. The
 * file only lives in memory and is dropped when the viewer closes or unmounts - e.g. when the tablet locks and the
 * app navigates away - so nothing is stored on the device and there is no link to the file address.
 * `mimeType` may be empty (the completeness view does not know it); the answer's content type is used then.
 */
const props = defineProps<{ documentId: number; title: string; mimeType: string }>()
const open = defineModel<boolean>('open', { default: false })

const status = ref<'loading' | 'ready' | 'failed'>('loading')
const imageUrl = ref<string | null>(null)
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
  if (imageUrl.value) URL.revokeObjectURL(imageUrl.value)
  imageUrl.value = null
  // Canvases hold the rendered pages; resetting their size frees the bitmap memory right away.
  for (const canvas of pagesEl.value?.querySelectorAll('canvas') ?? []) {
    canvas.width = 0
    canvas.height = 0
  }
  pageCount.value = 0
}

async function renderPdf(data: ArrayBuffer, current: number) {
  const pdfjs = await import('pdfjs-dist')
  if (current !== generation) return
  pdfjs.GlobalWorkerOptions.workerSrc = new URL('pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url).toString()
  const task = pdfjs.getDocument({ data: new Uint8Array(data), enableXfa: false })
  loadingTask = task
  const document = await task.promise
  if (current !== generation) return void task.destroy()
  pageCount.value = document.numPages
  status.value = 'ready'
  await nextTick()
  const ratio = Math.min(window.devicePixelRatio || 1, 2)
  for (let number = 1; number <= document.numPages; number++) {
    const canvas = pagesEl.value?.querySelector<HTMLCanvasElement>(`canvas[data-page="${number}"]`)
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
      imageUrl.value = URL.createObjectURL(new Blob([data], { type }))
      status.value = 'ready'
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
      <div ref="pagesEl" class="space-y-3">
        <img v-if="imageUrl" :src="imageUrl" :alt="title" class="mx-auto h-auto max-w-full">
        <canvas
          v-for="number in pageCount" :key="number" :data-page="number"
          class="block w-full rounded bg-white ring-1 ring-gray-200" role="img" :aria-label="`${title} – ${number}/${pageCount}`"
        />
      </div>
    </template>
  </UModal>
</template>
