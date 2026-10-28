# Authorization inventory (Stand 28.10.2026, worktree kinderakte, commit b0d15bf)

Status: complete (read-only research; no repo file changed).
Summary: 292 route files (290 guarded, 2 public); ≈45 service/lib/shared check sites; ≈40 client check sites; proposed catalog 56 keys (12 fest beim Träger + 3 recommended to stay fixed).

Roles (shared/types/api.ts:40): `provider` = Träger, `admin` = Leitung, `observer` = Mitarbeiter, `terminal` = Tablet.
"Manager" below = `isManager(role)` = provider | admin (shared/domain/roles.ts:4–9).

## 1. Guard helpers – server/utils/auth.ts

| Helper | Lines | Checks exactly | Returns |
|---|---|---|---|
| `requireUser(event, {allowPasswordChange?, allowTerminal?})` | 55–69 | session present; user re-loaded via `getActiveUser` (server/services/auth.ts:60–63: `active` and not `hasLeft` → left staff are locked out); `sessionExpired(role, loggedInAt)` (server/lib/session.ts; terminal never expires) → 401 `session_expired` (clears cookie); `mustChangePassword && !allowPasswordChange` → 403 `password_change_required`; `role==='terminal' && !allowTerminal` → 403 `forbidden`. **No role check otherwise, no facility check, no page-facility check.** | `SessionUser` |
| `requireFacility(event, user)` | 49–52 | `facilityId===null` → 403 `no_facility`; then `withRequestFacility` (36–43) = `assertPageFacility` (409 `facility_changed`, managers only, only if header `x-page-facility` sent) + `settingsFacilityOverride` (provider only: header `x-settings-facility` → that facility; 404 `facility_not_found`). Used as a *second* guard after `requireProvider` or `requireUser`. | facility id |
| `requireTerminal(event)` | 72–77 | `requireUser(allowTerminal)`; role `terminal` else 403 `forbidden`; facility else 403 `no_facility`. | `FacilityUser` |
| `requireAdmin(event, {activeFacility?})` | 83–92 | `requireUser` (terminal → 403); `isManager` else 403 `forbidden`; facility else 403 `no_facility`; `activeFacility:true` → only page check (no settings override; used only by `facilities.get.ts`); otherwise `withRequestFacility` (page check + **Träger settings-facility override**). | `FacilityUser` (facilityId may be overridden for the Träger) |
| `requireTemplateReader(event)` | 98–103 | `requireUser(allowTerminal)`; `templateReaderFacility` (server/services/printTemplates.ts:17–21): manager or terminal (observer → 403 `forbidden`), facility not null; page check (no override). The tablet needs **no unlock**. | user + facilityId |
| `childUnlockToken` / `storeChildUnlockToken` | 106–113 | session-secure storage of the tablet unlock token | – |
| `requireChildReader(event)` | 120–127 | `requireUser(allowTerminal)`; managers with facility → `withRequestFacility`; then `resolveChildViewer` (server/services/tabletUnlock.ts:143–156): **terminal** → `tabletChildViewer` (125–135: valid unlock row of this tablet+facility, lock time + grace, person still on the tablet list; else 403 `tablet_locked`; touches `lastActiveAt`) → `viewerFor` (33–54): rights of the unlocking employee's *active linked account of the home facility*; no account / helper from another facility → role `observer`, `id:null` (read-only, cannot pass `asActor`); `visibility` = tablet settings (waitlist / future contracts) unless manager; `groups` = {own, readable} for home staff with a group and without manager role, else null. **observer account** → 403 `children_tablet_only` (Mitarbeiter never see child data at the office). **manager** → viewer with `visibility:null, groups:null, onTablet:false`. | `ChildViewer` |
| `requireChildEditor(event)` | 130–132 | reader + `asChildEditor` (server/lib/childViewer.ts:39–42): `mayEditChildren` (roles.ts:12–14: manager, or observer with `canEditChildren`) and `id!==null`; else 403 `forbidden`. In practice: managers anywhere, flagged Mitarbeiter only at the unlocked tablet. | `ChildActor` |
| `requireChildManager(event)` | 135–137 | reader + `asChildManager` (childViewer.ts:45–48): `isManager(viewer.role)` and `id!==null`. At the tablet: a Leitung/Träger who unlocked it with their PIN. | `ChildActor` |
| `requireProvider(event)` | 140–144 | `requireUser`; `role==='provider'` else 403 `forbidden`. **No facility, no page check** (routes that need a facility add `requireFacility`). | `SessionUser` |

Supporting pieces:
- `assertPageFacility` – server/lib/pageFacility.ts:11–16; `settingsFacilityOverride` – 24–31; `requestFacility` – 37–43.
- Client side sends the headers from app/plugins/pageFacility.client.ts:46–47 (`settingsFacilityHeader`, app/utils/settingsFacility.ts:16).
- `rightsOf` (tablet unlock status DTO) – tabletUnlock.ts:67–75: `canEdit = mayEditChildren`, `isManager`, `canMoveFacility:false`, `showWaitlist`, `showFutureContracts`.
- `resolveFacilityId` – server/services/facilities.ts:44–56: admin/terminal = own column; provider = active selection (or first facility); observer = facility of the linked employee (null without employee).
- `server/plugins/sessionCheck.ts` – refreshes role/facility into the client session on `GET /api/_auth/session`; no authorization of its own.

## 2. Routes under server/api (292 files)

Totals: 290 guarded + 2 public (`health.get`, `auth/login.post`).
By primary guard: requireAdmin 164 · requireChildReader 39 · requireProvider 31 (8 of them + `requireFacility`) · requireUser 24 (5 with `allowTerminal` + `requireFacility`) · requireChildEditor 15 · requireChildManager 9 · requireTerminal 6 · requireTemplateReader 2.
The static test tests/api/permissions.test.ts (516 lines) asserts exactly this guard-per-file mapping by **grepping the source** for `requireX(` (lists USER_ROUTES, TERMINAL_ROUTES, PROVIDER_ROUTES, ADMIN_ROUTES, MEMBER_ROUTES, CHILD_FORM_ROUTES, CHILD_READER/EDITOR/MANAGER_ROUTES, TEMPLATE_READER_ROUTES, PUBLIC_ROUTES); tests/services/settingsFacilityGuards.test.ts covers the override.

Legend: **A** = requireAdmin, **P** = requireProvider, **P+F** = requireProvider + requireFacility, **U** = requireUser, **U(T)+F** = requireUser(allowTerminal) + requireFacility, **CR/CE/CM** = requireChildReader/Editor/Manager, **T** = requireTerminal, **TR** = requireTemplateReader. "svc:" = extra check in the service.

