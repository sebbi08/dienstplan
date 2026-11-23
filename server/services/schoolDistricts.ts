import { and, asc, eq, isNull } from 'drizzle-orm'
import {
  decodeCsvBytes, guessAsOf, looksTruncated, matchAddress, normalizeDistrictCode, parseDistrictCsv, parseDistrictLines, pdfLines,
  streetKey, validDistrictCode,
  SCHOOL_DISTRICT_LIMITS, type DistrictFlag, type DistrictLookup, type DistrictParseResult, type DistrictRow, type IndexRow,
} from '../../shared/domain/schoolDistricts'
import { isSchoolCategory } from '../../shared/domain/contacts'
import type {
  SchoolDistrictDto, SchoolDistrictListDto, SchoolDistrictListInput, SchoolDistrictMatchDto, SchoolDistrictParseDto,
  SchoolDistrictSettingsDto, SchoolOptionDto,
} from '../../shared/types/api'
import type { Db } from '../db/client'
import { contacts, schoolDistrictLists, schoolDistrictRows, schoolDistricts, users } from '../db/schema'
import { ServiceError } from '../lib/errors'
import { pdfTextItems } from '../lib/pdfText'
import { schoolNames, schoolOptions } from './contacts'

/**
 * Schulbezirke (docs/BETRIEB.md): the street lists of the school districts, one of each facility and one of the Träger
 * for all facilities (`facilityId` null; a facility's own list wins). Uploads are read into a preview and saved as a
 * whole; children are matched on read, by the street key index, never stored.
 */

type ListRow = typeof schoolDistrictLists.$inferSelect
/** A facility's own list, or the Träger's (null). */
export type DistrictScope = number | null

const L = SCHOOL_DISTRICT_LIMITS

const scopeCondition = (scope: DistrictScope) =>
  scope === null ? isNull(schoolDistrictLists.facilityId) : eq(schoolDistrictLists.facilityId, scope)

function loadList(db: Db, scope: DistrictScope): ListRow | null {
  return db.select().from(schoolDistrictLists).where(scopeCondition(scope)).get() ?? null
}

/** The list children of the facility are matched against: its own, else the Träger's. */
function effectiveList(db: Db, facilityId: number): ListRow | null {
  return loadList(db, facilityId) ?? loadList(db, null)
}

// ---- reading uploads ----------------------------------------------------------

const PDF_MAGIC = Buffer.from('%PDF-')

/**
 * Reads an uploaded CSV or PDF into rows for the preview (413 school_district_file_too_large over 10 MB, 400
 * school_district_file_type for anything else, e.g. an Excel file, 422 school_district_no_rows when nothing was found).
 * A PDF is read in a worker with time and memory limits (server/lib/pdfText.ts).
 */
export async function parseSchoolDistrictFile(file: { data: Buffer; filename: string }): Promise<SchoolDistrictParseDto> {
  if (file.data.length > L.maxBytes) throw new ServiceError(413, 'school_district_file_too_large')
  let result: DistrictParseResult
  const head = file.data.subarray(0, 1024)
  if (head.includes(PDF_MAGIC)) {
    result = parseDistrictLines(pdfLines(await pdfTextItems(file.data)))
  }
  else if (/\.(csv|txt)$/i.test(file.filename) && !head.includes(0)) {
    result = parseDistrictCsv(decodeCsvBytes(file.data))
  }
  else throw new ServiceError(400, 'school_district_file_type')
  if (result.rows.length === 0) throw new ServiceError(422, 'school_district_no_rows', { skipped: result.skippedCount })
  const name = file.filename.replace(/^.*[\\/]/, '').replace(/\.[^.]*$/, '').slice(0, L.maxListName)
  return {
    name, asOf: guessAsOf(file.filename), rows: result.rows, legend: result.legend, skipped: result.skipped,
    skippedCount: result.skippedCount, truncated: result.truncated,
  }
}

