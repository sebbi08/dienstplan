import type Database from 'better-sqlite3'
import type { BuiltinConsentKey } from '../../shared/domain/childConsents'

/**
 * A realistic filled database as the fixed consent columns left it (raw SQL, so it works on a database at any
 * migration from 0110 on): three facilities, groups, active children with mixed yes / no / open consents and health
 * permissions, contacts (parents, call order, contact bans) and parent meetings. Facility 3 has no children. Used to
 * prove that the migration to the facility's own consent questions and overview tabs renders the overview exactly as
 * before (tests/fixtures/children-overview-before.json was rendered with the fixed sheets).
 */
export const SAMPLE_NOW = new Date('2026-10-19T06:00:00Z')
export const SAMPLE_TODAY = '2026-10-19'

/** The fixed consent columns in the old order, then the three health permissions. */
export const SAMPLE_CONSENT_COLUMNS = [
  'consent_artwork_display', 'consent_photos_display', 'consent_photos_foreign_portfolios', 'consent_photos_internal_events',
  'consent_photos_names_birthdays_display', 'consent_group_work_with_names', 'consent_whatsapp_contact', 'consent_whatsapp_photos',
  'consent_signal_photos', 'consent_whatsapp_parent_group', 'consent_insect_repellent', 'may_take_temperature',
  'may_apply_sunscreen', 'may_apply_plaster',
] as const

/** The former column of each built-in question. */
export const CONSENT_COLUMN_OF: Record<BuiltinConsentKey, typeof SAMPLE_CONSENT_COLUMNS[number]> = {
  artworkDisplay: 'consent_artwork_display', photosDisplay: 'consent_photos_display',
  photosForeignPortfolios: 'consent_photos_foreign_portfolios', photosInternalEvents: 'consent_photos_internal_events',
  photosNamesBirthdaysDisplay: 'consent_photos_names_birthdays_display', groupWorkWithNames: 'consent_group_work_with_names',
  whatsappContact: 'consent_whatsapp_contact', whatsappPhotos: 'consent_whatsapp_photos', signalPhotos: 'consent_signal_photos',
  whatsappParentGroup: 'consent_whatsapp_parent_group', mayTakeTemperature: 'may_take_temperature',
  mayApplySunscreen: 'may_apply_sunscreen', mayApplyPlaster: 'may_apply_plaster', insectRepellent: 'consent_insect_repellent',
}

/** 1 / 0 / null in a pattern that differs per child, so no column is all alike. */
const pattern = (child: number, column: number): 1 | 0 | null => [1, 0, null][(child * 5 + column * 7) % 3] as 1 | 0 | null

