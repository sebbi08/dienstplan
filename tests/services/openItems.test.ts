import { beforeEach, describe, expect, it } from 'vitest'
import type { Db } from '../../server/db/client'
import { knowledgeCategories, leaveRequests, signRequestRecipients, signRequests } from '../../server/db/schema'
import { listTemplates } from '../../server/services/formTemplates'
import { createKnowledgeEntry } from '../../server/services/knowledge'
import { myOpenItems } from '../../server/services/openItems'
import { getEmployeeRequirements } from '../../server/services/requirements'
import { createTalk, listTalks, releaseTalkForm } from '../../server/services/staffTalks'
import type { SessionUser } from '../../shared/types/api'
import { addEmployee, addUser, createTestDb } from '../helpers/fixtures'

const TODAY = '2026-11-25'
const NOW = new Date('2026-11-25T09:00:00.000Z')

describe('„Offen für dich“ (myOpenItems)', () => {
  let db: Db
  let tina: number
  let ben: number
  let tinaAccount: SessionUser
  let leitung: SessionUser

  /** A request to sign for the employee (overdue with a due date before today). */
  const signFor = (employeeId: number, dueDate: string | null = null) => {
    const requestId = db.insert(signRequests).values({
      facilityId: 1, createdAt: NOW.toISOString(), title: 'Belehrung', sourceKind: 'template', fileSize: 1, fileSha256: 'x',
      targetFolder: 'correspondence', dueDate,
    }).returning({ id: signRequests.id }).get().id
    db.insert(signRequestRecipients).values({ requestId, employeeId }).run()
  }

  beforeEach(() => {
    db = createTestDb()
    leitung = addUser(db, 'leitung', 'admin', addEmployee(db, 'Lea Leitung'))
    tina = addEmployee(db, 'Tina Test')
    ben = addEmployee(db, 'Ben Beispiel')
    tinaAccount = addUser(db, 'tina', 'observer', tina)
  })

  it('counts only the person\'s own open items, each as the owning service does', () => {
    const before = myOpenItems(db, tinaAccount, TODAY)
    // Starter links ask for no confirmation; a new entry that does counts once.
    const category = db.select().from(knowledgeCategories).all().find(row => row.facilityId === 1 && row.parentId === null)!.id
    createKnowledgeEntry(db, { ...leitung, facilityId: 1 }, {
      kind: 'link', title: 'Hygieneplan', description: '', asOf: '', url: 'https://www.example.de', body: '', needsConfirmation: true, categoryId: category,
    }, null, NOW)
    signFor(tina, '2026-11-01')
    signFor(tina)
    signFor(ben)
    // A self-assessment released to Tina (the assessment form stays the Leitung's).
    const staff = listTemplates(db, 1, 'staff')
    const templateIds = [staff.find(template => template.starterKey === 'staff_self_assessment')!.id]
    const scope = { facilityId: 1, ownEmployeeId: null }
    const talk = createTalk(db, leitung, scope, { employeeId: tina, templateIds, date: '2026-12-01', start: 600, participants: '', period: '' }, NOW)
    releaseTalkForm(db, scope, listTalks(db, scope, tina).find(item => item.id === talk)!.forms[0]!.id, NOW)
    // Leave decisions: within the last 14 days counts, older ones and open ones do not; Ben's never.
    const leave = (employeeId: number, status: 'open' | 'approved' | 'rejected', decidedAt: string | null) => db.insert(leaveRequests)
      .values({ employeeId, startDate: '2026-12-20', endDate: '2026-12-22', status, createdAt: NOW.toISOString(), decidedAt }).run()
    leave(tina, 'approved', '2026-11-20T10:00:00.000Z')
    leave(tina, 'rejected', '2026-11-11T10:00:00.000Z')
    leave(tina, 'approved', '2026-11-01T10:00:00.000Z')
    leave(tina, 'open', null)
    leave(ben, 'approved', '2026-11-24T10:00:00.000Z')

    const items = myOpenItems(db, tinaAccount, TODAY)
    const requirements = getEmployeeRequirements(db, 1, tina, TODAY).kinds.filter(kind => kind.state === 'overdue' || kind.state === 'missing').length
    expect(items).toEqual({
      knowledge: before.knowledge + 1, sign: 2, signOverdue: 1, selfAssessments: 1, leaveDecisions: 2, leaveNotice: false, requirements,
    })
    expect(requirements).toBeGreaterThan(0)
  })

  it('has nothing open for an account without a linked employee', () => {
    const traeger = addUser(db, 'traeger', 'provider')
    expect(myOpenItems(db, traeger, TODAY)).toEqual({
      knowledge: 0, sign: 0, signOverdue: 0, selfAssessments: 0, leaveDecisions: 0, leaveNotice: false, requirements: 0,
    })
  })
})
