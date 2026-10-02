import type { Ref } from 'vue'

/**
 * Maximum height for a scroll container so it ends at the bottom of the window: on desktop the page itself
 * then does not scroll as well (no second scrollbar). On phones (where the header slides away while
 * scrolling) the container gets almost the full window height. Returns a CSS length.
 */
export function useFitToViewport(element: Ref<HTMLElement | null>, options: { bottomGap?: number; minHeight?: number } = {}) {
  const { bottomGap = 16, minHeight = 320 } = options
  const maxHeight = ref<string | undefined>()

  function update() {
    const el = element.value
    if (!el) return
    if (window.innerWidth < 768) {
      maxHeight.value = `${window.innerHeight - 8}px`
      return
    }
    const top = el.getBoundingClientRect().top + window.scrollY
    maxHeight.value = `${Math.max(minHeight, Math.floor(window.innerHeight - top - bottomGap))}px`
  }

  let observer: ResizeObserver | undefined
  onMounted(() => {
    update()
    window.addEventListener('resize', update)
    // Content above the container (toolbar wrapping, badges) may change its position.
    observer = new ResizeObserver(update)
    observer.observe(document.body)
  })
  onBeforeUnmount(() => {
    window.removeEventListener('resize', update)
    observer?.disconnect()
  })

  return maxHeight
}
