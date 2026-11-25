<script setup lang="ts">
/**
 * A small in-page table of contents: a row of chips, each jumping to an element of the page by its id (and putting the
 * anchor into the address, so the link can be shared). A second tap on the same chip scrolls there again.
 */
defineProps<{ label: string; items: readonly { id: string; title: string }[] }>()
const router = useRouter()
const route = useRoute()

async function jump(id: string) {
  if (route.hash !== `#${id}`) await router.replace({ hash: `#${id}` })
  document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
}
</script>

<template>
  <nav :aria-label="label" class="flex flex-wrap gap-1.5">
    <a
      v-for="item in items" :key="item.id" :href="`#${item.id}`"
      class="rounded-full bg-white px-3 py-1 text-xs text-gray-700 ring-1 ring-gray-200 hover:bg-gray-50 focus-visible:outline-2 focus-visible:outline-primary"
      @click.prevent="jump(item.id)"
    >
      {{ item.title }}
    </a>
  </nav>
</template>