### 2.1 Dienstplan
| Route | Guard | Extra checks |
|---|---|---|
| GET plan/[year]/[month] | U(T)+F | svc plan.ts:244–270 `getMonthPlan`: manager → live draft + pending changes + warnings; everyone else (observer, **tablet**) → only the latest released snapshot, 403 `month_not_released` (247) |
| GET plan/[y]/[m]/notifications, POST …/release, POST …/revert, POST/DELETE plan/warning-acks | A | – |
| POST entries, PUT/DELETE entries/[id], PUT entries/[id]/group | A | – |
| PUT day-notes/[date] | A | – |
| week-templates (GET, POST, PUT/DELETE [id], POST [id]/apply) – 5 | A | – |
| shift-templates (POST, PUT, DELETE) – 3 | A | – |
| coverage-rules (POST, PUT, DELETE) – 3 | A | – |
| help-outs (GET candidates, POST, DELETE) – 3 | A | – |
| GET staffing/[y]/[m] (Personalschlüssel report) | A | – |
| GET staffing-settings | A | svc staffing.ts:111 `canEdit: role==='provider'` (UI flag) |
| PUT / DELETE staffing-settings | P+F | svc staffing.ts:116 `assertProvider` (double check) |
| GET settings (plan settings bundle) | A | – |
| GET pdf | U | renders a print page with the caller's cookie; that page's API calls do the checks (path regex only) |

### 2.2 Urlaub
| Route | Guard | Extra checks |
|---|---|---|
| GET leave (year overview) | A | **no planner check** – every Leitung sees it |
| GET leave-planning | A | svc `requirePlanner` (leaveRequests.ts:64–67): module on (403 `leave_requests_off`) and `isPlanner` (55–58: provider always; admin only if in `leave_planners` **and** `user.facilityId===facilityId`) else 403 `not_leave_planner` |
| POST leave-requests/[id]/decide | A | svc `requirePlanner` (286) + 403 `own_leave_request` (292) |
| PUT leave-settings/max | A | svc `requirePlanner` (166) |
| PUT leave-settings/module (switch module + choose planners) | P | svc 152–162: planners must be active managers |
| GET leave-settings | U | svc 131–146: `isPlanner`, `plannerIds` only for managers, badge count only for chosen planners (or provider while nobody is chosen) |
| PUT employees/[id]/leave/[year] (entitlement) | A | – |
| my/leave-requests (GET, POST, GET preview, POST [id]/withdraw) | U | svc `requireEnabled`; own employee only (403 `no_employee`, leaveRequests.ts:174/181) |
| GET my/leave | U | route: 403 `no_employee` |

### 2.3 Zeiterfassung
| Route | Guard | Extra checks |
|---|---|---|
| time-records (GET, POST, GET open, PUT notes, PUT/DELETE [id]) – 6 | A | – |
| GET balances, DELETE balance-adjustments/[id], POST employees/[id]/adjustments | A | – |
| PATCH employees/[id]/adjustments/[adjustmentId] (ausgezahlt) | A | svc employees.ts:286 `isManager` (redundant) |
| DELETE employee-hours/[id], POST employees/[id]/hours | A | – |
| PUT employees/[id]/stamping, PUT/DELETE employees/[id]/pin, POST …/pin/unlock | A | – |
| GET/PUT time-mark-settings, GET/PUT app-settings (time tracking start) | A | – |
| GET my/time | U | svc myTime.ts:15/21 own employee |
| POST my/time/stamp | U | route 403 `no_employee`; svc timeTracking.ts:95 `mayStampVia(employee.stampVia,'self')` → 403 `stamp_tablet_only` (per-employee setting, not a role) |
| GET terminal/status, POST terminal/stamp | T | PIN per employee (svc terminal.ts) |

### 2.4 Mitarbeiter
| Route | Guard | Extra checks |
|---|---|---|
| GET employees, GET employees/[id] | A | svc employees.ts:68–70 `mayViewContract`: provider always, admin only if global `contractVisibleToAdmins` (appSettings.ts:38) – contract fields stripped otherwise |
| GET level-ups | A | svc employees.ts:332–333 same `mayViewContract` (empty list otherwise) |
| POST employees, PUT employees/[id], POST employees/[id]/move | A | – |
| DELETE employees/[id] (left employee for good) | A | svc employeeDeletion.ts:70–79: `isManager`; `mayDeleteEmployeeByHand(retention.employeeDelete, role)` (shared/domain/retention.ts:59–63: mode off/provider/managers) → 403 `employee_delete_disabled`; own record 403; **a Träger's employee only by a Träger** (403 `employee_delete_provider`) |
| PUT employees/[id]/contract | P+F | – |
| PUT employees/[id]/facility (move to other facility) | P | any facility |
| PUT contract-visibility | P | global switch |
| requirement-types (GET, POST, PUT, DELETE), requirements/due, employees/[id]/requirements (GET, POST), employee-requirements/[id] DELETE, employees/[id]/trainings POST, employee-trainings/[id] PUT/DELETE | A | – |
| GET my/requirements | U | own employee (requirements.ts:245) |
| GET sick-days, early-sick-leaves (GET, PUT, DELETE) | A | – |
| PUT absence-codes/[id] | P | global codes |

