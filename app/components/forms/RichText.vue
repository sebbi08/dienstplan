<script setup lang="ts">
import { richTextHtml, richTextInlineHtml } from '#shared/domain/richText'

/**
 * A stored text answer shown read-only: formatted text as its HTML, sanitized again right here (shared/domain/
 * richText.ts — never the stored string itself), plain text from before the formatting escaped with its line breaks.
 * `inline` writes paragraphs and list items as lines (with „• “ / „1. “), for fixed boxes like those of the U 1000.
 */
const props = defineProps<{ value: string; inline?: boolean }>()
const html = computed(() => (props.inline ? richTextInlineHtml(props.value) : richTextHtml(props.value)))
</script>

<template>
  <!-- v-html only of the sanitizer's output (allowlist: p, br, strong, em, u, ul, ol, li; no attributes). -->
  <div class="rich-text break-words" v-html="html" />
</template>
