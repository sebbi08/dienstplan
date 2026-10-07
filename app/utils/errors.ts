import { de } from '~/locales/de'

/** The `code` of a failed API call ($fetch error), if any. */
export function errorCode(error: unknown): string | undefined {
  return (error as { data?: { data?: { code?: string } } } | null)?.data?.data?.code
}

export function errorMessage(error: unknown): string {
  const code = errorCode(error)
  if (code && code in de.errors) return de.errors[code as keyof typeof de.errors]
  return de.errors.generic
}
