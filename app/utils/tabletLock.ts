/**
 * Whether a lock request of the tablet that failed must be sent again: when the server did not answer it (no network,
 * timeout, gateway down), failed on its side (5xx) or asked to wait (429). A refusal (401/403/4xx) is an answer: the
 * tablet session is gone or no tablet's, so there is no unlock left to end.
 */
export function lockNeedsRetry(error: unknown): boolean {
  const status = (error as { status?: unknown; statusCode?: unknown } | null)?.status
    ?? (error as { statusCode?: unknown } | null)?.statusCode
  if (typeof status !== 'number' || status === 0) return true
  return status >= 500 || status === 429
}
