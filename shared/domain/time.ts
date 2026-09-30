import type { Minutes } from './types'

export interface TimeSpan {
  start: Minutes
  end: Minutes
  breakStart: Minutes | null
  breakEnd: Minutes | null
}

export type SpanError = 'not_on_grid' | 'end_before_start' | 'incomplete_break' | 'break_outside'

const pad = (value: number) => String(value).padStart(2, '0')

export function parseTime(value: string): Minutes | null {
  const match = /^(\d{1,2}):(\d{2})$/.exec(value.trim())
  if (!match) return null
  const hours = Number(match[1])
  const minutes = Number(match[2])
  if (minutes > 59 || hours > 24 || (hours === 24 && minutes !== 0)) return null
  return hours * 60 + minutes
}

export function parseDuration(value: string): number | null {
  const match = /^(\d{1,4}):([0-5]\d)$/.exec(value.trim())
  if (!match) return null
  return Number(match[1]) * 60 + Number(match[2])
}

export function formatTime(minutes: Minutes): string {
  return `${Math.floor(minutes / 60)}:${pad(minutes % 60)}`
}

/** Value for <input type="time">, which needs a two-digit hour. */
export function toTimeInput(minutes: Minutes): string {
  return `${pad(Math.floor(minutes / 60))}:${pad(minutes % 60)}`
}

export function formatDuration(minutes: number): string {
  const sign = minutes < 0 ? '−' : ''
  const abs = Math.abs(minutes)
  return `${sign}${Math.floor(abs / 60)}:${pad(abs % 60)}`
}

export function formatSignedDuration(minutes: number): string {
  if (minutes === 0) return '±0:00'
  return minutes > 0 ? `+${formatDuration(minutes)}` : formatDuration(minutes)
}

export function netMinutes(span: TimeSpan): number {
  const pause = span.breakStart !== null && span.breakEnd !== null ? span.breakEnd - span.breakStart : 0
  return span.end - span.start - pause
}

export function validateSpan(span: TimeSpan): SpanError | null {
  const values = [span.start, span.end, span.breakStart, span.breakEnd]
    .filter((value): value is number => value !== null)
  if (values.some(value => value % 5 !== 0)) return 'not_on_grid'
  if (span.end <= span.start) return 'end_before_start'
  if ((span.breakStart === null) !== (span.breakEnd === null)) return 'incomplete_break'
  if (span.breakStart !== null && span.breakEnd !== null) {
    if (span.breakEnd <= span.breakStart || span.breakStart < span.start || span.breakEnd > span.end) {
      return 'break_outside'
    }
  }
  return null
}