// ---- settings -----------------------------------------------------------------

/** The Träger's school contacts for all facilities: global contacts whose category name holds „Schule“. */
export function globalSchoolOptions(db: Db): SchoolOptionDto[] {
  // Only those for all facilities: the Träger's list applies in every facility (a school of chosen facilities would not
  // be one of the others).
  return db.select().from(contacts).where(and(isNull(contacts.facilityId), eq(contacts.allFacilities, true))).all()
    .filter(row => isSchoolCategory(row.categoryName ?? ''))
    .map(row => ({ id: row.id, name: row.city ? `${row.organisation}, ${row.city}` : row.organisation }))
    .sort((a, b) => a.name.localeCompare(b.name, 'de') || a.id - b.id)
}

const flagsOf = (text: string): DistrictFlag[] => (text === '' ? [] : text.split(',') as DistrictFlag[])

function listDto(db: Db, list: ListRow | null): SchoolDistrictListDto | null {
  if (!list) return null
  const rows: DistrictRow[] = db.select().from(schoolDistrictRows).where(eq(schoolDistrictRows.listId, list.id))
    .orderBy(asc(schoolDistrictRows.id)).all()
    .map(row => ({
      street: row.street, fromNo: row.fromNo, fromSuffix: row.fromSuffix, toNo: row.toNo, toSuffix: row.toSuffix,
      side: row.side, district: row.district, flags: flagsOf(row.flags), note: row.note,
    }))
  const districts = db.select().from(schoolDistricts).where(eq(schoolDistricts.listId, list.id)).all()
  const names = schoolNames(db, districts.map(district => district.contactId))
  // A school stored before that is no longer one of the scope's (its „Gilt für“ changed) stays, with a hint.
  const allowed = allowedContacts(db, list.facilityId)
  const updatedBy = list.updatedBy === null ? null
    : db.select({ username: users.username }).from(users).where(eq(users.id, list.updatedBy)).get()?.username ?? null
  return {
    scope: list.facilityId === null ? 'global' : 'facility',
    name: list.name,
    asOf: list.asOf,
    rows,
    districts: districts
      .map((district): SchoolDistrictDto => ({
        code: district.code, name: district.name, contactId: district.contactId,
        contactName: district.contactId === null ? null : names.get(district.contactId) ?? null,
        contactOutOfScope: district.contactId !== null && !allowed.has(district.contactId),
      }))
      .sort((a, b) => a.code.localeCompare(b.code, 'de', { numeric: true })),
    updatedAt: list.updatedAt,
    updatedBy,
  }
}

/** The facility's own list, the Träger's list, and the schools to map districts to (settings.facility). */
export function schoolDistrictSettings(db: Db, facilityId: number): SchoolDistrictSettingsDto {
  return {
    own: listDto(db, loadList(db, facilityId)),
    global: listDto(db, loadList(db, null)),
    schoolOptions: schoolOptions(db, facilityId),
    globalSchoolOptions: globalSchoolOptions(db),
  }
}

// ---- saving -------------------------------------------------------------------

const rowError = (index: number) => new ServiceError(400, 'school_district_row_invalid', { row: index + 1 })

/** A row as stored: trimmed, the code normalised; 400 school_district_row_invalid (with the row's number) otherwise. */
function checkedRow(row: DistrictRow, index: number): DistrictRow & { streetKey: string } {
  const street = row.street.replace(/\s+/g, ' ').trim()
  const key = streetKey(street)
  const district = normalizeDistrictCode(row.district)
  const fromSuffix = row.fromSuffix.toLowerCase()
  const toSuffix = row.toSuffix.toLowerCase()
  if (key === '' || !validDistrictCode(district)) throw rowError(index)
  if (!/^[a-z]?$/.test(fromSuffix) || !/^[a-z]?$/.test(toSuffix)) throw rowError(index)
  if ((row.fromNo === null) !== (row.toNo === null)) throw rowError(index)
  if (row.fromNo !== null && row.toNo !== null) {
    if (row.fromNo > row.toNo || (row.fromNo === row.toNo && toSuffix !== '' && fromSuffix > toSuffix)) throw rowError(index)
  }
  else if (fromSuffix || toSuffix) throw rowError(index)
  return {
    street, streetKey: key, fromNo: row.fromNo, fromSuffix, toNo: row.toNo, toSuffix,
    side: row.fromNo === null ? 'all' : row.side, district, flags: [...new Set(row.flags)], note: row.note.trim(),
  }
}

