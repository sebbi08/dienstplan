import { and, eq } from 'drizzle-orm'
import { beforeEach, describe, expect, it } from 'vitest'
import type { Db } from '../../server/db/client'
import { forms, formTemplates, teamMeetings } from '../../server/db/schema'
import { ServiceError } from '../../server/lib/errors'
import { teamMeetingQuery } from '../../server/schemas'
import { createTemplate, updateTemplate } from '../../server/services/formTemplates'
import { deleteGroup } from '../../server/services/groups'
import {
  createTeamMeeting, deleteTeamMeeting, getTeamMeeting, listTeamMeetings, releaseTeamMeeting, reopenTeamMeeting,
  saveTeamMeeting, teamMember, type TeamMember,
} from '../../server/services/teamMeetings'
import type { SessionUser, TeamMeetingHeader } from '../../shared/types/api'
import { addEmployee, addFacility, addGroup, addUser, createTestDb } from '../helpers/fixtures'

const NOW = new Date('2026-10-20T08:00:00Z')
const LATER = new Date('2026-10-20T09:00:00Z')
const LATEST = new Date('2026-10-20T10:00:00Z')

/** "<status> <code>" of the ServiceError fn throws, or null if it does not throw. */
function failure(fn: () => unknown): string | null {
  try {
    fn()
    return null
  }
  catch (error) {
    if (error instanceof ServiceError) return `${error.statusCode} ${error.code}`
    throw error
  }
}

