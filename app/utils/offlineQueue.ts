import { OFFLINE_BATCH_MAX } from '#shared/domain/offlineStamps'
import type { OfflineStampInputDto, OfflineStampResultDto, StampAction } from '#shared/types/api'

/**
 * The tablet's offline queue, the parts without browser storage (docs/BETRIEB.md „Stempeln ohne Netz am Tablet“; the
 * storage is app/utils/offlineStore.ts, the flow app/composables/useOfflineStamps.ts).
 */

/** A stamp kept on the tablet until the server confirmed it; the PIN only encrypted (AES-GCM). */
export interface QueuedStamp {
  /** Order of the taps on this tablet (IndexedDB key). */
  seq: number
  clientId: string
  employeeId: number
  name: string
  action: StampAction
  /** The tablet's clock at the tap, ISO with offset. */
  stampedAt: string
  pin: { iv: Uint8Array<ArrayBuffer>; data: ArrayBuffer }
}

/** Retries while the queue is not empty and the server cannot be reached: 5, 10, 20, 40 seconds, then every 60 seconds. */
export const RETRY_MAX_MS = 60_000

const pad = (value: number) => String(Math.abs(value)).padStart(2, '0')

/** The tablet's local time as ISO with its offset, e.g. „2026-11-19T07:58:12+01:00“ (what the server gets as stamp time). */
export function isoWithOffset(date: Date): string {
  const offset = -date.getTimezoneOffset()
  const sign = offset >= 0 ? '+' : '-'
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`
    + `:${pad(date.getSeconds())}${sign}${pad(Math.trunc(offset / 60))}:${pad(offset % 60)}`
}

/** The queue in the order of the taps (the tablet's clock may have been changed in between, so not by time). */
export function sortQueue<T extends Pick<QueuedStamp, 'seq'>>(items: readonly T[]): T[] {
  return [...items].sort((a, b) => a.seq - b.seq)
}

/**
 * The request body for POST /api/terminal/offline-stamps: the tablet's clock now and the first 50 stamps in the order
 * of the taps, with their PINs decrypted for the request only.
 */
export function buildSyncPayload(
  items: readonly (Pick<QueuedStamp, 'seq' | 'clientId' | 'employeeId' | 'action' | 'stampedAt'> & { pin: string })[],
  clientNow: Date,
): { clientNow: string; stamps: OfflineStampInputDto[] } {
  return {
    clientNow: isoWithOffset(clientNow),
    stamps: sortQueue(items).slice(0, OFFLINE_BATCH_MAX).map(item => ({
      clientId: item.clientId, employeeId: item.employeeId, pin: item.pin, action: item.action, stampedAt: item.stampedAt,
    })),
  }
}

/** The client ids the server answered for: they leave the queue, PIN included, whatever became of them. */
export function settledIds(results: readonly OfflineStampResultDto[]): string[] {
  return results.map(result => result.clientId)
}

/**
 * Whether a failed request means the server cannot be reached (no answer at all, or the proxy's 502/503/504) rather
 * than a refusal: only then the tablet keeps a stamp offline.
 */
export function isServerUnreachable(error: unknown): boolean {
  const status = (error as { status?: unknown; statusCode?: unknown } | null)?.status
    ?? (error as { statusCode?: unknown } | null)?.statusCode
  return typeof status !== 'number' || status === 0 || status === 502 || status === 503 || status === 504
}

/** The server's „too many requests“ (429): simply the next try later, no message. */
export function isRateLimited(error: unknown): boolean {
  const status = (error as { status?: unknown; statusCode?: unknown } | null)?.status
    ?? (error as { statusCode?: unknown } | null)?.statusCode
  return status === 429
}

/** The tablet's requests give up after this long; a request without answer by then counts as „server not reachable“. */
export const REQUEST_TIMEOUT_MS = 8_000

/** The wait before the next try of a failed sync: 5 s doubled per failed try, at most 60 s. */
export function retryDelay(failedTries: number): number {
  return Math.min(RETRY_MAX_MS, 5_000 * 2 ** Math.max(0, failedTries - 1))
}

/** The Berlin-independent „hh:mm“ of the tablet clock for the confirmation „Gespeichert (offline) – …“. */
export function tabletClockTime(date: Date): string {
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`
}
