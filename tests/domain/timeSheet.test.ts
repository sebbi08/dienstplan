import { describe, expect, it } from 'vitest'
import { markedRecords } from '../../app/utils/timeSheet'

const day = (records: { id: number; start: number; end: number | null }[], lateMinutes: number | null, earlyMinutes: number | null) =>
  ({ records, lateMinutes, earlyMinutes })

describe('the records whose times carry the late / early mark', () => {
  it('takes the earliest arrival and the latest departure, whatever the order of the list', () => {
    const records = [{ id: 1, start: 840, end: 1000 }, { id: 2, start: 480, end: 600 }, { id: 3, start: 620, end: 700 }]
    expect(markedRecords(day(records, 15, 20))).toEqual({ lateId: 2, earlyId: 1 })
  })

  it('marks nothing without marks or records', () => {
    expect(markedRecords(day([{ id: 1, start: 480, end: 600 }], null, null))).toEqual({ lateId: null, earlyId: null })
    expect(markedRecords(day([], 10, 10))).toEqual({ lateId: null, earlyId: null })
  })
})
