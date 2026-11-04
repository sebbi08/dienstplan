import { and, eq } from 'drizzle-orm'
import { beforeEach, describe, expect, it } from 'vitest'
import type { Db } from '../../server/db/client'
import { employees, formTemplates, teamMeetingParticipants } from '../../server/db/schema'
import { ServiceError } from '../../server/lib/errors'
import { deleteLeftEmployee } from '../../server/services/employeeDeletion'
import {
  createTeamMeeting, getTeamMeeting, listTeamMeetings, releaseTeamMeeting, reopenTeamMeeting, saveTeamMeeting,
  signTeamMeeting, teamMember, type TeamMember,
} from '../../server/services/teamMeetings'
import { setPin } from '../../server/services/terminal'
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
    // The client cannot send them again: saving the draft keeps them, after those chosen.
    save(id, [lea, berta])
    expect(signers(id)).toEqual([open(lea, 'Lea Leitung'), open(berta, 'Berta'), open(null, 'Anna')])
    save(id, [])
    expect(signers(id)).toEqual([open(null, 'Anna')])
    // Also after reopening released minutes.
    releaseTeamMeeting(db, leitung, id, LATER)
    reopenTeamMeeting(db, leitung, id, 'Nachtrag', LATER)
    save(id, [berta])
    expect(signers(id)).toEqual([open(berta, 'Berta'), open(null, 'Anna')])
  })
})

