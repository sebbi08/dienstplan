import {
  houseNumberText, normalizeDistrictCode, overlappingRows, streetKey, validDistrictCode, type DistrictFlag, type DistrictLegendEntry, type DistrictRow,
} from '#shared/domain/schoolDistricts'
import type {
  SchoolDistrictListDto, SchoolDistrictListInput, SchoolDistrictMatchDto, SchoolDistrictParseDto,
} from '#shared/types/api'
import { de } from '~/locales/de'

const t = de.schoolDistricts

/** The house numbers of a row as shown: „2–14“, „1–3a“, „20“, „ganze Straße“. */
export function numbersLabel(row: Pick<DistrictRow, 'fromNo' | 'fromSuffix' | 'toNo' | 'toSuffix'>): string {
  if (row.fromNo === null || row.toNo === null) return t.editor.wholeStreet
  const from = houseNumberText(row.fromNo, row.fromSuffix)
  const to = houseNumberText(row.toNo, row.toSuffix)
  return from === to ? from : `${from}–${to}`
}

/** What is wrong with a row before saving (the server's checks), null when it is fine. */
export function rowInvalid(row: DistrictRow): boolean {
  if (streetKey(row.street) === '' || !validDistrictCode(normalizeDistrictCode(row.district))) return true
  if (!/^[a-z]?$/i.test(row.fromSuffix) || !/^[a-z]?$/i.test(row.toSuffix)) return true
  if ((row.fromNo === null) !== (row.toNo === null)) return true
  if (row.fromNo === null || row.toNo === null) return row.fromSuffix !== '' || row.toSuffix !== ''
  if (!Number.isInteger(row.fromNo) || !Number.isInteger(row.toNo) || row.fromNo < 0 || row.toNo > 9999) return true
  const fromSuffix = row.fromSuffix.toLowerCase()
  const toSuffix = row.toSuffix.toLowerCase()
  return row.fromNo > row.toNo || (row.fromNo === row.toNo && toSuffix !== '' && fromSuffix > toSuffix)
}

export type RowIssue = DistrictFlag | 'overlap' | 'invalid'

/** The issues of every row: its stored flags, an overlap with another district, and being incomplete. */
export function rowIssues(rows: readonly DistrictRow[]): RowIssue[][] {
  const overlaps = overlappingRows(rows)
  return rows.map((row, index) => [
    ...row.flags,
    ...(overlaps.has(index) ? ['overlap' as const] : []),
    ...(rowInvalid(row) ? ['invalid' as const] : []),
  ])
}

/** A list being edited: the rows, the district names and schools, name and „Stand“. */
export interface DistrictDraft {
  name: string
  asOf: string
  rows: DistrictRow[]
  districts: { code: string; name: string; contactId: number | null }[]
}

/** The districts the rows use (by code), with the names and schools known so far (the first entry of a code wins). */
export function syncDistricts(rows: readonly DistrictRow[], known: readonly { code: string; name: string; contactId: number | null }[]): DistrictDraft['districts'] {
  const byCode = new Map<string, { name: string; contactId: number | null }>()
  for (const entry of known) {
    const code = normalizeDistrictCode(entry.code)
    if (!byCode.has(code)) byCode.set(code, entry)
  }
  const codes = [...new Set(rows.map(row => normalizeDistrictCode(row.district)).filter(Boolean))]
    .sort((a, b) => a.localeCompare(b, 'de', { numeric: true }))
  return codes.map(code => ({ code, name: byCode.get(code)?.name ?? '', contactId: byCode.get(code)?.contactId ?? null }))
}

/** A draft from an upload: the legend's names prefill the districts. */
export function draftFromUpload(parsed: SchoolDistrictParseDto, stored: SchoolDistrictListDto | null): DistrictDraft {
  // Names and schools of the stored list stay where the upload names none (a new edition of the same list).
  const known: DistrictDraft['districts'] = [
    ...parsed.legend.map((entry: DistrictLegendEntry) => ({ ...entry, contactId: stored?.districts.find(d => d.code === entry.code)?.contactId ?? null })),
    ...(stored?.districts ?? []),
  ]
  return { name: parsed.name, asOf: parsed.asOf, rows: parsed.rows.map(row => ({ ...row, flags: [...row.flags] })), districts: syncDistricts(parsed.rows, known) }
}

