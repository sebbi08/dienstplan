import type { IsoDate } from './types'

export function cellKey(employeeId: number, date: IsoDate): string {
  return `${employeeId}|${date}`
}

export function parseCellKey(key: string): { employeeId: number; date: IsoDate } {
  const [employeeId, date] = key.split('|')
  return { employeeId: Number(employeeId), date: date! }
}

export function noteKey(field: 'info1' | 'info2', date: IsoDate): string {
  return `${field}|${date}`
}
