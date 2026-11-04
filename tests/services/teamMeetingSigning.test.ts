import { and, eq } from 'drizzle-orm'
import { beforeEach, describe, expect, it } from 'vitest'
import type { Db } from '../../server/db/client'
import { employees, formTemplates, teamMeetingParticipants } from '../../server/db/schema'
import { ServiceError } from '../../server/lib/errors'
import { deleteLeftEmployee } from '../../server/services/employeeDeletion'
import {
  createTeamMeeting, getTeamMeeting, listTeamMeetings, releaseTeamMeeting, saveTeamMeeting, teamMember, type TeamMember,
} from '../../server/services/teamMeetings'
import type { SessionUser, TeamMeetingHeader } from '../../shared/types/api'
import { addEmployee, addFacility, addUser, createTestDb } from '../helpers/fixtures'

const NOW = new Date('2026-10-20T08:00:00Z')
const LATER = new Date('2026-10-20T09:00:00Z')

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

const open = (employeeId: number | null, name: string) => ({ employeeId, name, signedAt: null, signedVia: null })

describe('team meeting participants', () => {
  let db: Db
  let template: number
  let leitungUser: SessionUser
  let leitung: TeamMember
  let lea: number
  let anna: number
  let berta: number
  let annaMember: TeamMember
  let tablet: TeamMember

  const header: TeamMeetingHeader = {
    date: '2026-10-15', start: 840, groupId: null, participants: 'Frau Weber (Fachberatung)', recorder: 'Anna', participantIds: [],
  }
  const create = (participantIds: number[], more: Partial<TeamMeetingHeader> = {}, now = NOW) =>
    createTeamMeeting(db, leitung, { templateId: template, ...header, ...more, participantIds }, now)
  const save = (id: number, participantIds: number[], now = LATER) => saveTeamMeeting(db, leitung, id, {
    ...header, participantIds, answers: {}, expectedUpdatedAt: getTeamMeeting(db, leitung, id, now).updatedAt,
  }, now)
  const signers = (id: number) => getTeamMeeting(db, leitung, id, LATER).signers
  const leave = (employeeId: number, leftOn = '2026-10-19') =>
    db.update(employees).set({ leftOn }).where(eq(employees.id, employeeId)).run()

  beforeEach(() => {
    db = createTestDb()
    lea = addEmployee(db, 'Lea Leitung')
    leitungUser = addUser(db, 'leitung', 'admin', lea)
    leitung = teamMember(db, leitungUser)
    anna = addEmployee(db, 'Anna')
    annaMember = teamMember(db, addUser(db, 'anna', 'observer', anna))
    berta = addEmployee(db, 'Berta')
    addUser(db, 'berta', 'observer', berta)
    tablet = teamMember(db, addUser(db, 'tablet-test', 'terminal'))
    template = db.select({ id: formTemplates.id }).from(formTemplates)
      .where(and(eq(formTemplates.facilityId, 1), eq(formTemplates.starterKey, 'team_meeting'))).get()!.id
  })

  it('knows the employee of each member (none for the tablet)', () => {
    expect(leitung.employeeId).toBe(lea)
    expect(annaMember.employeeId).toBe(anna)
    expect(tablet.employeeId).toBeNull()
    expect(teamMember(db, addUser(db, 'traeger', 'provider')).employeeId).toBeNull()
  })

  it('stores the chosen participants with their names, in order', () => {
    const id = create([berta, anna, berta])
    expect(signers(id)).toEqual([open(berta, 'Berta'), open(anna, 'Anna')])
    expect(getTeamMeeting(db, leitung, id, LATER).participants).toBe('Frau Weber (Fachberatung)')
    expect(listTeamMeetings(db, leitung, { year: 2026 }, LATER).meetings[0]!.signers).toEqual([open(berta, 'Berta'), open(anna, 'Anna')])
    // Without any chosen, the meeting has no signers.
    expect(signers(create([]))).toEqual([])
  })

  it('replaces the participants on save, keeping the stored name of those who stay', () => {
    const id = create([berta, anna])
    db.update(employees).set({ name: 'Anna Neu' }).where(eq(employees.id, anna)).run()
    save(id, [anna])
    expect(signers(id)).toEqual([open(anna, 'Anna')])
    expect(db.select().from(teamMeetingParticipants).where(eq(teamMeetingParticipants.employeeId, berta)).all()).toEqual([])
    // A new one gets the current name, the order follows the list.
    save(id, [lea, anna])
    expect(signers(id)).toEqual([open(lea, 'Lea Leitung'), open(anna, 'Anna')])
  })

  it('writes no participants when the meeting was released in between', () => {
    const id = create([anna])
    const loaded = getTeamMeeting(db, leitung, id, NOW).updatedAt
    releaseTeamMeeting(db, leitung, id, LATER)
    expect(failure(() => saveTeamMeeting(db, leitung, id, { ...header, participantIds: [berta], answers: {}, expectedUpdatedAt: loaded }, LATER)))
      .toBe('409 team_meeting_released')
    expect(signers(id)).toEqual([open(anna, 'Anna')])
  })

  it('refuses an employee of another facility', () => {
    const other = addEmployee(db, 'Bea', { facilityId: addFacility(db, 'Krippe') })
    expect(failure(() => create([anna, other]))).toBe('404 employee_not_found')
    expect(failure(() => create([999]))).toBe('404 employee_not_found')
    const id = create([anna])
    expect(failure(() => save(id, [other]))).toBe('404 employee_not_found')
    expect(signers(id)).toEqual([open(anna, 'Anna')])
  })

  it('refuses a left employee unless already chosen', () => {
    const carla = addEmployee(db, 'Carla', { leftOn: '2026-10-19' })
    expect(failure(() => create([carla]))).toBe('409 employee_inactive')
    // On the leaving day itself still choosable.
    const dana = addEmployee(db, 'Dana', { leftOn: '2026-10-20' })
    const id = create([anna, berta, dana])
    leave(berta)
    expect(failure(() => save(id, [anna, berta, carla]))).toBe('409 employee_inactive')
    save(id, [anna, berta])
    expect(signers(id)).toEqual([open(anna, 'Anna'), open(berta, 'Berta')])
  })

  it('lists the choosable staff', () => {
    const carla = addEmployee(db, 'Carla')
    addEmployee(db, 'Bea', { facilityId: addFacility(db, 'Krippe') })
    addEmployee(db, 'Emil', { leftOn: '2026-01-31' })
    const id = create([carla])
    leave(carla)
    const staff = [{ id: lea, name: 'Lea Leitung', shortName: 'Le' }, { id: anna, name: 'Anna', shortName: 'An' }, { id: berta, name: 'Berta', shortName: 'Be' }]
    expect(listTeamMeetings(db, tablet, { year: 2026 }, LATER).staff).toEqual(staff)
    // The meeting adds those already chosen, in the staff list's order.
    expect(getTeamMeeting(db, tablet, id, LATER).staff).toEqual([...staff, { id: carla, name: 'Carla', shortName: 'Ca' }])
    expect(getTeamMeeting(db, tablet, create([]), LATER).staff).toEqual(staff)
  })

  it('counts the released minutes the member still has to sign, in every year', () => {
    const older = create([anna, berta], { date: '2025-11-03' })
    const newer = create([anna], { date: '2026-10-01' })
    const draft = create([anna], { date: '2026-09-01' })
    create([berta], { date: '2026-08-01' })
    for (const id of [older, newer]) releaseTeamMeeting(db, leitung, id, LATER)
    releaseTeamMeeting(db, leitung, create([], { date: '2024-01-01' }), LATER)

    const list = listTeamMeetings(db, annaMember, { year: 2026 }, LATER)
    expect(list.toSign).toEqual({ count: 2, firstId: older })
    expect(list.meetings.map(meeting => [meeting.id, meeting.mineOpen])).toEqual([[newer, true], [draft, false], [expect.any(Number), false]])
    expect(getTeamMeeting(db, annaMember, older, LATER).mineOpen).toBe(true)
    expect(getTeamMeeting(db, leitung, older, LATER).mineOpen).toBe(false)
    expect(listTeamMeetings(db, leitung, { year: 2026 }, LATER).toSign).toEqual({ count: 0, firstId: null })
    // Nothing personal at the tablet or for a member without employee.
    expect(listTeamMeetings(db, tablet, { year: 2025 }, LATER).toSign).toEqual({ count: 0, firstId: null })
    expect(listTeamMeetings(db, tablet, { year: 2025 }, LATER).meetings[0]!.mineOpen).toBe(false)
    const provider = teamMember(db, addUser(db, 'traeger', 'provider'))
    expect(listTeamMeetings(db, provider, { year: 2026 }, LATER).toSign).toEqual({ count: 0, firstId: null })
  })

  it('keeps the name when the employee is deleted for good', () => {
    const id = create([anna, berta])
    leave(anna)
    deleteLeftEmployee(db, leitungUser, 1, anna, 'Anna', '2026-10-20')
    expect(signers(id)).toEqual([open(null, 'Anna'), open(berta, 'Berta')])
  })
})