/** The schools a district of the scope may name: the facility's choices, or the Träger's global school contacts. */
function allowedContacts(db: Db, scope: DistrictScope): Set<number> {
  return new Set((scope === null ? globalSchoolOptions(db) : schoolOptions(db, scope)).map(option => option.id))
}

/** Rows per INSERT: well below SQLite's limit of bound values. */
const CHUNK = 400

/**
 * Saves a list for the scope, replacing the stored one with all its rows and districts (the list keeps who created it).
 * Every code the rows use gets a district (unnamed when not given); districts no row uses are dropped. 400
 * school_district_no_rows for an empty list, school_district_row_invalid, school_district_contact_invalid (a contact
 * that is no school of the scope; a contact already stored stays allowed).
 */
export function saveSchoolDistrictList(
  db: Db, actor: { id: number }, scope: DistrictScope, input: SchoolDistrictListInput, now: Date = new Date(),
): void {
  if (input.rows.length === 0) throw new ServiceError(400, 'school_district_no_rows')
  if (input.rows.length > L.maxRows) throw new ServiceError(400, 'school_district_too_many_rows')
  const rows = input.rows.map(checkedRow)
  const used = new Set(rows.map(row => row.district))
  const given = new Map<string, { name: string; contactId: number | null }>()
  for (const district of input.districts) {
    const code = normalizeDistrictCode(district.code)
    if (used.has(code) && !given.has(code)) given.set(code, { name: district.name.replace(/\s+/g, ' ').trim(), contactId: district.contactId })
  }
  const existing = loadList(db, scope)
  const stored = new Set(existing
    ? db.select({ contactId: schoolDistricts.contactId }).from(schoolDistricts).where(eq(schoolDistricts.listId, existing.id)).all()
        .map(row => row.contactId).filter((id): id is number => id !== null)
    : [])
  const allowed = allowedContacts(db, scope)
  for (const district of given.values()) {
    if (district.contactId !== null && !allowed.has(district.contactId) && !stored.has(district.contactId)) {
      throw new ServiceError(400, 'school_district_contact_invalid')
    }
  }
  const at = now.toISOString()
  const name = input.name.replace(/\s+/g, ' ').trim()
  const asOf = input.asOf.replace(/\s+/g, ' ').trim()
  db.transaction((tx) => {
    let listId: number
    if (existing) {
      listId = existing.id
      tx.update(schoolDistrictLists).set({ name, asOf, updatedAt: at, updatedBy: actor.id }).where(eq(schoolDistrictLists.id, listId)).run()
      tx.delete(schoolDistrictRows).where(eq(schoolDistrictRows.listId, listId)).run()
      tx.delete(schoolDistricts).where(eq(schoolDistricts.listId, listId)).run()
    }
    else {
      listId = tx.insert(schoolDistrictLists).values({
        facilityId: scope, name, asOf, createdAt: at, createdBy: actor.id, updatedAt: at, updatedBy: actor.id,
      }).returning({ id: schoolDistrictLists.id }).get().id
    }
    for (let start = 0; start < rows.length; start += CHUNK) {
      tx.insert(schoolDistrictRows).values(rows.slice(start, start + CHUNK).map(row => ({
        listId, street: row.street, streetKey: row.streetKey, fromNo: row.fromNo, fromSuffix: row.fromSuffix, toNo: row.toNo,
        toSuffix: row.toSuffix, side: row.side, district: row.district, flags: row.flags.join(','), note: row.note,
      }))).run()
    }
    tx.insert(schoolDistricts).values([...used].map(code => ({
      listId, code, name: given.get(code)?.name ?? '', contactId: given.get(code)?.contactId ?? null,
    }))).run()
  })
}

