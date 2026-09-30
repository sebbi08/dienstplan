import type { SlotState } from '#shared/domain/dayOverview'
import type { ColorKey } from '#shared/types/api'

export const chipClasses: Record<ColorKey, string> = {
  neutral: 'bg-white text-gray-900 ring-1 ring-gray-300',
  gray: 'bg-gray-300 text-gray-800',
  green: 'bg-green-200 text-green-900',
  yellow: 'bg-yellow-200 text-yellow-900',
  blue: 'bg-blue-200 text-blue-900',
  red: 'bg-red-200 text-red-900',
  violet: 'bg-violet-200 text-violet-900',
  orange: 'bg-orange-200 text-orange-900',
}

export const slotClasses: Record<SlotState, string> = {
  off: 'bg-gray-50',
  work: 'bg-teal-400',
  support: 'bg-violet-300',
  break: 'bg-red-500',
  absent: 'bg-gray-300',
  prep_time: 'bg-green-400',
  office: 'bg-yellow-300',
  holiday: 'bg-blue-300',
  other: 'bg-orange-200',
}

export function balanceClass(minutes: number): string {
  if (minutes > 0) return 'text-green-700'
  return minutes < 0 ? 'text-red-700' : 'text-gray-500'
}