/** A draft from a stored list. */
export function draftFromList(list: SchoolDistrictListDto): DistrictDraft {
  return {
    name: list.name, asOf: list.asOf, rows: list.rows.map(row => ({ ...row, flags: [...row.flags] })),
    districts: list.districts.map(({ code, name, contactId }) => ({ code, name, contactId })),
  }
}

/** What the save route takes. */
export function inputOfDraft(draft: DistrictDraft): SchoolDistrictListInput {
  return {
    name: draft.name.trim(), asOf: draft.asOf.trim(),
    rows: draft.rows.map(row => ({ ...row, fromSuffix: row.fromSuffix.toLowerCase(), toSuffix: row.toSuffix.toLowerCase(), district: normalizeDistrictCode(row.district) })),
    districts: syncDistricts(draft.rows, draft.districts),
  }
}

/** The shown text of a child's district, and where it comes from („laut Liste, Stand 2021“). */
export function matchText(match: SchoolDistrictMatchDto): { text: string; source: string } {
  const source = t.record.source(match.asOf)
  if (match.status === 'match') return { text: t.record.match(match.code, match.name), source }
  if (match.status === 'ambiguous') return { text: t.record.ambiguous(match.codes.join(', ')), source }
  return { text: t.record.none, source }
}

/** The district of a child in the school children list: its code, or why there is none. */
export type DistrictGroupKey = string | 'none' | 'ambiguous' | 'noAddress'

export function districtKey(match: SchoolDistrictMatchDto | null): DistrictGroupKey {
  if (!match) return 'noAddress'
  return match.status === 'match' ? `code:${match.code}` : match.status
}

/** The short label of a child's district in the list. */
export function districtLabel(match: SchoolDistrictMatchDto | null): string {
  if (!match) return ''
  if (match.status === 'match') return match.name ? `${match.code} – ${match.name}` : match.code
  if (match.status === 'ambiguous') return `${t.list.ambiguous} (${match.codes.join(', ')})`
  return t.list.none
}

const groupLabel = (key: DistrictGroupKey, match: SchoolDistrictMatchDto | null) => {
  if (key === 'none') return t.list.none
  if (key === 'ambiguous') return t.list.ambiguous
  if (key === 'noAddress') return t.list.noAddress
  return match?.status === 'match' ? t.record.match(match.code, match.name) : key
}

const KEY_ORDER = (key: DistrictGroupKey) => (key.startsWith('code:') ? 0 : key === 'ambiguous' ? 1 : key === 'none' ? 2 : 3)

/**
 * The school children by district: the districts by code, then „nicht eindeutig“, „nicht in der Liste“ and those
 * without address or list; the children keep their order inside a group.
 */
export function groupByDistrict<T extends { schoolDistrict: SchoolDistrictMatchDto | null }>(rows: readonly T[]): { key: DistrictGroupKey; label: string; rows: T[] }[] {
  const groups = new Map<DistrictGroupKey, { label: string; rows: T[] }>()
  for (const row of rows) {
    const key = districtKey(row.schoolDistrict)
    const group = groups.get(key) ?? { label: groupLabel(key, row.schoolDistrict), rows: [] }
    group.rows.push(row)
    groups.set(key, group)
  }
  return [...groups.entries()]
    .sort(([a], [b]) => KEY_ORDER(a) - KEY_ORDER(b) || a.localeCompare(b, 'de', { numeric: true }))
    .map(([key, group]) => ({ key, ...group }))
}

/** Whether any child of the list has a district result (a list applies to the facility). */
export const hasDistricts = (rows: readonly { schoolDistrict: SchoolDistrictMatchDto | null }[]) => rows.some(row => row.schoolDistrict !== null)
