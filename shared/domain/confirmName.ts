/**
 * A name as typed to confirm a deletion: Unicode NFC (an „ü“ pasted from a Mac or a PDF), runs of whitespace as one
 * space (the page shows „Anna  Maria“ as „Anna Maria“), no spaces at the ends. Upper and lower case still count.
 */
export function normalizeConfirmName(text: string): string {
  return text.normalize('NFC').replace(/\s+/g, ' ').trim()
}

/** Whether the typed text confirms this name (see normalizeConfirmName). */
export function confirmsName(typed: string, name: string): boolean {
  return normalizeConfirmName(typed) === normalizeConfirmName(name)
}
