import { describe, expect, it } from 'vitest'
import {
  districtLabel, draftFromUpload, groupByDistrict, inputOfDraft, matchText, numbersLabel, rowInvalid, rowIssues, syncDistricts,
} from '../../app/utils/schoolDistricts'
import type { DistrictRow } from '../../shared/domain/schoolDistricts'
import type { SchoolDistrictListDto, SchoolDistrictMatchDto } from '../../shared/types/api'

const row = (street: string, from: number | null, to: number | null, district: string, extra: Partial<DistrictRow> = {}): DistrictRow => ({
  street, fromNo: from, fromSuffix: '', toNo: to, toSuffix: '', side: 'even', district, flags: [], note: '', ...extra,
})

describe('the settings editor of a street list', () => {
  it('shows the house numbers', () => {
    expect(numbersLabel(row('A', 2, 14, '01'))).toBe('2–14')
    expect(numbersLabel(row('A', 1, 3, '01', { toSuffix: 'a' }))).toBe('1–3a')
    expect(numbersLabel(row('A', 20, 20, '01'))).toBe('20')
    expect(numbersLabel(row('A', null, null, '01'))).toBe('ganze Straße')
  })

  it('marks flagged, overlapping and incomplete rows', () => {
    expect(rowIssues([
      row('Ahornweg', 2, 14, '01', { flags: ['unclear'] }), row('Ahornweg', 10, 20, '02'), row('', 1, 3, '01'), row('B', 5, 3, '01'),
    ])).toEqual([['unclear', 'overlap'], ['overlap'], ['invalid'], ['invalid']])
    expect(rowInvalid(row('B', 1, null, '01'))).toBe(true)
    expect(rowInvalid(row('B', 3, 3, '01', { fromSuffix: 'b', toSuffix: 'a' }))).toBe(true)
    expect(rowInvalid(row('B', 3, 3, '01', { fromSuffix: 'a', toSuffix: 'B' }))).toBe(false)
    expect(rowInvalid(row('B', 1, 3, ' '))).toBe(true)
  })

  it('keeps one district per code the rows use, with the names known', () => {
    expect(syncDistricts([row('A', 1, 3, '2'), row('B', 1, 3, '01'), row('C', 1, 3, '02')], [{ code: '02', name: 'Süd', contactId: 5 }, { code: '09', name: 'alt', contactId: null }]))
      .toEqual([{ code: '01', name: '', contactId: null }, { code: '02', name: 'Süd', contactId: 5 }])
  })

  it('prefills an upload with the legend and keeps the stored schools of the same codes', () => {
    const stored = { districts: [{ code: '02', name: 'Alte Süd', contactId: 7, contactName: 'Süd' }, { code: '03', name: 'Nord', contactId: 8, contactName: 'Nord' }] } as SchoolDistrictListDto
    const draft = draftFromUpload({
      name: 'liste', asOf: '2021', rows: [row('A', 1, 3, '02'), row('B', 2, 4, '03')], legend: [{ code: '02', name: 'Südstadtschule' }],
      skipped: [], skippedCount: 0, truncated: false,
    }, stored)
    expect(draft.districts).toEqual([{ code: '02', name: 'Südstadtschule', contactId: 7 }, { code: '03', name: 'Nord', contactId: 8 }])
    expect(inputOfDraft({ ...draft, name: ' Liste ', rows: [row('A', 1, 3, '2', { toSuffix: 'A' })] })).toEqual({
      name: 'Liste', asOf: '2021', rows: [row('A', 1, 3, '02', { toSuffix: 'a' })], districts: [{ code: '02', name: 'Südstadtschule', contactId: 7 }],
    })
  })
})

describe('the district of a child', () => {
  const match = (code: string, name = ''): SchoolDistrictMatchDto =>
    ({ status: 'match', code, name, asOf: '2021', scope: 'facility', contactId: null, contactName: null, canAdopt: false })

  it('reads as the brief words it', () => {
    expect(matchText(match('02', 'Südstadtschule'))).toEqual({ text: 'Schulbezirk 02 – Südstadtschule', source: '(laut Liste, Stand 2021)' })
    expect(matchText({ status: 'ambiguous', codes: ['01', '03'], asOf: '', scope: 'global' }))
      .toEqual({ text: 'nicht eindeutig: 01, 03 – bitte von Hand wählen', source: '(laut Liste)' })
    expect(matchText({ status: 'none', asOf: '2021', scope: 'facility' }).text).toBe('Adresse nicht in der Liste')
    expect(districtLabel(match('02', 'Süd'))).toBe('02 – Süd')
    expect(districtLabel(null)).toBe('')
  })

  it('groups the school children by district, the open cases last', () => {
    const children = [
      { id: 1, schoolDistrict: match('03') }, { id: 2, schoolDistrict: null }, { id: 3, schoolDistrict: match('01', 'Zeyher') },
      { id: 4, schoolDistrict: { status: 'none', asOf: '', scope: 'facility' } as SchoolDistrictMatchDto },
      { id: 5, schoolDistrict: { status: 'ambiguous', codes: ['01', '03'], asOf: '', scope: 'facility' } as SchoolDistrictMatchDto },
      { id: 6, schoolDistrict: match('01', 'Zeyher') },
    ]
    expect(groupByDistrict(children).map(group => [group.label, group.rows.map(child => child.id)])).toEqual([
      ['Schulbezirk 01 – Zeyher', [3, 6]], ['Schulbezirk 03', [1]], ['nicht eindeutig', [5]], ['nicht in der Liste', [4]],
      ['ohne Adresse/Liste', [2]],
    ])
  })
})
