<script setup lang="ts">
import { de } from '~/locales/de'

/**
 * "Jetzt drucken" and "PDF herunterladen" for a print view; the server renders this very page as a PDF.
 * `search`: a query the PDF page needs too ("?group=3" for the plan of one group).
 */
const props = defineProps<{ fileName: string; search?: string }>()
const route = useRoute()
const downloading = ref(false)
const toast = useToast()

// File names may only contain letters, digits, dots and dashes (umlauts and spaces become dashes).
const safeName = computed(() => props.fileName.replace(/[^A-Za-z0-9.-]+/g, '-'))
const pdfUrl = computed(() => `/api/pdf?${new URLSearchParams({ path: route.path + (props.search ?? ''), name: safeName.value })}`)

function print() {
  window.print()
}

/** Fetches the file first (it takes a few seconds), so the button can show progress and errors. */
async function download() {
  downloading.value = true
  try {
    const blob = await $fetch<Blob>(pdfUrl.value, { responseType: 'blob' })
    const link = document.createElement('a')
    link.href = URL.createObjectURL(blob)
    link.download = `${safeName.value}.pdf`
    link.click()
    URL.revokeObjectURL(link.href)
  }
  catch {
    toast.add({ title: de.common.pdfFailed, color: 'error' })
  }
  finally {
    downloading.value = false
  }
}
</script>

<template>
  <div class="ml-auto flex gap-2 print:hidden">
    <UButton color="neutral" variant="outline" icon="i-lucide-file-down" :loading="downloading" :label="de.common.pdf" @click="download" />
    <UButton icon="i-lucide-printer" :label="de.plan.printNow" @click="print" />
  </div>
</template>