/** Deletes the scope's list (nothing to do when there is none). */
export function deleteSchoolDistrictList(db: Db, scope: DistrictScope): void {
  db.delete(schoolDistrictLists).where(scopeCondition(scope)).run()
}

// ---- matching -----------------------------------------------------------------

/** What a child needs for the match: its address and its „künftige Schule“. */
export interface DistrictChild { address: string; futureSchoolContactId: number | null }

/**
 * The matcher for children of the facility, against the list that applies (own, else the Träger's); null when there is
 * no list or the child has no address. Rows are fetched per street key through the index and kept for the next child;
 * the keys of truncated-looking streets are read only when a street is not in the list as written.
 */
export function schoolDistrictMatcher(db: Db, facilityId: number): (child: DistrictChild) => SchoolDistrictMatchDto | null {
  const list = effectiveList(db, facilityId)
  if (!list) return () => null
  const scope = list.facilityId === null ? 'global' as const : 'facility' as const
  const byKey = new Map<string, IndexRow[]>()
  let keys: string[] | null = null
  const lookup: DistrictLookup = {
    rowsOf: (key) => {
      let rows = byKey.get(key)
      if (!rows) {
        rows = db.select({
          fromNo: schoolDistrictRows.fromNo, fromSuffix: schoolDistrictRows.fromSuffix, toNo: schoolDistrictRows.toNo,
          toSuffix: schoolDistrictRows.toSuffix, side: schoolDistrictRows.side, district: schoolDistrictRows.district,
        }).from(schoolDistrictRows).where(and(eq(schoolDistrictRows.listId, list.id), eq(schoolDistrictRows.streetKey, key))).all()
        byKey.set(key, rows)
      }
      return rows
    },
    truncatedKeys: () => {
      keys ??= [...new Set(db.selectDistinct({ key: schoolDistrictRows.streetKey, street: schoolDistrictRows.street }).from(schoolDistrictRows)
        .where(eq(schoolDistrictRows.listId, list.id)).all().filter(row => looksTruncated(row.street)).map(row => row.key))]
      return keys
    },
  }
  let districts: Map<string, { name: string; contactId: number | null; contactName: string | null }> | null = null
  let choices: Set<number> | null = null
  const districtOf = (code: string) => {
    if (!districts) {
      const rows = db.select().from(schoolDistricts).where(eq(schoolDistricts.listId, list.id)).all()
      const names = schoolNames(db, rows.map(row => row.contactId))
      districts = new Map(rows.map(row => [row.code, {
        name: row.name, contactId: row.contactId, contactName: row.contactId === null ? null : names.get(row.contactId) ?? null,
      }]))
    }
    return districts.get(code) ?? { name: '', contactId: null, contactName: null }
  }
  return (child) => {
    const match = matchAddress(lookup, child.address)
    switch (match.kind) {
      case 'noAddress': return null
      case 'none': return { status: 'none', asOf: list.asOf, scope }
      case 'ambiguous': return { status: 'ambiguous', codes: match.codes, asOf: list.asOf, scope }
      case 'match': {
        const district = districtOf(match.code)
        choices ??= new Set(schoolOptions(db, facilityId).map(option => option.id))
        const canAdopt = district.contactId !== null && child.futureSchoolContactId === null && choices.has(district.contactId)
        return { status: 'match', code: match.code, name: district.name, asOf: list.asOf, scope, contactId: district.contactId, contactName: district.contactName, canAdopt }
      }
    }
  }
}