describe('team meetings', () => {
  let db: Db
  let facilityB: number
  let groupA: number
  let groupB: number
  let template: number
  let leitung: TeamMember
  let anna: TeamMember
  let tablet: TeamMember
  let staffB: TeamMember
  let tabletB: TeamMember
  let leitungUser: SessionUser

  const header: TeamMeetingHeader = { date: '2026-10-15', start: 840, groupId: null, participants: 'Anna, Berta', recorder: 'Anna' }
  /** The id of the first free text of the meeting (Tagesordnung in the starter). */
  const firstItem = (id: number) => getTeamMeeting(db, leitung, id).content.sections[0]!.items[0]!.id
  const save = (member: TeamMember, id: number, text: string, expectedUpdatedAt: string, now = LATER, more: Partial<TeamMeetingHeader> = {}) =>
    saveTeamMeeting(db, member, id, { ...header, ...more, answers: { [firstItem(id)]: text }, expectedUpdatedAt }, now)
  const create = (member: TeamMember, more: Partial<TeamMeetingHeader> = {}) =>
    createTeamMeeting(db, member, { templateId: template, ...header, ...more }, NOW)

  beforeEach(() => {
    db = createTestDb()
    facilityB = addFacility(db, 'Krippe')
    groupA = addGroup(db, 1, 'Bären')
    groupB = addGroup(db, facilityB, 'Füchse')
    leitungUser = addUser(db, 'leitung', 'admin', addEmployee(db, 'Lea Leitung'))
    leitung = teamMember(db, leitungUser)
    anna = teamMember(db, addUser(db, 'anna', 'observer', addEmployee(db, 'Anna')))
    tablet = teamMember(db, addUser(db, 'tablet-test', 'terminal'))
    staffB = teamMember(db, addUser(db, 'bea', 'observer', addEmployee(db, 'Bea', { facilityId: facilityB })))
    tabletB = teamMember(db, addUser(db, 'tablet-b', 'terminal', null, facilityB))
    template = db.select({ id: formTemplates.id }).from(formTemplates)
      .where(and(eq(formTemplates.facilityId, 1), eq(formTemplates.starterKey, 'team_meeting'))).get()!.id
  })

  it('resolves the members of a facility: managers, staff with an employee, the tablet as „Tablet“', () => {
    expect(leitung).toEqual({ facilityId: 1, name: 'Lea Leitung', manager: true, left: false })
    expect(anna).toEqual({ facilityId: 1, name: 'Anna', manager: false, left: false })
    expect(tablet).toEqual({ facilityId: 1, name: 'Tablet', manager: false, left: false })
    expect(staffB).toEqual({ facilityId: facilityB, name: 'Bea', manager: false, left: false })
    expect(tabletB.facilityId).toBe(facilityB)
    // A Mitarbeiter account without an employee has no facility.
    expect(failure(() => teamMember(db, addUser(db, 'ohne', 'observer')))).toBe('403 no_facility')
  })

  it('a Mitarbeiter whose employee has left still reads but no longer writes (409 employee_inactive)', () => {
    const id = create(anna)
    const loaded = getTeamMeeting(db, anna, id).updatedAt
    const user = addUser(db, 'carla', 'observer', addEmployee(db, 'Carla', { leftOn: '2026-10-19' }))
    const carla = teamMember(db, user, NOW)
    expect(carla).toMatchObject({ facilityId: 1, left: true })
    expect(getTeamMeeting(db, carla, id).id).toBe(id)
    expect(listTeamMeetings(db, carla, { year: 2026 }, NOW).meetings.map(meeting => meeting.id)).toEqual([id])
    expect(failure(() => create(carla))).toBe('409 employee_inactive')
    expect(failure(() => save(carla, id, 'x', loaded))).toBe('409 employee_inactive')
    // On the last day they still write.
    const dana = teamMember(db, addUser(db, 'dana', 'observer', addEmployee(db, 'Dana', { leftOn: '2026-10-20' })), NOW)
    expect(dana.left).toBe(false)
    expect(save(dana, id, 'x', loaded).updatedBy).toBe('Dana')
  })

  it('the list query reads an empty groupId as all, 0 as the whole facility', () => {
    expect(teamMeetingQuery.parse({ groupId: '' })).toEqual({})
    expect(teamMeetingQuery.parse({})).toEqual({})
    expect(teamMeetingQuery.parse({ groupId: '0', year: '2026' })).toEqual({ groupId: 0, year: 2026 })
    expect(teamMeetingQuery.parse({ groupId: '7' })).toEqual({ groupId: 7 })
    expect(() => teamMeetingQuery.parse({ groupId: '-1' })).toThrow()
  })

  it('staff write, the Leitung releases, the next save is refused, reopening lets them write again (Review Focus 1)', () => {
    const id = create(anna)
    const first = save(anna, id, 'Begrüßung', getTeamMeeting(db, anna, id).updatedAt)
    expect(first).toEqual({ updatedAt: LATER.toISOString(), updatedBy: 'Anna' })

    const released = releaseTeamMeeting(db, leitung, id, LATER)
    expect(released).toMatchObject({ state: 'released', releasedAt: LATER.toISOString(), releasedBy: 'Lea Leitung' })
    expect(failure(() => save(anna, id, 'Nachtrag', first.updatedAt, LATEST))).toBe('409 team_meeting_released')
    // The text stays readable for every member.
    const read = getTeamMeeting(db, anna, id)
    expect(read.answers[firstItem(id)]).toBe('Begrüßung')
    expect(read.state).toBe('released')
    expect(failure(() => releaseTeamMeeting(db, leitung, id, LATEST))).toBe('409 team_meeting_state_invalid')

    const reopened = reopenTeamMeeting(db, leitung, id, '  Nachtrag Termine  ', LATEST)
    expect(reopened).toMatchObject({
      state: 'draft', reopenReason: 'Nachtrag Termine', reopenedAt: LATEST.toISOString(), reopenedBy: 'Lea Leitung',
      releasedAt: null, releasedBy: null,
    })
    expect(save(anna, id, 'Nachtrag', first.updatedAt, LATEST).updatedBy).toBe('Anna')
    expect(getTeamMeeting(db, anna, id)).toMatchObject({ reopenReason: 'Nachtrag Termine', updatedBy: 'Anna' })
    expect(failure(() => reopenTeamMeeting(db, leitung, id, 'x', LATEST))).toBe('409 team_meeting_state_invalid')
  })

  it('a reopening needs a reason of 1–200 characters', () => {
    const id = create(leitung)
    releaseTeamMeeting(db, leitung, id, LATER)
    expect(failure(() => reopenTeamMeeting(db, leitung, id, '   ', LATEST))).toBe('400 team_meeting_reason_invalid')
    expect(failure(() => reopenTeamMeeting(db, leitung, id, 'x'.repeat(201), LATEST))).toBe('400 team_meeting_reason_invalid')
    expect(reopenTeamMeeting(db, leitung, id, 'x'.repeat(200), LATEST).state).toBe('draft')
  })

  it('staff and the tablet of another facility do not find the meeting (Review Focus 2)', () => {
    const id = create(leitung)
    for (const outsider of [staffB, tabletB]) {
      expect(failure(() => getTeamMeeting(db, outsider, id))).toBe('404 team_meeting_not_found')
      expect(failure(() => save(outsider, id, 'x', NOW.toISOString()))).toBe('404 team_meeting_not_found')
      expect(listTeamMeetings(db, outsider, { year: 2026 }, NOW).meetings).toEqual([])
    }
    const managerB = teamMember(db, addUser(db, 'leitung-b', 'admin', null, facilityB))
    expect(failure(() => releaseTeamMeeting(db, managerB, id))).toBe('404 team_meeting_not_found')
    expect(failure(() => deleteTeamMeeting(db, managerB, id))).toBe('404 team_meeting_not_found')
  })

  it('only Leitung and Träger release, reopen and delete (Review Focus 3)', () => {
    const id = create(anna)
    for (const member of [anna, tablet]) {
      expect(failure(() => releaseTeamMeeting(db, member, id))).toBe('403 forbidden')
      expect(failure(() => reopenTeamMeeting(db, member, id, 'Grund'))).toBe('403 forbidden')
      expect(failure(() => deleteTeamMeeting(db, member, id))).toBe('403 forbidden')
    }
    expect(listTeamMeetings(db, anna, { year: 2026 }, NOW).canManage).toBe(false)
    expect(getTeamMeeting(db, tablet, id).canManage).toBe(false)
    const provider = teamMember(db, addUser(db, 'traeger', 'provider'))
    expect(provider.manager).toBe(true)
    expect(listTeamMeetings(db, provider, { year: 2026 }, NOW).canManage).toBe(true)
    releaseTeamMeeting(db, provider, id, LATER)
    expect(reopenTeamMeeting(db, provider, id, 'Korrektur', LATEST).reopenedBy).toBe('traeger')
  })

  it('the second of two saves of the same draft gets 409 form_changed and writes nothing (Review Focus 4)', () => {
    const id = create(leitung)
    const loaded = getTeamMeeting(db, anna, id).updatedAt
    save(anna, id, 'von Anna', loaded, LATER)
    expect(failure(() => save(tablet, id, 'vom Tablet', loaded, LATEST, { recorder: 'Tablet' }))).toBe('409 form_changed')
    expect(getTeamMeeting(db, leitung, id)).toMatchObject({ recorder: 'Anna', updatedBy: 'Anna', updatedAt: LATER.toISOString() })
    expect(getTeamMeeting(db, leitung, id).answers[firstItem(id)]).toBe('von Anna')
  })

  it('the tablet creates a meeting and writes, both as „Tablet“ (Review Focus 5)', () => {
    const id = create(tablet)
    expect(getTeamMeeting(db, tablet, id)).toMatchObject({ createdBy: 'Tablet', updatedBy: 'Tablet', state: 'draft' })
    const saved = save(tablet, id, 'Am Tablet', getTeamMeeting(db, tablet, id).updatedAt)
    expect(saved.updatedBy).toBe('Tablet')
    expect(getTeamMeeting(db, leitung, id).answers[firstItem(id)]).toBe('Am Tablet')
  })

  it('makes the meeting from an active team template of the facility only', () => {
    const staffTemplate = db.select({ id: formTemplates.id }).from(formTemplates)
      .where(and(eq(formTemplates.facilityId, 1), eq(formTemplates.kind, 'staff'))).get()!.id
    const otherFacility = db.select({ id: formTemplates.id }).from(formTemplates)
      .where(and(eq(formTemplates.facilityId, facilityB), eq(formTemplates.kind, 'team'))).get()!.id
    const input = (templateId: number) => ({ templateId, ...header })
    expect(failure(() => createTeamMeeting(db, anna, input(staffTemplate), NOW))).toBe('404 form_template_not_found')
    expect(failure(() => createTeamMeeting(db, anna, input(otherFacility), NOW))).toBe('404 form_template_not_found')
    const own = createTemplate(db, leitungUser, 1, { kind: 'team', name: 'Gruppensitzung', selfAssessment: false }, NOW)
    updateTemplate(db, leitungUser, 1, own, { archived: true }, NOW)
    expect(failure(() => createTeamMeeting(db, anna, input(own), NOW))).toBe('409 form_template_archived')
    // The list offers only the active team templates.
    expect(listTeamMeetings(db, tablet, { year: 2026 }, NOW).templates).toEqual([{ id: template, name: 'Teamsitzung' }])

    // The meeting keeps its own copy: later template changes never reach it.
    const id = create(anna)
    const before = getTeamMeeting(db, anna, id)
    expect(before).toMatchObject({ title: 'Teamsitzung', templateId: template })
    updateTemplate(db, leitungUser, 1, template, { name: 'Neu', content: { sections: [] } }, LATER)
    expect(getTeamMeeting(db, anna, id).content).toEqual(before.content)
    expect(getTeamMeeting(db, anna, id).title).toBe('Teamsitzung')
  })

  it('a group must be one of the facility; deleting the group leaves the meeting to the facility', () => {
    expect(failure(() => create(anna, { groupId: groupB }))).toBe('404 group_not_found')
    const id = create(anna, { groupId: groupA })
    expect(getTeamMeeting(db, anna, id)).toMatchObject({ groupId: groupA, groupName: 'Bären' })
    const loaded = getTeamMeeting(db, anna, id).updatedAt
    expect(failure(() => save(anna, id, 'x', loaded, LATER, { groupId: groupB }))).toBe('404 group_not_found')
    deleteGroup(db, 1, groupA, '2026-10-20')
    expect(getTeamMeeting(db, anna, id)).toMatchObject({ groupId: null, groupName: null })
  })

  it('checks the header limits', () => {
    expect(failure(() => create(anna, { date: '2026-02-30' }))).toBe('400 team_meeting_date_invalid')
    expect(failure(() => create(anna, { start: 1440 }))).toBe('400 team_meeting_start_invalid')
    expect(failure(() => create(anna, { start: 1.5 }))).toBe('400 team_meeting_start_invalid')
    expect(failure(() => create(anna, { participants: 'x'.repeat(301) }))).toBe('400 team_meeting_participants_too_long')
    expect(failure(() => create(anna, { recorder: 'x'.repeat(81) }))).toBe('400 team_meeting_recorder_too_long')
    const id = create(anna, { participants: ` ${'x'.repeat(300)} `, recorder: ` ${'y'.repeat(80)} `, start: null })
    expect(getTeamMeeting(db, anna, id)).toMatchObject({ participants: 'x'.repeat(300), recorder: 'y'.repeat(80), start: null })
    // Answers are checked against the meeting's own content.
    const loaded = getTeamMeeting(db, anna, id).updatedAt
    expect(failure(() => saveTeamMeeting(db, anna, id, { ...header, answers: { nope: 'x' }, expectedUpdatedAt: loaded }, LATER)))
      .toBe('400 form_answer_invalid')
  })

  it('lists the year newest first, filtered by the whole facility or a group', () => {
    const a = create(anna, { date: '2026-03-01', start: 600 })
    const b = create(anna, { date: '2026-09-01', start: null, groupId: groupA })
    const c = create(anna, { date: '2026-09-01', start: 840 })
    create(anna, { date: '2025-12-31' })
    const ids = (filter: Parameters<typeof listTeamMeetings>[2]) => listTeamMeetings(db, anna, filter, NOW).meetings.map(m => m.id)
    expect(ids({})).toEqual([c, b, a])
    expect(ids({ year: 2026, group: 'facility' })).toEqual([c, a])
    expect(ids({ year: 2026, group: groupA })).toEqual([b])
    expect(ids({ year: 2025 })).toHaveLength(1)
    const list = listTeamMeetings(db, tablet, { year: 2026 }, NOW)
    expect(list.groups).toEqual([{ id: groupA, name: 'Bären' }])
    expect(list.meetings[1]).toMatchObject({ groupName: 'Bären', createdBy: 'Anna', state: 'draft' })
    // The meeting itself brings the groups for its header, so the page needs no list.
    expect(getTeamMeeting(db, tablet, a).groups).toEqual([{ id: groupA, name: 'Bären' }])
  })

  it('deleting a meeting deletes its form; deleting its form deletes the meeting', () => {
    const id = create(anna)
    const formId = db.select({ formId: teamMeetings.formId }).from(teamMeetings).where(eq(teamMeetings.id, id)).get()!.formId
    releaseTeamMeeting(db, leitung, id, LATER)
    deleteTeamMeeting(db, leitung, id)
    expect(db.select().from(teamMeetings).all()).toEqual([])
    expect(db.select().from(forms).where(eq(forms.id, formId)).all()).toEqual([])
    expect(failure(() => getTeamMeeting(db, anna, id))).toBe('404 team_meeting_not_found')
  })
})
