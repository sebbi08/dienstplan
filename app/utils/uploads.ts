import { MAX_UPLOAD_BYTES, megabytes } from '#shared/domain/uploads'
import { de } from '~/locales/de'

/** „Die Datei ist zu groß (31,2 MB). Erlaubt sind höchstens 30 MB.“, or null when the file fits. */
export function uploadSizeError(size: number, maxBytes: number = MAX_UPLOAD_BYTES): string | null {
  return size > maxBytes ? de.common.fileTooLarge(megabytes(size), Math.round(maxBytes / 1024 / 1024)) : null
}

/**
 * The file chosen in a file input's change event, checked at once: too large → the message is shown, the input is
 * cleared and null comes back, so nothing is uploaded and the person can pick another file.
 */
export function pickedFile(event: Event, toast: { add: (toast: { title: string; color: 'error' }) => unknown }, maxBytes: number = MAX_UPLOAD_BYTES): File | null {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0] ?? null
  if (!file) return null
  const error = uploadSizeError(file.size, maxBytes)
  if (!error) return file
  toast.add({ title: error, color: 'error' })
  input.value = ''
  return null
}
