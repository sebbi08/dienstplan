import { de } from '~/locales/de'

export function errorMessage(error: unknown): string {
  const code = (error as { data?: { data?: { code?: string } } } | null)?.data?.data?.code
  if (code && code in de.errors) return de.errors[code as keyof typeof de.errors]
  return de.errors.generic
}