### 2.5 Kinder (child records, tablet)
| Route | Guard | Extra checks (service) |
|---|---|---|
| GET children, children/[id], children/birthdays, /groups, /open, /overview, /planned, /reminders, /school-cutoff, /staff | CR | lists filtered by `seesGroup(viewer.groups)` (childRecord.ts:38) and `hiddenFromViewer(visibility)` (shared/domain/children.ts:28); archived child → 404 for non-managers (children.ts:179); `canEdit` in DTO = `mayEditChildren && !archived && groupRight==='write'` (children.ts:190); `purgeOn` only for managers (209); capacity only for managers (groups.ts:42–48); reminders: retention item only for provider off-tablet (reminders.ts:130) |
| GET children/archive, /occupancy, /school-children | CM | – |
| POST children (create) | CE | svc: `assertGroupRight(write)` for the chosen group (children.ts:289); school start by hand managers only (231, 403 `school_start_managers_only`); capacity warnings only for managers (capacityWarnings.ts:63) |
| PUT children/[id]/master, /health, /consents; POST /confirm, /contacts, /contacts/order, /documents, /meetings; PUT/DELETE child-contacts/[id], child-documents/[id], children/meetings/[id] | CE | `loadEditableChild` (childRecord.ts:50–62): archived → 409 (manager) / 404; hidden → 404; group right must be `write` (403 `group_read_only`); master: school start managers only; meetings: `note` field only for managers (parentMeetings.ts:30 read, 89 write) |
| POST children/[id]/leave, /unleave, /group-change; PUT/DELETE child-group-changes/[id] | CM | group-change: `assertGroupRight(write)` (childGroupChanges.ts:222/272; no-op for managers) |
| DELETE children/[id] | CM | svc children.ts:546–549: archived record only by provider (403 `archived_child_provider_only`) |
| PUT children/[id]/facility (move child to other facility) | P | any facility |
| GET child-documents/[id]/file, GET child-documents/overview | CR | confidential documents only for `mayEditChildren` (childDocuments.ts:39); archived → 404 for non-managers (87/131); group read right (89/133); download disposition differs on tablet (documentHttp.ts:55–57) |
| attendance/* (GET day, month, history; PUT day, absence, month-remark, stays/[id]; POST arrive, leave, announcements; DELETE stays/[id], announcements/[id]) – 12 | CR | **no edit flag needed**: any reader (incl. tablet persons without account) writes if `groupRight==='write'` on that day (childAttendance.ts:80–87, 476–477, 685); foreign group → 403 `group_read_only` / `absence_foreign_days` |
| group-book (GET week, history; PUT day, week) – 4 | CR | `writableGroup` (groupBook.ts:25–38): hidden → 404, read-only → 403 |
| POST children/[id]/development-docs, DELETE children/development-docs/[id] | CR | `loadEditableChild` (group write); undo: non-managers only same day (reminders.ts:194, 403 `undo_too_late`) |
| GET care-types, GET document-types | CR | (read for child pages; Träger settings override applies) |
| POST/PUT/DELETE care-types, document-types | A | – |
| GET/PUT attendance-settings | A | – |
| groups/[id] PUT capacity, color, documentation, group-type, opening-hours | A | – |
| PUT groups/[id]/read-access | A | svc groupReadAccess.ts:12 `readAccessFacility`: provider → group's own facility (**any facility**), admin → own facility |
| GET group-read-access, GET groups | A | – |
| PUT groups/[id], DELETE groups/[id], PUT groups/[id]/school-children | P | any facility (facilityOfGroup) |
| POST groups/[id]/move | P+F | – |
| GET child-retention, PUT child-retention | P | global retention years |
| meals (GET, POST, PUT/DELETE [id], DELETE versions/[id]) – 5 | A | – |

### 2.6 Bögen (child observation forms), Vorlagen, Mitarbeitergespräche
| Route | Guard | Extra checks |
|---|---|---|
| GET children/[id]/forms, POST children/[id]/forms | CR | svc childForms.ts:93/156 `canCreateChildForm` (shared/domain/childForms.ts:45–49): manager, or **key educator at the tablet** |
| GET/PUT/DELETE child-forms/[formId], GET/PUT child-forms/[formId]/editors | CR | right via `childFormRight` (shared/domain/childForms.ts:30–42): manager edit; at the tablet key educator or employee in `form_editors` edit; other readers read. Save needs `edit` (childForms.ts:202–204). Delete/editors: `canManageChildForms` = manager (childForms.ts:218–220). Archived child → 404 for non-managers (37) |
| form-templates (GET, POST, PUT/DELETE [id], POST [id]/copy) – 5 | A | – |
| print-templates GET index, GET [id]/file | TR | – (tablet without unlock) |
| print-templates POST, PUT/DELETE [id], PUT [id]/file | A | svc printTemplates.ts:32–33/40/91 `mayEdit`: global template (facilityId null) and scope `all` provider only |
| staff-talks (GET, POST, PUT/DELETE [id], POST [id]/forms, GET/PUT/DELETE forms/[formId], POST forms/[formId]/release, read-release, reopen, withdraw) – 12 | A | svc staffTalks.ts:52–75: never the manager's own talks (403 `staff_talk_own` / 404) |
| my/talks (GET, GET/PUT forms/[formId], POST …/submit) – 4 | U | own employee, released forms only (svc) |

### 2.7 Teamsitzungen
| Route | Guard | Extra checks |
|---|---|---|
| GET team-meetings, POST team-meetings, GET/PUT team-meetings/[id] | U(T)+F | svc `teamMember` (teamMeetings.ts:37–49): terminal / manager / observer with employee, else 403; `left` observers read-only (409 `employee_inactive`, 52–54; practically dead since left staff cannot log in) |
| POST team-meetings/[id]/release, /reopen, DELETE team-meetings/[id] | A | svc teamMeetings.ts:204 `member.manager` (redundant) |

### 2.8 Kasse
| Route | Guard | Extra checks |
|---|---|---|
| cash/boxes (GET, POST, PUT/DELETE [id], GET [id]/[y]/[m], POST [id]/close, GET [id]/csv, POST [id]/move), cash/entries (POST, PUT/DELETE [id], PUT/DELETE [id]/receipt), cash/transfers (POST, PUT/DELETE [id]), GET cash/purposes, GET cash/receipts/[id] – 19 | A | close: business rule `canClose` (shared/domain/cash.ts:104), no role |
| POST cash/boxes/[id]/reopen | P+F | svc cashClosing.ts:45 provider (redundant) |
| DELETE cash/boxes/[id]/purge | P+F | svc cashPurge.ts:25 provider (redundant) |

### 2.9 Kalender / Schließzeiten / Öffnungszeiten
| Route | Guard | Extra |
|---|---|---|
| GET calendar, calendar-events (POST, PUT, DELETE), closures (GET, POST, DELETE), early-closures (GET, POST, PUT, DELETE), GET/PUT opening-hours | A | – |
| GET my/calendar | U | own employee's facility (calendar.ts:66) |

### 2.10 Einstellungen
| Route | Guard | Extra |
|---|---|---|
| GET/PUT reminder-settings, tablet-settings, time-mark-settings, attendance-settings, app-settings, opening-hours | A | – |
| GET school-settings | A | – |
| PUT school-settings, GET school-settings/auto-leave-preview, PUT school-settings/auto-leave | P+F | – |
| GET retention-settings | A | – |
| PUT retention-settings | P+F | – |
| setup-checklist (GET, PUT/DELETE hidden/[key]) | A | svc setupChecklist.ts:18 `isManager`; 67 `isProvider` flag; 73 provider-only keys (`facility_capacity`, shared/domain/setupChecklist.ts:18) |

### 2.11 Benutzer (Zugänge)
| Route | Guard | Extra |
|---|---|---|
| GET users | A | svc users.ts:27–39 `visibleUsers`: all Träger + Leitung/Tablet of own facility + Mitarbeiter of own facility's employees |
| POST users, PUT users/[id], POST users/[id]/reset-password | A | svc users.ts:87–89 `assertMayManage`: only provider creates/changes/resets/appoints Träger accounts (403 `provider_only`); last provider / last manager protection (114–117); `canEditChildren` only kept for observer (125); employee link must be in actor's facility (59–69) |
| POST auth/password | U(allowPasswordChange) | own password |

### 2.12 Einrichtungen
| Route | Guard | Extra |
|---|---|---|
| GET facilities | A(activeFacility) | svc facilities.ts:60–66: provider sees all, Leitung only own |
| POST facilities | P | create (there is **no facility DELETE route**) |
| PUT facilities/[id], PUT facilities/[id]/capacity, GET/POST facilities/[id]/groups, GET facilities/[id]/group-read-access | P | capacity: svc facilities.ts:149 (redundant); any facility |
| PUT facilities/active | P | svc facilities.ts:164 (redundant) |

### 2.13 Löschfristen / Backup
| Route | Guard | Extra |
|---|---|---|
| GET retention, DELETE retention/items, POST retention/due | P | svc retentionOverview.ts:213 provider (redundant) |
| GET backup | P | – (no restore route; restore is offline) |
| (also provider-only deletions: cash purge, archived child delete, employee delete mode, see above) | | |

### 2.14 Tablet
| Route | Guard | Extra |
|---|---|---|
| GET terminal/status, POST terminal/stamp, POST terminal/children/unlock, /lock, /keep-alive, GET /status | T | unlock: employee must be on the tablet list + PIN (tabletUnlock.ts:90–111) |
| Tablet also passes: GET plan (released only), team-meetings (4 member routes), print-templates (2 TR), and every CR/CE/CM route with a valid unlock (rights of the unlocking person) | | |

### 2.15 Eigene Daten (my/*) and Auth
- my/* – 16 routes, all **U**, all scoped to `user.employeeId` in the service (no role check; a Leitung/Träger with an employee gets their own data too). `leave-settings.get` **U**.
- auth/login.post – public (terminal session without maxAge, line 13); health.get – public.
- Logout / session: nuxt-auth-utils built-in `/api/_auth/session` + server/plugins/sessionCheck.ts.

## 3. Service- and lib-level role checks (server/services, server/lib, shared/domain)

| File:line | Check | Gates |
|---|---|---|
| shared/domain/roles.ts:7–9 | `isManager` | base of every manager check |
| shared/domain/roles.ts:12–14 | `mayEditChildren` | child edit right (manager, or observer+flag) |
| server/lib/childViewer.ts:39–42 / 45–48 | `asChildEditor` / `asChildManager` | guards CE / CM |
| server/lib/childRecord.ts:29–36, 38–40 | `assertGroupRight`, `seesGroup` (via shared/domain/groupAccess.ts:11–14 `groupRight`) | group scope (own=write, readable=read, else none; `groups===null` → write everywhere) |
| server/lib/childRecord.ts:55–58 | archived: manager 409 vs. other 404; `hiddenFromViewer` | editable child |
| server/lib/pageFacility.ts:12, 27 | manager page check; provider settings override | facility selection |
| server/lib/session.ts:9 | terminal session never expires | session |
| server/lib/documentHttp.ts:55–57 | `onTablet` → inline only | document download |
| server/services/tabletUnlock.ts:40–50, 69–73, 144–154 | role of unlocking person, `isManager` → no group restriction/visibility; `children_tablet_only` | child viewer |
| server/services/auth.ts:32 | admin/observer with employee → hasLeft check | login lock for left staff |
| server/services/plan.ts:244–270 | `isManager` | draft vs. released plan, pending changes |
| server/services/plan.ts:306–339 | own employee | my plan |
| server/services/leaveRequests.ts:55–58, 64–67 | `isPlanner` (provider; admin ∈ leave_planners in own facility) | leave planning, decide, max |
| server/services/leaveRequests.ts:126, 134–143, 155 | planner lists, `plannerIds` for managers, badge | leave settings |
| server/services/leaveRequests.ts:292 | own request | decide |
| server/services/employees.ts:68–70, 137, 152, 333 | `mayViewContract` (provider / admin+global switch) | contract data, level-ups |
| server/services/employees.ts:286 | `isManager` | adjustment paid out |
| server/services/employees.ts:375 | moves admin/terminal accounts with the employee | facility move side effect |
| server/services/employeeDeletion.ts:70–79, 190–195 | manager; delete mode; own; provider's employee only by provider; provider account kept | employee hard delete |
| shared/domain/retention.ts:59–63 | `mayDeleteEmployeeByHand(mode, role)` | delete mode off/provider/managers (**a Träger setting that itself encodes a role choice**) |
| server/services/facilities.ts:46–55 | facility per role | `facilityId` resolution |
| server/services/facilities.ts:62 | provider sees all facilities | facility list |
| server/services/facilities.ts:149, 164 | provider | capacity, active facility |
| server/services/groupReadAccess.ts:12 | provider → any facility's group | read access |
| server/services/groups.ts:42–48 | manager → capacity shown | child group list |
| server/services/children.ts:179, 190, 209, 231, 546–549 | archived visible to managers; canEdit; purgeOn; school start; archived delete provider-only | child records |
| server/services/childDocuments.ts:39, 87, 131 | confidential → `mayEditChildren`; archived → managers | documents |
| server/services/childForms.ts:37, 52, 67, 83, 93, 156, 202–204, 218–220 + shared/domain/childForms.ts:30–54 | form rights (manager / tablet key educator / form_editors) | observation forms |
| server/services/parentMeetings.ts:30, 89 | manager | meeting note field |
| server/services/capacityWarnings.ts:63 | manager | capacity warnings |
| server/services/reminders.ts:65, 130, 150–155, 194 | group write; provider retention reminder off-tablet; undo any day for managers | reminders / development docs |
| server/services/childAttendance.ts:80–87, 274, 476–477, 656, 685 | group write per day | attendance |
| server/services/groupBook.ts:25–38, 61–62, 103 | group right | group book |
| server/services/printTemplates.ts:17–21, 32–33, 40, 75, 91 | template reader; global templates provider-only | print templates |
| server/services/setupChecklist.ts:18, 67, 73 | manager; provider flag; provider-only keys | setup checklist |
| server/services/staffing.ts:111, 116 | provider | staffing overrides |
| server/services/cashClosing.ts:45; cashPurge.ts:25 | provider | reopen month; purge box |
| server/services/retentionOverview.ts:213 | provider | retention deletion |
| server/services/teamMeetings.ts:37–49, 52–54, 110, 131, 204 | member kinds; manager | team meetings |
| server/services/staffTalks.ts:52–75 | not own talk | staff talks |
| server/services/users.ts:27–39, 56–58, 59–69, 87–89, 101, 113–127, 135–138 | visible users; provider-only for provider accounts; last provider/manager; canEditChildren only for observer | user management |
| server/services/timeTracking.ts:95 + shared/domain/stamping.ts:9–11 | per-employee stamp channel | self stamping |
| server/services/myTime.ts:15–21, calendar.ts:66, requirements.ts:245 | own employee | my/* |

Count: ~45 distinct service/lib/shared check sites (≈ 100 lines incl. DTO flags).

## 4. Client-side role checks (app/)

Routing / navigation:
| File:line | Check | Effect |
|---|---|---|
| app/middleware/auth.global.ts:9–23 | `role==='terminal'` | tablet: child pages only while unlocked (refreshUnlock), else only /terminal, /templates, /plan/*, /team-meetings*; leaving child pages locks |
| auth.global.ts:24 | mustChangePassword | → /account/password |
| auth.global.ts:27 | `role==='observer'` | child pages and /print/children/* → / |
| auth.global.ts:29 | `!isManager` | /admin/*, /cash*, /terminal, /templates → / (covers /admin/leave-planning, /admin/retention, /admin/settings …) |
| app/utils/navMenu.ts:47–49 | terminal | menu: Stempeln, Dienstplan, Teamsitzungen |
| navMenu.ts:56–57 | `isPlanner` (from GET leave-settings) | "Urlaubsplanung" entry + open-request count |
| navMenu.ts:59–95 | provider \| admin | full menu (Zeiten, Mitarbeiter, Kinder, Kasse, Kalender, Teamsitzungen; Mehr: Schließzeiten, Krankheitstage, Vorlagen, Bögen, Benutzer, Einstellungen); "Meins" only with employee (61) |
| navMenu.ts:89 | provider | Mehr → Löschfristen |
| navMenu.ts:97–106 | observer | Mein Dienstplan, Dienstplan, Kalender (my), Teamsitzungen only with employee; Meins: Urlaub, Termine, Gespräche |
| app/layouts/default.vue:20, 26, 47, 54–56, 61, 88, 113 | terminal / provider / isManager | signed-in chrome, facility switcher only for provider (113), facilities refresh for managers, nav viewer, tablet child mode |
| app/pages/index.vue:6–8 | role | start page: terminal → /terminal, observer → my plan, managers → plan |
| app/plugins/tabletLocked.client.ts:20 | terminal + 403 | back to tablet start |
| app/plugins/pageFacility.client.ts:46–47 | – | sends x-page-facility / x-settings-facility |
| app/composables/useMyNotifications.ts:9 | not terminal, has employee | notifications |
| app/composables/useUnsavedChanges.ts:42 | terminal locked | skip guard |
| app/composables/useFacilities.ts:35 | isManager | load facilities |

Child pages (rights from `useChildRights`, app/composables/useChildRights.ts:19–28: at the tablet the server's unlock `rights`; else **recomputed from the session role**: `canEdit: mayEditChildren`, `isManager`, `canMoveFacility: role==='provider'`):
| File:line | Uses | Effect |
|---|---|---|
| pages/children/index.vue:16–19, 30 | canEdit, isManager, show* | create button, tab set (utils/childrenAreas.ts:44–58: archive only managers, staffing only managers off-tablet, planned per switches) |
| pages/children/new.vue:7, 13 | canEdit | redirect |
| components/children/PlannedTab.vue:15–17 | canEdit, show* | create, visible lists |
| components/children/ChildMasterForm.vue:70, 78, 111, 168–169 | isManager, show* | status choice, reload, school start field |
| components/children/ChildLifecycleSection.vue:14–16, 77 | isManager, canMoveFacility | leave/unleave, move to facility (provider) |
| components/children/ChildMeetingsSection.vue:24 | isManager | meeting note |
| components/children/AttendanceTab.vue:34, OverviewTab.vue:11, WeekOverviewTab.vue:16 | isManager && !onTablet | print |
| components/children/ArchiveTab.vue:12, 53 | provider | "Sofort löschen" |
| composables/useChildLookups.ts:13 | canEdit | group picker |
| server DTO flags used by UI: child `canEdit`, form `right`/`canManage`/`canCreate`, group `right`, team meeting `canManage`, staffing `canEdit` (components/settings/StaffingSection.vue:22), print template `canEdit` |

Other pages/components:
| File:line | Check | Effect |
|---|---|---|
| pages/plan/[year]/[month].vue:21 | isManager | editor vs. read-only plan |
| pages/team-meetings/[id].vue:37 | not terminal | print |
| pages/templates.vue:15–17, 93, 176 | manager / provider / terminal | edit, "für alle Einrichtungen" scope only provider |
| pages/cash/[id]/[year]/[month].vue:16, 146 | provider | reopen month |
| pages/admin/employees/index.vue:24, 71, 135–137, 192, 204, 290, 319–321 | provider; `mayDeleteEmployeeByHand`; provider account | contract column, contract-visibility switch, delete button |
| pages/admin/employees/[id].vue:49, 206, 272, 409 | provider; `employeeTabs` (utils/staffList.ts:56: access + talks tabs only managers, talks not own) | move facility form, contract editable |
| components/employees/AccessSection.vue:15–26, 87–95 | provider; target role | provider accounts locked for Leitung; role list; `canEditChildren` checkbox only for observer |
| pages/admin/users.vue:16–19, 92, 138 | provider | role list incl. provider, locked rows, canEditChildren checkbox, "Rechte der Rollen" table (components/users/RightsTable.vue, static, 157 lines – the current rights matrix incl. 15 footnotes) only for provider |
| pages/admin/retention.vue:18–19, 136 | provider | page redirect |
| pages/admin/settings.vue:12, 34; settings/index.vue:7; settings/[area].vue:9; utils/settingsAreas.ts:35, 46, 58, 62, 94, 165 | provider | provider-only areas: facilities, retention, backup, leave-module; "Einstellungen für" facility choice |
| components/settings/CodesSection.vue:12–62 | provider | absence codes editable |
| components/settings/EmployeeRetentionSection.vue:15–55 | provider | retention periods/delete mode editable |
| components/settings/GroupListSection.vue:13–57, GroupNameSection.vue:10–47 | provider | group order / rename |
| components/settings/SchoolChildrenSection.vue:14–143 | provider | school settings editable |
| components/settings/LeaveModuleSection.vue:16, 42 | isManager candidates | planner choice |
| components/LevelUpNotice.vue:9, 31 | provider | action button |
| components/settings/SetupChecklist.vue (providerOnly items via DTO) | provider | items |

Count: ≈ 40 distinct client check sites (≈ 120 lines).

## 5. Per-person (and per-object) grants today

| Grant | Storage | Who sets it | Where checked |
|---|---|---|---|
| "darf Kinderakten pflegen" | `users.can_edit_children` (server/db/schema.ts:183) | **Leitung and Träger** via PUT users/[id] (users.ts:125: kept only for role observer) – UI pages/admin/users.vue:92, components/employees/AccessSection.vue:87 | `mayEditChildren` (roles.ts:12–14) → `asChildEditor`, children.ts:190 (canEdit DTO), childDocuments.ts:39 (confidential docs), tabletUnlock.ts:47/69, client useChildRights.ts:26. Effective only at the tablet (office observer → children_tablet_only). |
| Urlaubsplanung (Zuständige) | table `leave_planners(user_id PK)` (schema.ts:454) – **global**, not per facility | **only Träger** via PUT leave-settings/module (`setLeaveModule`, leaveRequests.ts:152–162: active managers only) | `isPlanner` (55–58: admin counts only in its own facility), `getLeaveSettings` (badge: chosen people; provider gets badge only if nobody chosen for the facility, 137–139), deleted with the employee (employeeDeletion.ts:194). For provider rows the grant is meaningless as a right (provider always plans) but **controls notifications**. |
| Bearbeiter eines Beobachtungsbogens | table `form_editors(form_id, employee_id, granted_at, granted_by)` (schema.ts:1071) – per form, per **employee** (not account) | Leitung/Träger via PUT child-forms/[formId]/editors (`setChildFormEditors`, childForms.ts:249–280, `assertManager`) | `childFormRight` (shared/domain/childForms.ts:40) – only at the tablet |
| Bezugserzieher | `children.key_educator_id` (schema.ts:570) – per child | whoever edits the child master data (CE) | `childFormRight` / `canCreateChildForm` (childForms.ts:39, 48) – only at the tablet |
| Gruppenrechte | own group = `employees.group_id`; readable groups = table `group_read_access(group_id, readable_group_id)` (schema.ts:830) – per group, facility-level | home group: employee editing (A); read access: PUT groups/[id]/read-access (A; provider in any facility) | `viewerFor` (tabletUnlock.ts:41, 52) → `ChildViewer.groups`; `groupRight` (shared/domain/groupAccess.ts:11–14) in childRecord.ts, children.ts, childAttendance.ts, groupBook.ts, reminders.ts, groups.ts, childGroupChanges.ts, childDocuments.ts, childForms.ts. Applies **only at the tablet, only to non-managers with a home group**; Springer / helpers / Leitung = all groups (write). |
| Tablet-Freischaltung | table `terminal_unlocks` (schema.ts:817) + session `secure.childUnlock` | any person on the tablet list (`terminalStatus`) with their PIN (POST terminal/children/unlock) | `tabletChildViewer` / `resolveChildViewer` |
| Tablet-Sichtbarkeit (Vormerkungen / künftige Verträge) | `facilities.tablet_show_waitlist`, `tablet_show_future_contracts` (schema.ts:44–46) – per facility | Leitung/Träger via PUT tablet-settings | `viewerFor` visibility → `hiddenFromViewer`; managers bypass |
| Stempeln über | `employees.stamp_via` 'both'\|'tablet' (schema.ts:125) – per employee | A via PUT employees/[id]/stamping | timeTracking.ts:95 (self stamp) |
| Vertragsangaben für die Leitung | app setting `contract_visible_to_admins` (appSettings.ts:35–40) – **global** | Träger via PUT contract-visibility | employees.ts:68–70 |
| Mitarbeiter endgültig löschen | `retention_settings.employee_delete` off\|provider\|managers (schema.ts:1153) – per facility | Träger via PUT retention-settings | `mayDeleteEmployeeByHand` (employeeDeletion.ts:71; client employees/index.vue:135) |
| Einstellungen für andere Einrichtung | request header `x-settings-facility` | Träger only (pageFacility.ts:27) | `requireAdmin`, `requireChildReader`, `requireFacility` |
| Aktive Einrichtung des Trägers | `users.facility_id` of the provider | PUT facilities/active (provider) | `resolveFacilityId` |
| Eigene Gespräche ausgeschlossen | `users.employee_id` = talk's employee | – | staffTalks.ts:52–75; client staffList.ts:56 |

## 6. Proposed permission catalog (56 keys; 12 fest beim Träger + 3 recommended fixed)

Conventions: **L** = Leitung (admin) default, **M** = Mitarbeiter (observer) default, **P-fix** = fest beim Träger (not grantable). "(T)" = today only effective at the unlocked tablet because the key `children.ownAccount` is missing. Scope: **G** = has scope own group / facility. Träger has everything. Tablet role stays fixed (not in catalog); at the tablet the catalog applies to the **unlocking person** (persons without account: Mitarbeiter defaults, no exceptions, no keys that need an account to record "changed by").

### Dienstplan
| Key | Label | Routes / checks | Today | requires / implies | G | P-fix |
|---|---|---|---|---|---|---|
| `plan.view` | Freigegebenen Dienstplan ansehen | GET plan (released branch), my/plan | L, M | – | – | – |
| `plan.edit` | Dienstplan-Entwurf ansehen und bearbeiten, Vorlagen, Aushilfen, Warnungen | GET plan draft branch (plan.ts:244–270), entries/*, day-notes, week-templates/*, help-outs/*, plan/warning-acks, plan/[y]/[m]/notifications, GET settings | L | requires plan.view | – | – |
| `plan.release` | Dienstplan freigeben und Änderungen verwerfen | release.post, revert.post | L | implies plan.edit | – | – |
| `plan.staffing` | Personalschlüssel ansehen | GET staffing/[y]/[m], GET staffing-settings, children staffing tab | L | – | – | – |

### Urlaub
| Key | Label | Routes | Today | req/impl | G | P-fix |
|---|---|---|---|---|---|---|
| `leave.request` | Urlaub beantragen, eigene Anträge | my/leave-requests/* (+ module on, + employee) | L, M | – | – | – |
| `leave.overview` | Urlaubsübersicht aller | GET leave | L | requires employees.view | – | – |
| `leave.plan` | Urlaubsplanung: entscheiden, Kalender, Höchstzahl | leave-planning.get, decide.post, leave-settings/max.put, `isPlanner` | per-person: Leitung ∈ leave_planners (migrate rows of admin accounts to + exceptions) | requires leave.overview | – | – |
| `leave.configure` | Modul ein/aus, Zuständige festlegen | leave-settings/module.put | – | – | – | **P-fix** (assigns a right; global) |

### Zeiterfassung
| Key | Label | Routes | Today | req/impl | G | P-fix |
|---|---|---|---|---|---|---|
| `time.own` | Eigene Zeiten sehen, mit dem Handy stempeln | my/time, my/time/stamp (+ stamp_via rule stays) | L, M (with employee) | – | – | – |
| `time.manage` | Alle Stempelzeiten ansehen, nachtragen, korrigieren; Stundenkonten | time-records/*, balances, balance-adjustments, employees/[id]/adjustments(+patch), employee-hours, employees/[id]/hours | L | requires employees.view (app/pages/admin/time.vue:22 loads /api/employees) | – | – |

### Mitarbeiter
| Key | Label | Routes | Today | req/impl | G | P-fix |
|---|---|---|---|---|---|---|
| `employees.view` | Mitarbeiter ansehen (Liste, Akte, fällige Pflichttermine) | GET employees, employees/[id], requirements/due, employees/[id]/requirements, requirement-types.get | L | – | – | – |
| `employees.edit` | Mitarbeiter anlegen und pflegen (Stunden, Urlaubsanspruch, PIN, Stempeln, Pflichttermine, Fortbildungen, Reihenfolge) | POST employees, PUT employees/[id], move, leave/[year], pin*, stamping, requirements.post, trainings.post, employee-requirements, employee-trainings | L | requires employees.view | – | – |
| `employees.sickness` | Krankheitstage, „im Dienst erkrankt“ | sick-days, early-sick-leaves/* | L | requires employees.view | – | – |
| `employees.contractView` | Vertragsangaben und Stufenaufstieg ansehen | employees.ts:68–70, level-ups | Leitung **iff** global `contract_visible_to_admins` → migrate switch into the Leitung role default (switch = role grant) | requires employees.view | – | – |
| `employees.contractEdit` | Vertragsangaben bearbeiten | employees/[id]/contract.put | – (provider) | requires contractView | – | – |
| `employees.delete` | Ausgeschiedene endgültig löschen | DELETE employees/[id] (+ delete mode, own record, Träger-employee rules stay as AND) | L | requires employees.edit | – | – |
| `employees.moveFacility` | Mitarbeiter in andere Einrichtung verschieben | employees/[id]/facility.put | – | – | – | **P-fix** (cross-facility) |

### Kinder
| Key | Label | Routes | Today | req/impl | G | P-fix |
|---|---|---|---|---|---|---|
| `children.view` | Kinderliste und Akten ansehen (inkl. Bögen lesen, Dokumente, Geburtstage, Erinnerungen) | all CR read routes; `resolveChildViewer` | L, M(T) | – | **G** (own group = write/read per groupRight; readable groups read) | – |
| `children.ownAccount` | Kinder mit dem eigenen Konto ansehen (nicht nur am Tablet) | `children_tablet_only` (tabletUnlock.ts:148), middleware :27, navMenu Kinder | L | requires children.view | – | – |
| `children.planned` | Vormerkungen und künftige Verträge immer sehen (unabhängig von den Tablet-Schaltern) | `visibility: null` (tabletUnlock.ts:49), hiddenFromViewer | L | requires children.view | – | – |
| `children.attendance` | Anwesenheit, Gruppenbuch, Doku „erledigt“ | attendance/*, group-book/*, development-docs (write paths) | L, M(T), persons without account | requires children.view | **G** (write own group only) | – |
| `children.edit` | Kinder anlegen und Akten ändern (inkl. vertrauliche Dokumente öffnen) | all CE routes, children.ts:190, childDocuments.ts:39 | L; M via `can_edit_children` (→ + exception) | requires children.view | **G** (write own group) | – |
| `children.manage` | Kinder abmelden, Archiv, Belegung, Gruppenwechsel, Schulkinder; Leitungsfelder (Einschulung von Hand, Gesprächsnotiz, Plätze, Erledigt zurücknehmen) | all CM routes; isManager in children.ts:179/209/231, childDocuments.ts:87/131, childForms.ts:37, parentMeetings.ts:30/89, capacityWarnings.ts:63, groups.ts:42, reminders.ts:155/194, childRecord.ts:56 | L | requires children.view, children.edit | – (facility) | – |
| `children.schoolSettings` | Stichtag, automatische Abmeldung, Gruppe „für Schulkinder“ | school-settings.put, auto-leave*, groups/[id]/school-children.put | – (provider) | requires settings.facility | – | – (but school-children.put is cross-facility → add facility check or P-fix) |
| `children.deleteArchived` | Archivierte Akten löschen | DELETE children/[id] archived branch (children.ts:546–549) | – | requires children.manage | – | **P-fix** (retention deletion) |
| `children.moveFacility` | Kind in andere Einrichtung verschieben | children/[id]/facility.put | – | – | – | **P-fix** (cross-facility) |

### Bögen / Vorlagen / Gespräche
| Key | Label | Routes | Today | req/impl | G | P-fix |
|---|---|---|---|---|---|---|
| `childForms.edit` | Alle Beobachtungsbögen anlegen und ausfüllen | childFormRight / canCreateChildForm manager branch | L (M only as key educator or form editor at the tablet – stays as per-object rule) | requires children.view | inherits children.view scope | – |
| `childForms.manage` | Bearbeiter freischalten, Bögen löschen | child-forms editors.put, DELETE child-forms | L | requires childForms.edit | – | – |
| `formTemplates.manage` | Vorlagen (Bögen) verwalten | form-templates/* | L | – | – | – |
| `printTemplates.view` | Druckvorlagen ansehen | print-templates GET (TR) | L (+ tablet fixed) | – | – | – |
| `printTemplates.edit` | Druckvorlagen der Einrichtung verwalten | print-templates POST/PUT/DELETE | L | requires printTemplates.view | – | – |
| `printTemplates.global` | Druckvorlagen für alle Einrichtungen | printTemplates.ts:32–33, 40 | – | requires printTemplates.edit | – | P-fix recommended (cross-facility) |
| `talks.manage` | Mitarbeitergespräche führen | staff-talks/* (never own: rule stays) | L | requires employees.view | – | – |
| `talks.own` | Eigene Gesprächsbögen | my/talks/* | L, M (with employee) | – | – | – |

### Teamsitzungen
| `teamMeetings.write` | Sitzungen anlegen und mitschreiben | team-meetings GET/POST, [id] GET/PUT | L, M (+ tablet fixed) | – | – | – |
|---|---|---|---|---|---|---|
| `teamMeetings.manage` | Protokoll freigeben, wieder öffnen, löschen | release, reopen, DELETE; teamMeetings.ts:204, canManage | L | implies teamMeetings.write | – | – |

### Kasse
| Key | Label | Routes | Today | req/impl | G | P-fix |
|---|---|---|---|---|---|---|
| `cash.view` | Kassen ansehen, Ausdruck, Excel | GET boxes, [id]/[y]/[m], csv, receipts, purposes | L | – | – | – |
| `cash.book` | Kasse führen (Kassen anlegen/archivieren, buchen, Belege) | boxes POST/PUT/DELETE/move, entries/*, transfers/* | L | requires cash.view | – (could get G for group cash boxes later) | – |
| `cash.close` | Monate abschließen | boxes/[id]/close.post | L | requires cash.view | – | – |
| `cash.reopen` | Abgeschlossenen Monat wieder öffnen | reopen.post, cashClosing.ts:45 | – (provider) | requires cash.close | – | – |
| `cash.purge` | Archivierte Kasse endgültig löschen | purge.delete, cashPurge.ts:25 | – | – | – | **P-fix** |

### Kalender / Schließzeiten
| `calendar.own` | Jahreskalender ansehen (eigene Sicht) | my/calendar | L, M | – | – | – |
|---|---|---|---|---|---|---|
| `calendar.edit` | Jahreskalender und Termine bearbeiten | GET calendar, calendar-events/* | L | – | – | – |
| `closures.manage` | Schließzeiten, frühere Schließungen, Öffnungszeiten | closures/*, early-closures/*, opening-hours, groups/[id]/opening-hours | L | – | – | – |

### Einstellungen
| Key | Label | Routes | Today | req/impl | G | P-fix |
|---|---|---|---|---|---|---|
| `settings.facility` | Einstellungen der Einrichtung | app-, attendance-, time-mark-, reminder-, tablet-settings; school-/retention-/staffing-settings GET; shift-templates, coverage-rules, requirement-types (write), care-types & document-types (write), meals/*, groups/[id] capacity/color/documentation/group-type/read-access, group-read-access, groups.get, setup-checklist/* | L | – | – | – |
| `settings.staffing` | Personalschlüssel-Werte ändern | staffing-settings PUT/DELETE, staffing.ts:111/116 | – (provider) | requires settings.facility | – | – |
| `settings.absenceCodes` | Codes (Urlaub, Krank …) ändern | absence-codes/[id].put | – | – | – | P-fix recommended (global for all facilities) |
| `settings.groups` | Gruppen anlegen, umbenennen, löschen, sortieren | facilities/[id]/groups POST, groups/[id] PUT/DELETE, groups/[id]/move | – | requires settings.facility | – | P-fix recommended (routes are cross-facility) |
| `settings.retention` | Löschfristen und „wer darf endgültig löschen“, Löschfrist Kinderakten | retention-settings.put, child-retention.get/put | – | – | – | **P-fix** |
| `settings.otherFacility` | Einstellungen anderer Einrichtungen („Einstellungen für“) | settingsFacilityOverride | – | – | – | **P-fix** |

### Benutzer
| `users.manage` | Zugänge Leitung/Mitarbeiter/Tablet verwalten (inkl. „darf Kinderakten pflegen“ – see risk 6) | users/* | L | – | – | – |
|---|---|---|---|---|---|---|
| `users.providerAccounts` | Träger-Zugänge anlegen/ändern | users.ts:87–89 | – | – | – | **P-fix** |
| `rights.manage` | Rechte und Rollen einstellen (incl. contract-visibility switch) | new; contract-visibility.put | – | – | – | **P-fix** |

### Einrichtungen / Löschfristen / Backup
| `facilities.manage` | Einrichtungen anlegen, umbenennen, Höchstzahl, wechseln | facilities.post, facilities/[id].put, capacity.put, active.put, facilities/[id]/group-read-access, setupChecklist provider keys | – | – | – | **P-fix** |
|---|---|---|---|---|---|---|
| `retention.delete` | Löschen nach Fristen | retention/* , reminders.ts:130 | – | – | – | **P-fix** |
| `backup.download` | Datensicherung | backup.get | – | – | – | **P-fix** |

Fixed, not in the catalog: everything of the tablet role (requireTerminal routes, plan/team meetings/templates access, unlock mechanics), `auth/password`, my/notifications, my/requirements, my/leave (own data bound to the employee link), `facilities.get` (own facility).

Defaults: **Leitung** = every non-fixed key except `employees.contractEdit`, `children.schoolSettings`, `cash.reopen`, `settings.staffing`, `settings.absenceCodes`, `settings.groups`, `printTemplates.global` (+ `employees.contractView` only if the switch is on; `leave.plan` only via exception). **Mitarbeiter** = `plan.view`, `leave.request`, `time.own`, `talks.own`, `teamMeetings.write`, `calendar.own`, `children.view` (G), `children.attendance` (G); `children.edit` (G) via exception from `can_edit_children`.

Not expressible as role/person keys (keep as rule next to the catalog):
1. Tablet-only effect (`children_tablet_only`) → modelled by the absence of `children.ownAccount`; children.* keys of a person without it only count when they unlocked the tablet.
2. Per-object grants: `form_editors` (per form/employee) and key educator → keep as they are (spec allows "bisherige Form").
3. Per-facility switches: tablet visibility (`tablet_show_*`) and `retention_settings.employee_delete` → keep as AND rules (rights are not per facility, spec §8).
4. Group scope details: "own" today = home group write + read-access groups read; **Springer / helpers / no group = all groups** (spec §3.4 says none) → Teil 1 must map "no group" to whole facility, or behaviour changes.
5. `leave_planners` for Träger accounts = notification recipient, not a right → keep table (or add non-right flag) for the badge logic.
6. Not-own rules (staff talk of oneself, own leave request, deleting own employee) stay as business rules.

## 7. Migration risks

1. **One guard, many meanings.** `requireAdmin` alone gates 164 routes across plan, time, employees, cash, settings, users, calendar; `requireChildReader` gates both reads and the attendance/group-book/forms writes (the write rules live in the services). Each route needs its own key; the existing test tests/api/permissions.test.ts only greps guard names, so it cannot prove identity once guards change – first generate a role × route expected-result matrix from today's guards (incl. tablet-unlocked-by-L/M/no-account) and assert it against the new checks.
2. **Implicit facility semantics.** `requireAdmin` silently applies the Träger's settings-facility override; provider-only routes without `requireFacility` act on **any facility** (facilities/[id]/*, groups/[id] PUT/DELETE/school-children, children/[id]/facility, employees/[id]/facility, read-access via groupReadAccess.ts:12 for provider). Giving such a key to Leitung would let it act cross-facility → keep them P-fix or add explicit facility checks. Global settings (absence codes, contract visibility, child retention years, leave module/leave_planners, global print templates) conflict with "rights only in the own facility".
3. **Tablet viewer is role-based.** ChildViewer carries `role` of the unlocker; ~25 `isManager(viewer.role)` / `mayEditChildren(viewer)` checks in child services and shared/domain/childForms.ts must switch to the unlocker's effective permissions (ChildViewer needs a permission set). Persons without account default to `observer`; group restriction only applies to non-managers with a home group (Springer = all groups) – collides with spec §3.4.
4. **Same-route, data-dependent answers** (no 403): GET plan (draft vs released), employees (contract fields), level-ups (empty), groups (capacity null), children (archived/purgeOn/canEdit), reminders, setup checklist, leave-settings (plannerIds/badge), staffing-settings (canEdit). These are easy to miss in a guard-level migration.
5. **Redundant service checks** keep role semantics even after the guard changes: cashClosing.ts:45, cashPurge.ts:25, facilities.ts:149/164, staffing.ts:116, retentionOverview.ts:213, setupChecklist.ts:18/73, employees.ts:286, employeeDeletion.ts:70/79, teamMeetings.ts:204, printTemplates.ts:18/40/91 – a granted key would still 403 here.
6. **Grants set by non-Träger.** Leitung toggles `can_edit_children` today (users PUT, AccessSection); spec says only the Träger sets rights → Teil 1 must keep Leitung's ability (e.g. allow `users.manage` to set exactly this exception) or behaviour changes.
7. **Switches that are really role grants**: `contract_visible_to_admins` (global) ≈ Leitung default of `employees.contractView`; `employee_delete` mode (per facility, includes "provider" level) overlaps `employees.delete`. Decide: migrate the switch into the role default (and keep the switch UI writing it) vs. keep it as an AND rule.
8. **Client recomputes rights from the role** (useChildRights.ts:26–28, middleware path prefixes `/admin`, `/cash`, `/templates`, navMenu, ~40 `role===`/`isManager` sites) → needs the effective permission set in the session (server/plugins/sessionCheck.ts refreshes the user per session fetch; permissions must be recomputed per request too so role changes stay immediate).
9. `leave_planners` double meaning (Leitung right + Träger notification) and `isPlanner`'s extra facility check.
10. Dead/legacy paths: team meeting `left` (left staff cannot log in since b6888d9), `requireAdmin({activeFacility})` only in facilities.get – keep or remove consciously so the matrix test stays exact.