describe('signing team meeting minutes', () => {
  let db: Db
  let template: number
  let leitung: TeamMember
  let lea: number
  let anna: number
  let berta: number
  let annaMember: TeamMember
  let bertaMember: TeamMember
  let tablet: TeamMember

  const header: TeamMeetingHeader = { date: '2026-10-15', start: 840, groupId: null, participants: '', recorder: '', participantIds: [] }
  const draft = (participantIds: number[]) =>
    createTeamMeeting(db, leitung, { templateId: template, ...header, participantIds }, NOW)
  const released = (participantIds: number[]) => {
    const id = draft(participantIds)
    releaseTeamMeeting(db, leitung, id, NOW)
    return id
  }
  const sign = (member: TeamMember, id: number, input: { employeeId?: number; pin?: string } = {}) =>
    signTeamMeeting(db, member, id, input, NOW)
  const signers = (id: number) => getTeamMeeting(db, leitung, id, NOW).signers
  const leave = (employeeId: number, leftOn = '2026-10-19') =>
    db.update(employees).set({ leftOn }).where(eq(employees.id, employeeId)).run()
  const pinFailed = (employeeId: number) =>
    db.select({ pinFailed: employees.pinFailed }).from(employees).where(eq(employees.id, employeeId)).get()!.pinFailed
  const signed = (employeeId: number, name: string, signedVia: 'account' | 'tablet') =>
    ({ employeeId, name, signedAt: NOW.toISOString(), signedVia })

  beforeEach(() => {
    db = createTestDb()
    lea = addEmployee(db, 'Lea Leitung')
    leitung = teamMember(db, addUser(db, 'leitung', 'admin', lea))
    anna = addEmployee(db, 'Anna')
    annaMember = teamMember(db, addUser(db, 'anna', 'observer', anna))
    berta = addEmployee(db, 'Berta')
    bertaMember = teamMember(db, addUser(db, 'berta', 'observer', berta))
    tablet = teamMember(db, addUser(db, 'tablet-test', 'terminal'))
    template = db.select({ id: formTemplates.id }).from(formTemplates)
      .where(and(eq(formTemplates.facilityId, 1), eq(formTemplates.starterKey, 'team_meeting'))).get()!.id
  })

  it('signs with the own account after release', () => {
    const id = released([anna, berta])
    expect(listTeamMeetings(db, annaMember, { year: 2026 }, NOW).toSign).toEqual({ count: 1, firstId: id })
    const meeting = sign(annaMember, id)
    expect(meeting.signers).toEqual([signed(anna, 'Anna', 'account'), open(berta, 'Berta')])
    expect(meeting.mineOpen).toBe(false)
    expect(listTeamMeetings(db, annaMember, { year: 2026 }, NOW).toSign).toEqual({ count: 0, firstId: null })
    expect(getTeamMeeting(db, bertaMember, id, NOW).mineOpen).toBe(true)
  })

  it('refuses before release', () => {
    const id = draft([anna])
    expect(failure(() => sign(annaMember, id))).toBe('409 team_meeting_not_released')
    expect(signers(id)).toEqual([open(anna, 'Anna')])
  })

  it('refuses a non-participant', () => {
    const id = released([anna])
    expect(failure(() => sign(bertaMember, id))).toBe('403 team_meeting_not_participant')
    // A Träger without an employee is no participant either (and not the tablet: no signing for others).
    const provider = teamMember(db, addUser(db, 'traeger', 'provider'))
    setPin(db, 1, anna, '123456')
    expect(failure(() => sign(provider, id, { employeeId: anna, pin: '123456' }))).toBe('403 team_meeting_not_participant')
    expect(signers(id)).toEqual([open(anna, 'Anna')])
  })

  it('refuses twice', () => {
    const id = released([anna])
    sign(annaMember, id)
    expect(failure(() => sign(annaMember, id))).toBe('409 team_meeting_already_signed')
    setPin(db, 1, anna, '123456')
    expect(failure(() => sign(tablet, id, { employeeId: anna, pin: '654321' }))).toBe('409 team_meeting_already_signed')
    expect(pinFailed(anna)).toBe(0)
    expect(signers(id)).toEqual([signed(anna, 'Anna', 'account')])
  })

  it('refuses a participant who left', () => {
    const id = released([anna, berta])
    leave(anna)
    expect(failure(() => sign(annaMember, id))).toBe('409 employee_inactive')
    setPin(db, 1, berta, '123456')
    leave(berta)
    expect(failure(() => sign(tablet, id, { employeeId: berta, pin: '123456' }))).toBe('409 employee_inactive')
    expect(signers(id)).toEqual([open(anna, 'Anna'), open(berta, 'Berta')])
    // On the leaving day itself still possible.
    leave(anna, '2026-10-20')
    expect(sign(annaMember, id).signers[0]).toEqual(signed(anna, 'Anna', 'account'))
  })

  it('signs at the tablet with the person\'s PIN', () => {
    const id = released([anna, berta])
    setPin(db, 1, anna, '123456')
    expect(failure(() => sign(tablet, id, { employeeId: anna, pin: '654321' }))).toBe('401 pin_invalid')
    expect(pinFailed(anna)).toBe(1)
    expect(signers(id)).toEqual([open(anna, 'Anna'), open(berta, 'Berta')])
    const meeting = sign(tablet, id, { employeeId: anna, pin: '123456' })
    expect(meeting.signers).toEqual([signed(anna, 'Anna', 'tablet'), open(berta, 'Berta')])
    expect(pinFailed(anna)).toBe(0)
    // Without a PIN, the Leitung has to set one first.
    expect(failure(() => sign(tablet, id, { employeeId: berta, pin: '123456' }))).toBe('400 pin_missing')
    // Someone of another facility is looked at no further: no attempt is counted.
    const other = addFacility(db, 'Krippe')
    const bea = addEmployee(db, 'Bea', { facilityId: other })
    setPin(db, other, bea, '111111')
    expect(failure(() => sign(tablet, id, { employeeId: bea, pin: '000000' }))).toBe('404 employee_not_found')
    expect(pinFailed(bea)).toBe(0)
    expect(failure(() => sign(tablet, id, { employeeId: 999, pin: '000000' }))).toBe('404 employee_not_found')
    // Nor a person of the facility who is no participant.
    setPin(db, 1, lea, '222222')
    expect(failure(() => sign(tablet, id, { employeeId: lea, pin: '000000' }))).toBe('403 team_meeting_not_participant')
    expect(pinFailed(lea)).toBe(0)
    // The tablet needs both, the person and the PIN.
    expect(failure(() => sign(tablet, id))).toBe('400 team_meeting_sign_input_invalid')
    expect(failure(() => sign(tablet, id, { employeeId: berta }))).toBe('400 team_meeting_sign_input_invalid')
    expect(failure(() => sign(tablet, id, { pin: '123456' }))).toBe('400 team_meeting_sign_input_invalid')
    expect(signers(id)).toEqual([signed(anna, 'Anna', 'tablet'), open(berta, 'Berta')])
  })

  it('an account ignores employeeId and signs only for itself', () => {
    const id = released([lea, anna])
    setPin(db, 1, anna, '123456')
    const meeting = sign(leitung, id, { employeeId: anna, pin: '123456' })
    expect(meeting.signers).toEqual([signed(lea, 'Lea Leitung', 'account'), open(anna, 'Anna')])
  })

  it('reopening clears every signature', () => {
    const id = released([anna, berta, lea])
    sign(annaMember, id)
    setPin(db, 1, berta, '123456')
    sign(tablet, id, { employeeId: berta, pin: '123456' })
    const reopened = reopenTeamMeeting(db, leitung, id, 'Tippfehler', LATER)
    expect(reopened.signers).toEqual([open(anna, 'Anna'), open(berta, 'Berta'), open(lea, 'Lea Leitung')])
    releaseTeamMeeting(db, leitung, id, LATER)
    expect(getTeamMeeting(db, annaMember, id, LATER).mineOpen).toBe(true)
    expect(listTeamMeetings(db, bertaMember, { year: 2026 }, LATER).toSign).toEqual({ count: 1, firstId: id })
  })
})