export function insertOverviewSample(sqlite: Database.Database): void {
  sqlite.exec(`
    INSERT INTO facilities (id, name) VALUES (2, 'Krippe Sonnenschein'), (3, 'Hort ohne Kinder');
    INSERT INTO groups (id, facility_id, name, sort_order) VALUES (101, 1, 'Bären', 0), (102, 1, 'Mäuse', 1), (201, 2, 'Krümel', 0);
  `)
  const children: [number, number, number | null, string, string, string, string][] = [
    // id, facility, group, last, first, address, allergies
    [11, 1, 101, 'Amsel', 'Mia', 'Hauptstr. 1\n12345 Musterstadt', 'Erdnüsse\nKiwi'],
    [12, 1, 101, 'Zebra', 'Ben', '', ''],
    [13, 1, 102, 'Biber', 'Cleo', 'Bahnhofstr. 7', ''],
    [14, 1, null, 'Dachs', 'Emil', '', 'Laktose'],
    [21, 2, 201, 'Krause', 'Lina', 'Am Bach 3', ''],
    [22, 2, null, 'Otter', 'Paul', '', ''],
  ]
  const insertChild = sqlite.prepare(`
    INSERT INTO children (id, facility_id, group_id, last_name, first_name, birth_date, entry_date, address, allergies,
      measles_proof, measles_proof_date, infection_briefing_date, created_at, ${SAMPLE_CONSENT_COLUMNS.join(', ')})
    VALUES (?, ?, ?, ?, ?, ?, '2025-09-01', ?, ?, ?, ?, ?, '2026-01-01T00:00:00.000Z', ${SAMPLE_CONSENT_COLUMNS.map(() => '?').join(', ')})
  `)
  const insertStart = sqlite.prepare(`
    INSERT INTO child_group_changes (child_id, group_id, from_date, applied_at, created_at)
    VALUES (?, ?, NULL, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z')
  `)
  children.forEach(([id, facility, group, last, first, address, allergies], index) => {
    const measles = pattern(index, 20)
    insertChild.run(
      id, facility, group, last, first, `202${index % 3}-0${index + 1}-15`, address, allergies,
      measles, measles === 1 ? '2024-03-12' : null, index % 2 === 0 ? '2026-09-01' : null,
      ...SAMPLE_CONSENT_COLUMNS.map((_, column) => pattern(index, column)),
    )
    insertStart.run(id, group)
  })
  // An archived and a planned child are not part of the overview.
  sqlite.exec(`
    INSERT INTO children (id, facility_id, last_name, first_name, birth_date, entry_date, left_on, created_at, consent_artwork_display)
      VALUES (15, 1, 'Gegangen', 'Gina', '2020-01-01', '2023-09-01', '2026-07-31', 'x', 1),
             (16, 1, 'Geplant', 'Gustav', '2025-01-01', '2027-01-01', NULL, 'x', 0);
  `)
  const insertContact = sqlite.prepare(`
    INSERT INTO child_contacts (child_id, sort_order, name, relation, phone_home, phone_mobile, phone_work, is_guardian,
      may_pick_up, contact_ban, emergency_rank, contact_ban_note, note)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'intern')
  `)
  const contacts: [number, string, string, string, string, string, number, number, number, number | null, string][] = [
    [11, 'Opa Otto', 'Opa', '', '0171 2', '', 0, 1, 0, 1, ''],
    [11, 'Max Amsel', 'Vater', '0711 1', '', '0711 9', 1, 1, 0, null, ''],
    [11, 'Anna Amsel', 'Mutter', '', '0170 1', '', 1, 1, 0, 1, ''],
    [11, 'Peter Fremd', '', '', '0160 5', '', 0, 0, 1, null, 'Beschluss Familiengericht'],
    [12, 'Erika Zebra', 'Oma', '0911 1', '', '', 0, 1, 0, 2, ''],
    [13, 'Nora Biber', 'Mutter', '', '0170 3', '', 1, 1, 0, null, ''],
    [13, 'Tim Biber', 'Vater', '', '', '0911 4', 1, 0, 1, null, 'nur mit Begleitung'],
    [13, 'Nachbarin Holz', 'Nachbar/in', '0911 7', '', '', 0, 1, 0, 3, ''],
    [21, 'Sara Krause', 'Mutter', '', '0151 1', '', 1, 1, 0, 1, ''],
  ]
  contacts.forEach((row, sortOrder) => insertContact.run(row[0], sortOrder, ...row.slice(1)))
  const insertMeeting = sqlite.prepare(`
    INSERT INTO child_parent_meetings (child_id, date, start, "end", kind, participants, note, created_at)
    VALUES (?, ?, ?, ?, ?, 'Mutter', 'vertraulich', 'x')
  `)
  insertMeeting.run(11, '2026-03-04', 600, 660, 'development')
  insertMeeting.run(11, '2026-09-01', 540, null, 'settling_in')
  insertMeeting.run(11, '2026-11-12', 900, 945, 'development')
  insertMeeting.run(13, '2026-10-19', 840, null, 'other')
  insertMeeting.run(21, '2025-12-01', 480, 510, 'development')
}
