<script setup lang="ts">
import { de } from '~/locales/de'
import { strokeBounds, type Point } from '~/utils/pdfAnnotate'

/**
 * Signing for the fill view: a white field to draw in with a finger, a pen or the mouse; „Einfügen“ hands the drawing
 * over as a picture (PNG, transparent, cut to the drawing) that the fill view places on the page. The drawing lives
 * only in memory: it is wiped after handing it over, on „Neu anfangen“ and when the pad closes, and is never stored
 * anywhere else (it ends up only inside the saved PDF).
 */
const open = defineModel<boolean>('open', { default: false })
const emit = defineEmits<{ done: [picture: { file: File; width: number; height: number }] }>()
const t = de.pdfFill

const PAD_HEIGHT = 200
/** Line width in CSS pixels of the pad. */
const LINE = 2.6
const INK = '#14234b'
/** The picture: sharp enough for print (170 pt at 300 dpi is about 710 px), small enough for the PDF. */
const MAX_PICTURE_WIDTH = 800

const canvasEl = ref<HTMLCanvasElement | null>(null)
const empty = ref(true)
const missing = ref(false)
/** The picture is being made: „Einfügen“ once only (a double tap would place two signatures). */
const placing = ref(false)
let strokes: Point[][] = []
let drawing: Point[] | null = null
let pad = { width: 0, height: PAD_HEIGHT }
let ratio = 1

function drawStroke(context: CanvasRenderingContext2D, stroke: readonly Point[]) {
  const first = stroke[0]
  if (!first) return
  context.beginPath()
  if (stroke.length === 1) {
    context.arc(first.x, first.y, LINE / 2, 0, Math.PI * 2)
    context.fill()
    return
  }
  context.moveTo(first.x, first.y)
  // Smooth: a curve through the middles of the segments.
  for (let index = 1; index < stroke.length - 1; index++) {
    const point = stroke[index]!
    const next = stroke[index + 1]!
    context.quadraticCurveTo(point.x, point.y, (point.x + next.x) / 2, (point.y + next.y) / 2)
  }
  const last = stroke[stroke.length - 1]!
  context.lineTo(last.x, last.y)
  context.stroke()
}

function prepare(context: CanvasRenderingContext2D) {
  context.lineWidth = LINE
  context.lineCap = 'round'
  context.lineJoin = 'round'
  context.strokeStyle = INK
  context.fillStyle = INK
}

function redraw() {
  const canvas = canvasEl.value
  const context = canvas?.getContext('2d')
  if (!canvas || !context) return
  context.setTransform(ratio, 0, 0, ratio, 0, 0)
  context.clearRect(0, 0, pad.width, pad.height)
  // A line to sign on (only on the pad, not in the picture).
  context.save()
  context.strokeStyle = '#cbd5e1'
  context.lineWidth = 1
  context.setLineDash([6, 5])
  context.beginPath()
  context.moveTo(16, pad.height * 0.72)
  context.lineTo(pad.width - 16, pad.height * 0.72)
  context.stroke()
  context.restore()
  prepare(context)
  for (const stroke of strokes) drawStroke(context, stroke)
}

function setUp() {
  const canvas = canvasEl.value
  if (!canvas) return
  ratio = Math.min(window.devicePixelRatio || 1, 3)
  pad = { width: Math.max(200, canvas.clientWidth), height: PAD_HEIGHT }
  canvas.width = Math.round(pad.width * ratio)
  canvas.height = Math.round(pad.height * ratio)
  redraw()
}

function pointOf(event: PointerEvent): Point {
  const box = canvasEl.value!.getBoundingClientRect()
  return { x: event.clientX - box.left, y: event.clientY - box.top }
}

function onDown(event: PointerEvent) {
  if (event.pointerType === 'mouse' && event.button !== 0) return
  event.preventDefault()
  canvasEl.value?.setPointerCapture(event.pointerId)
  drawing = [pointOf(event)]
  strokes.push(drawing)
  empty.value = false
  missing.value = false
  redraw()
}
function onMove(event: PointerEvent) {
  if (!drawing) return
  event.preventDefault()
  const events = typeof event.getCoalescedEvents === 'function' ? event.getCoalescedEvents() : []
  for (const each of events.length ? events : [event]) drawing.push(pointOf(each))
  redraw()
}
function onUp() {
  drawing = null
}

/** Wipes the drawing (nothing of it stays in memory). */
function clear() {
  strokes = []
  drawing = null
  empty.value = true
  missing.value = false
  redraw()
}

async function place() {
  if (placing.value) return
  placing.value = true
  try {
    await makePicture()
  }
  finally {
    placing.value = false
  }
}

async function makePicture() {
  const bounds = strokeBounds(strokes, LINE * 2, pad)
  if (!bounds) {
    missing.value = true
    return
  }
  const scale = Math.min(4, MAX_PICTURE_WIDTH / bounds.width)
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(bounds.width * scale))
  canvas.height = Math.max(1, Math.round(bounds.height * scale))
  const context = canvas.getContext('2d')
  if (!context) return
  context.setTransform(scale, 0, 0, scale, -bounds.x * scale, -bounds.y * scale)
  prepare(context)
  for (const stroke of strokes) drawStroke(context, stroke)
  const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/png'))
  const { width, height } = canvas
  canvas.width = 0
  canvas.height = 0
  if (!blob) return
  // A new name each time: pdf.js keeps pictures by name and size.
  const file = new File([blob], `Unterschrift-${Date.now()}.png`, { type: 'image/png' })
  clear()
  open.value = false
  emit('done', { file, width, height })
}

function onResize() {
  if (open.value) setUp()
}
watch(open, async (isOpen) => {
  if (!isOpen) return clear()
  await nextTick()
  // The modal is laid out after it opened.
  requestAnimationFrame(setUp)
})
onMounted(() => window.addEventListener('resize', onResize))
onBeforeUnmount(() => {
  window.removeEventListener('resize', onResize)
  strokes = []
  drawing = null
})
</script>

<template>
  <UModal v-model:open="open" :title="t.padTitle" :description="t.padHint">
    <template #body>
      <div class="space-y-3">
        <canvas
          ref="canvasEl" role="img" :aria-label="t.padLabel"
          class="block h-[200px] w-full cursor-crosshair touch-none rounded-lg bg-white ring-1 ring-gray-300"
          @pointerdown="onDown" @pointermove="onMove" @pointerup="onUp" @pointercancel="onUp" @lostpointercapture="onUp"
        />
        <p v-if="missing" class="text-sm text-red-700" role="alert">{{ t.padEmpty }}</p>
        <div class="flex flex-wrap gap-2">
          <UButton icon="i-lucide-check" :label="t.padPlace" :loading="placing" :disabled="empty || placing" @click="place" />
          <UButton color="neutral" variant="outline" icon="i-lucide-eraser" :label="t.padClear" :disabled="empty" @click="clear" />
          <UButton color="neutral" variant="ghost" :label="de.common.cancel" @click="open = false" />
        </div>
      </div>
    </template>
  </UModal>
</template>
