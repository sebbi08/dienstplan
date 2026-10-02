/**
 * Mobile header pattern: hidden while scrolling down, shown again as soon as the user scrolls up
 * (or is near the top). The caller applies the result only on small screens.
 */
export function useHideOnScroll(threshold = 64) {
  const hidden = ref(false)
  let lastY = 0

  function onScroll() {
    const y = window.scrollY
    if (y <= threshold) hidden.value = false
    else if (Math.abs(y - lastY) > 4) hidden.value = y > lastY
    lastY = y
  }

  onMounted(() => {
    lastY = window.scrollY
    window.addEventListener('scroll', onScroll, { passive: true })
  })
  onBeforeUnmount(() => window.removeEventListener('scroll', onScroll))

  return hidden
}
