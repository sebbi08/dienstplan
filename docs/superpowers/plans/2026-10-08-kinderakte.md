# Kinderakte (Gruppenbuch Stufe 1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Per-facility child records (master data, contacts, health, consents, documents) with a list, birthdays, document overview, archive and automatic deletion, plus per-account permission to maintain records.

**Architecture:** New facility-scoped tables (`children`, `child_contacts`, `child_documents` with the file as BLOB, `document_types`, `care_types`) and a user flag `can_edit_children`. Two new guards (`requireChildReader`, `requireChildEditor`) sit beside `requireAdmin`/`requireProvider`; services follow the `fn(db, facilityId, …)` convention and answer other facilities' rows with 404. A daily purge in the database plugin deletes children whose retention has expired.

**Tech Stack:** Nuxt 4, Nitro/h3 (`readMultipartFormData`), nuxt-auth-utils, drizzle-orm + better-sqlite3, drizzle-kit, zod, vitest, Nuxt UI 4.

**Spec:** [docs/superpowers/specs/2026-10-08-kinderakte-design.md](../specs/2026-10-08-kinderakte-design.md)

## Global Constraints

- UI German, informal "du" like `app/locales/de.ts`; code, identifiers, comments, commits English.
- No Docker or CI changes.
- Worktree: `node_modules` is a junction to the main checkout; never run `npm install` here.
- Roles on main: `provider` (Träger), `admin` (Leitung), `observer` (Mitarbeiter), `terminal` (Stempel-Tablet). The tablet never gets child data.
- Every new route is classified in `tests/api/permissions.test.ts` and calls exactly the guard of its class (`requireChildReader(`, `requireChildEditor(`, `requireAdmin(`, `requireProvider(`).
- Rows of another facility, archived children for non-managers and confidential documents without the right answer 404 with the object's `*_not_found` code, never 403.
- Documents: PDF, JPEG, PNG only, detected by file signature; at most 10 MB = 10 * 1024 * 1024 bytes.
- Retention: whole years 1–10, default 3, one setting for all facilities, Träger only; purge date = `left_on` + years.
- Birthdays tab: next 8 weeks. A 29 February birthday falls on 28 February in non-leap years.
- Default document types for every facility (name / important / required / confidential): Betreuungsvertrag ja/ja/ja; Masernnachweis ja/ja/nein; Belehrung Infektionsschutz ja/ja/nein; Datenschutz-Einwilligung ja/ja/nein; Sorgerechtsbeschluss ja/nein/ja; Ärztliches Attest nein/nein/ja; Sonstiges nein/nein/nein.
- Tests: `npx vitest run <file>`; all: `npm test`; types: `npm run typecheck`.

## Review Focus

1. **A child with neither entry date nor planned entry date** is "planned" (not active, not missing from every list). Pinned in Task 1.
2. **A renamed file** (e.g. an iPhone HEIC or a Word file saved as `x.pdf`) is rejected with `document_type_invalid` and nothing is stored. Pinned in Task 5.
3. **An ordinary Mitarbeiter opening an archived child or a confidential document by URL** gets 404, and the overview shows the confidential cell without a link. Pinned in Tasks 4 and 5.
4. **A Mitarbeiter whose permission is withdrawn** cannot save the next change (guard reads the flag fresh). Pinned in Task 2.
5. **A birthday on 29 February** shows up on 28 February in non-leap years with the right new age. Pinned in Task 1.

---

### Task 1: Data model, migration, domain helpers, fixtures

**Files:**
- Modify: `server/db/schema.ts`; Create: `server/db/migrations/0023_child_records.sql` (via generate, then edit) + meta
- Modify: `server/db/seed.ts` (`DEFAULT_DOCUMENT_TYPES`), `server/services/facilities.ts` (`createFacility` inserts them)
- Create: `shared/domain/children.ts`; Modify: `shared/types/api.ts`
- Modify: `tests/helpers/fixtures.ts`
- Test: `tests/domain/children.test.ts`, `tests/services/childSchema.test.ts`

**Interfaces:**
- Produces:
  - Tables (all with `facility_id` via the existing `facilityId()` helper where listed):
    - `care_types`: id, facility_id, name, start (int minutes), end, sort_order
    - `document_types`: id, facility_id, name, important (bool), required (bool), confidential_default (bool), sort_order
    - `children`: id, facility_id, group_id (FK groups, ON DELETE SET NULL, nullable), care_type_id (FK care_types, nullable), last_name, first_name, birth_date, address (default ''), entry_date, planned_entry_date, info_meeting_date, school_start_date (nullable ISO), primary_school, note (default ''), left_on (nullable); health: measles_proof (nullable bool), measles_proof_date, infection_briefing_date, allergies (default ''), may_take_temperature, may_apply_sunscreen, may_apply_plaster (nullable bool); consents (nullable bool) `consent_artwork_display`, `consent_photos_display`, `consent_photos_foreign_portfolios`, `consent_photos_internal_events`, `consent_photos_whatsapp`, `consent_photos_names_birthdays_display`, `consent_group_work_with_names`, `consent_whatsapp_contact`, `consent_whatsapp_photos`, `consent_whatsapp_parent_group`; stamps `master_updated_at/_by`, `contacts_updated_at/_by`, `health_updated_at/_by`, `consents_updated_at/_by` (by = FK users ON DELETE SET NULL); created_at
    - `child_contacts`: id, child_id (FK cascade), sort_order, name, relation (default ''), phone_home, phone_mobile, phone_work (default ''), is_guardian, may_pick_up, contact_ban (bools), emergency_rank (nullable int), contact_ban_note, note (default '')
    - `child_documents`: id, child_id (FK cascade), document_type_id (FK document_types), title (default ''), document_date, confidential (bool), mime_type, size (int), data (blob, mode buffer), uploaded_by (FK users SET NULL), uploaded_at
    - `users.can_edit_children` boolean not null default false
  - Migration ends with one `INSERT INTO document_types … SELECT f.id, … FROM facilities f` per default type (Global Constraints values, sort_order 0–6).
  - `DEFAULT_DOCUMENT_TYPES` (seed.ts) used by `createFacility` for new facilities.
  - `shared/domain/children.ts`:
    - `type ChildStatus = 'planned' | 'active' | 'archived'`
    - `childStatus(child: { entryDate: IsoDate | null; leftOn: IsoDate | null }, today: IsoDate): ChildStatus` — archived if `leftOn !== null && today > leftOn`; else active if `entryDate !== null && entryDate <= today`; else planned
    - `purgeDate(leftOn: IsoDate, years: number): IsoDate`
    - `ageOn(birthDate: IsoDate, date: IsoDate): { years: number; months: number }`
    - `nextBirthday(birthDate: IsoDate, today: IsoDate): { date: IsoDate; turns: number }` — today counts as next; 29 Feb → 28 Feb in non-leap years
  - `shared/types/api.ts`: `CONSENT_KEYS` (the ten camelCase keys matching the columns: `artworkDisplay`, `photosDisplay`, `photosForeignPortfolios`, `photosInternalEvents`, `photosWhatsapp`, `photosNamesBirthdaysDisplay`, `groupWorkWithNames`, `whatsappContact`, `whatsappPhotos`, `whatsappParentGroup`), `ConsentKey`, `type TriState = boolean | null`
  - Fixtures: `addChild(db, facilityId, overrides?: Partial<{ lastName; firstName; birthDate; entryDate; plannedEntryDate; leftOn; groupId; careTypeId; allergies }>): number` (defaults: 'Muster', 'Kind', '2022-03-15', entry '2025-09-01'); `documentTypeId(db, facilityId, name): number`

- [ ] **Step 1: Write failing domain tests** `tests/domain/children.test.ts`

```ts
expect(childStatus({ entryDate: null, leftOn: null }, '2026-10-08')).toBe('planned')
expect(childStatus({ entryDate: '2026-11-01', leftOn: null }, '2026-10-08')).toBe('planned')
expect(childStatus({ entryDate: '2026-10-08', leftOn: null }, '2026-10-08')).toBe('active')
expect(childStatus({ entryDate: '2024-09-01', leftOn: '2026-10-08' }, '2026-10-08')).toBe('active')
expect(childStatus({ entryDate: '2024-09-01', leftOn: '2026-10-07' }, '2026-10-08')).toBe('archived')
expect(purgeDate('2026-07-31', 3)).toBe('2029-07-31')
expect(ageOn('2022-03-15', '2026-10-08')).toEqual({ years: 4, months: 6 })
expect(nextBirthday('2022-10-08', '2026-10-08')).toEqual({ date: '2026-10-08', turns: 4 })
expect(nextBirthday('2022-03-15', '2026-10-08')).toEqual({ date: '2027-03-15', turns: 5 })
expect(nextBirthday('2020-02-29', '2027-01-10')).toEqual({ date: '2027-02-28', turns: 7 })
expect(nextBirthday('2020-02-29', '2027-12-01')).toEqual({ date: '2028-02-29', turns: 8 })
```

- [ ] **Step 2: Write failing schema test** `tests/services/childSchema.test.ts`: `createTestDb()` → facility 1 has the 7 default types with the exact flags; `addFacility(db, 'Kita 2')` → also 7; `addChild` returns an id; deleting the child cascades its contacts and documents (insert one of each raw).
- [ ] **Step 3: Run** `npx vitest run tests/domain/children.test.ts tests/services/childSchema.test.ts` — Expected: FAIL
- [ ] **Step 4: Implement** schema, `npx drizzle-kit generate --name child_records`, append the INSERTs to the SQL, seed constant, `createFacility`, domain helpers, types, fixtures
- [ ] **Step 5: Run** both files, then `npm test` and `npm run typecheck` — Expected: PASS / no errors
- [ ] **Step 6: Commit** `feat: child records data model`

---

### Task 2: Permission to maintain records, guards

**Files:**
- Modify: `shared/domain/roles.ts`, `shared/types/api.ts` (`SessionUser.canEditChildren`, `UserDto.canEditChildren`, `UserUpdate`), `server/services/auth.ts` (`toSessionUser`), `server/services/users.ts`, `server/schemas.ts` (user update schema), `server/utils/auth.ts`
- Modify: `tests/api/permissions.test.ts` (new lists, still empty of routes)
- Test: `tests/domain/roles.test.ts` (create if missing), `tests/services/users.test.ts`

**Interfaces:**
- Consumes: Task 1 column `users.can_edit_children`
- Produces:
  - `SessionUser.canEditChildren: boolean` — the stored flag as is; whether someone may edit is always decided by `mayEditChildren`
  - `mayEditChildren(user: Pick<SessionUser, 'role' | 'canEditChildren'>): boolean` in `shared/domain/roles.ts` — managers always, observers with the flag, terminal never
  - `UserUpdate.canEditChildren: boolean`, `UserDto.canEditChildren: boolean`; `updateUser` stores it only for role `observer` (any other role stores false); `createUser` stores false
  - Guards in `server/utils/auth.ts`, both returning `FacilityUser`:
    - `requireChildReader(event)` — `requireUser(event)` (tablet rejected), then `requireFacility(event, user)`; observers without employee → 403 `no_facility`
    - `requireChildEditor(event)` — `requireChildReader` + `mayEditChildren(user)` else 403 `forbidden`
  - `tests/api/permissions.test.ts`: `CHILD_READER_ROUTES` (must contain `requireChildReader(`) and `CHILD_EDITOR_ROUTES` (must contain `requireChildEditor(`); the "finds the API routes" test checks them too. Later tasks append their routes.

- [ ] **Step 1: Write failing tests**
  - roles: `mayEditChildren` → provider true, admin true, observer false, observer with flag true, terminal with flag false.
  - users: Leitung sets `canEditChildren: true` on a Mitarbeiter → `listUsers` shows it and `getActiveUser(...).canEditChildren` is true; setting it on an admin/terminal account stores false; changing the account to role admin clears it; after setting it back to false, `mayEditChildren(getActiveUser(db, id)!)` is false.
- [ ] **Step 2: Run** `npx vitest run tests/domain/roles.test.ts tests/services/users.test.ts` — Expected: FAIL
- [ ] **Step 3: Implement** the above
- [ ] **Step 4: Run** `npm test` and `npm run typecheck` — Expected: PASS / no errors
- [ ] **Step 5: Commit** `feat: permission to maintain child records`

---

### Task 3: Care types and document types

**Files:**
- Create: `server/services/careTypes.ts`, `server/services/documentTypes.ts`
- Create routes: `server/api/care-types/index.get.ts`, `index.post.ts`, `[id].put.ts`, `[id].delete.ts`; `server/api/document-types/index.get.ts`, `index.post.ts`, `[id].put.ts`, `[id].delete.ts`
- Modify: `server/schemas.ts`, `shared/types/api.ts`, `tests/api/permissions.test.ts`
- Test: `tests/services/careTypes.test.ts`, `tests/services/documentTypes.test.ts`

**Interfaces:**
- Consumes: Task 1 tables, Task 2 guards
- Produces:
  - `CareTypeDto { id; name; start: Minutes; end: Minutes; sortOrder }`, `CareTypeInput { name; start; end; sortOrder }`
  - `listCareTypes(db, facilityId)`, `createCareType(db, facilityId, input)`, `updateCareType(db, facilityId, id, input)`, `deleteCareType(db, facilityId, id)`, `assertCareType(db, facilityId, id: number | null): void`
  - Errors: 400 `care_type_name_required`, 409 `care_type_name_taken` (case-insensitive like groups, `toLocaleLowerCase('de')`), 400 `invalid_time` (not 5-minute grid or end ≤ start), 404 `care_type_not_found`, 409 `care_type_in_use`
  - `DocumentTypeDto { id; name; important; required; confidentialDefault; sortOrder }`, `DocumentTypeInput` (same without id)
  - `listDocumentTypes(db, facilityId)`, `createDocumentType`, `updateDocumentType`, `deleteDocumentType`, `assertDocumentType(db, facilityId, id): DocumentTypeDto`
  - Errors: 400 `document_type_name_required`, 409 `document_type_name_taken`, 404 `document_type_not_found`, 409 `document_type_in_use`; `required` is stored only together with `important` (required && !important → 400 `required_needs_important`)
  - Routes: GET lists → `requireChildReader`; POST/PUT/DELETE → `requireAdmin`

- [ ] **Step 1: Write failing tests** for both services: create/list order; duplicate name (different case) → taken; invalid times; delete in use (care type on a child via `addChild`, document type with a raw document row) → in_use; other facility's id on update/delete/assert → not_found; `required_needs_important`.
- [ ] **Step 2: Run** the two files — Expected: FAIL
- [ ] **Step 3: Implement** services, zod schemas, routes, permission lists
- [ ] **Step 4: Run** `npm test` and `npm run typecheck` — Expected: PASS / no errors
- [ ] **Step 5: Commit** `feat: care types and document types per facility`

---

### Task 4: Children list, record, contacts, birthdays

**Files:**
- Create: `server/services/children.ts`, `server/services/childContacts.ts`
- Create routes: `server/api/children/index.get.ts` (`?status=active|planned`), `index.post.ts`, `birthdays.get.ts`, `[id].get.ts`, `[id]/master.put.ts`, `[id]/health.put.ts`, `[id]/consents.put.ts`, `[id]/contacts.post.ts`, `[id]/contacts/order.post.ts`; `server/api/child-contacts/[id].put.ts`, `[id].delete.ts`
- Modify: `server/schemas.ts`, `shared/types/api.ts`, `tests/api/permissions.test.ts`
- Test: `tests/services/children.test.ts`, `tests/services/childContacts.test.ts`

**Interfaces:**
- Consumes: Tasks 1–3 (`childStatus`, `ageOn`, `nextBirthday`, `assertCareType`, `assertGroup` from `server/services/groups.ts`, `mayEditChildren`)
- Produces:
  - DTOs: `ChildMasterInput { lastName; firstName; birthDate; address; groupId: number | null; careTypeId: number | null; entryDate; plannedEntryDate; infoMeetingDate; schoolStartDate: IsoDate | null; primarySchool; note }`; `ChildHealthInput { measlesProof: TriState; measlesProofDate: IsoDate | null; infectionBriefingDate: IsoDate | null; allergies: string; mayTakeTemperature: TriState; mayApplySunscreen: TriState; mayApplyPlaster: TriState }`; `ChildConsents = Record<ConsentKey, TriState>`; `ChildContactInput { name; relation; phoneHome; phoneMobile; phoneWork; isGuardian; mayPickUp; emergencyRank: number | null; contactBan: boolean; contactBanNote; note }`, `ChildContactDto = ChildContactInput & { id }`; `SectionStamp { updatedAt: string | null; updatedBy: string | null }`; `ChildListItemDto { id; lastName; firstName; birthDate; age: { years; months }; groupId; careTypeName: string | null; entryDate; plannedEntryDate; hasAllergies: boolean; contactBans: { name: string; note: string }[] }`; `ChildRecordDto { id; status: ChildStatus; master: ChildMasterInput; health: ChildHealthInput; consents: ChildConsents; contacts: ChildContactDto[]; stamps: Record<'master' | 'contacts' | 'health' | 'consents', SectionStamp>; leftOn: IsoDate | null; purgeOn: IsoDate | null; canEdit: boolean; documents: [] }` (Task 5 fills `documents`; Task 6 fills `purgeOn` — until then null); `BirthdayDto { childId; name; birthDate; groupId; date: IsoDate; turns: number }`
  - `listChildren(db, facilityId, status: 'active' | 'planned', today): ChildListItemDto[]` — active: sorted by group sort order (null group last), then last/first name; planned: sorted by `entryDate ?? plannedEntryDate` (no date last), then name
  - `getChild(db, viewer: FacilityUser, id, today): ChildRecordDto` — archived → 404 `child_not_found` unless `isManager(viewer.role)`; `canEdit` = `mayEditChildren(viewer) && status !== 'archived'`
  - `createChild(db, actor, facilityId, input: ChildMasterInput, now?): number`; `updateChildMaster(db, actor, facilityId, id, input, today, now?)`, `updateChildHealth(...)`, `updateChildConsents(...)` — archived → 409 `child_archived`; each sets its section stamp
  - Validation: 400 `name_required` (last or first name blank), 400 `birth_date_in_future`, group via `assertGroup`, care type via `assertCareType`, dates valid ISO (`invalid_date`)
  - `listBirthdays(db, facilityId, today): BirthdayDto[]` — active children, sorted by `date`
  - Contacts (`childContacts.ts`): `addContact(db, actor, facilityId, childId, input, today, now?): number` (appended), `updateContact(db, actor, facilityId, contactId, input, today, now?)`, `deleteContact(...)`, `reorderContacts(db, actor, facilityId, childId, ids: number[], today, now?)` (ids must be exactly the child's contacts → 400 `invalid_order`); 400 `contact_name_required`; 400 `contact_ban_conflict` when `contactBan` and (`mayPickUp` or `emergencyRank !== null`); 400 `contact_ban_note_required` when banned with blank note; 404 `contact_not_found`; archived child → 409 `child_archived`; each change sets the contacts stamp
  - Routes: GETs and `birthdays.get.ts` → `requireChildReader`; all writes → `requireChildEditor`; routes pass `todayIso()`

- [ ] **Step 1: Write failing tests**
  - children: list active vs planned (incl. Review Focus 1 child without dates in planned); order by group then name; facility 2 child not in facility 1 list and `getChild` → `child_not_found`; observer viewer on archived child → `child_not_found`, admin viewer sees it with `canEdit: false`; updates on archived → `child_archived`; stamps carry the actor's username; `birth_date_in_future`; foreign group/care type → their not_found codes; birthdays sorted and limited to active children.
  - contacts: add/update/delete/reorder; `contact_ban_conflict` for ban + may pick up and for ban + emergency rank; note required; foreign contact id → `contact_not_found`; list item shows `contactBans` and `hasAllergies`.
- [ ] **Step 2: Run** both files — Expected: FAIL
- [ ] **Step 3: Implement** services, zod schemas (`childMasterSchema`, `childHealthSchema`, `childConsentsSchema`, `childContactSchema`, `contactOrderSchema`), routes, permission lists
- [ ] **Step 4: Run** `npm test` and `npm run typecheck` — Expected: PASS / no errors
- [ ] **Step 5: Commit** `feat: child records with contacts, health, consents and birthdays`

---

### Task 5: Documents and document overview

**Files:**
- Create: `server/lib/fileSignature.ts`, `server/services/childDocuments.ts`
- Create routes: `server/api/children/[id]/documents.post.ts` (multipart), `server/api/child-documents/[id]/file.get.ts` (`?download=1`), `server/api/child-documents/[id].put.ts`, `[id].delete.ts`, `server/api/child-documents/overview.get.ts`
- Modify: `server/services/children.ts` (`getChild` fills `documents`), `server/schemas.ts`, `shared/types/api.ts`, `tests/api/permissions.test.ts`
- Test: `tests/services/fileSignature.test.ts`, `tests/services/childDocuments.test.ts`

**Interfaces:**
- Consumes: Tasks 1–4 (`assertDocumentType`, `mayEditChildren`, `childStatus`)
- Produces:
  - `MAX_DOCUMENT_BYTES = 10 * 1024 * 1024`; `detectDocumentMime(bytes: Uint8Array): 'application/pdf' | 'image/jpeg' | 'image/png' | null` (PDF `%PDF-`; JPEG `FF D8 FF`; PNG `89 50 4E 47 0D 0A 1A 0A`)
  - `ChildDocumentDto { id; typeId; typeName; title; documentDate; confidential; mimeType; size; uploadedBy: string | null; uploadedAt; canOpen: boolean }`; `ChildDocumentMeta { typeId; title; documentDate: IsoDate; confidential: boolean }`
  - `uploadDocument(db, actor, facilityId, childId, meta, file: { data: Buffer; filename: string }, today, now?): number` — 413 `document_too_large`, 400 `document_type_invalid`, archived → 409 `child_archived`; stored `mime_type` is the detected one
  - `listDocuments(db, viewer, facilityId, childId): ChildDocumentDto[]` (never selects `data`; newest `documentDate` first); `canOpen` = `!confidential || mayEditChildren(viewer)`
  - `readDocumentFile(db, viewer, facilityId, id): { data: Buffer; mimeType: string; fileName: string }` — not visible (other facility, archived child for non-manager, confidential without right) → 404 `document_not_found`; `fileName` = `<type>-<lastName>-<date>.<ext>` sanitized to `[A-Za-z0-9.-]`
  - `updateDocument(db, actor, facilityId, id, meta, today)`, `deleteDocument(db, actor, facilityId, id, today)`
  - `DocumentOverviewDto { types: DocumentTypeDto[] /* important only, in order */; rows: { childId; name; groupId: number | null; cells: Record<number, { documentId: number; documentDate: IsoDate; canOpen: boolean } | null>; missingRequired: boolean }[] }` from `documentOverview(db, viewer, facilityId, today)` — active children; newest document per type
  - File route: headers `Content-Type` (stored mime), `Content-Disposition` (`inline` or `attachment` with `?download=1`, filename), `X-Content-Type-Options: nosniff`, `Cache-Control: no-store`
  - Upload route: multipart fields `file`, `typeId`, `title`, `documentDate`, `confidential` (`'true'|'false'`); reject before parsing when `content-length` > `MAX_DOCUMENT_BYTES + 64 * 1024` with 413 `document_too_large`
  - Routes: file, overview → `requireChildReader`; upload, put, delete → `requireChildEditor`

- [ ] **Step 1: Write failing tests**
  - signature: the three signatures detected; `%PDX`, empty, a ZIP header (`50 4B 03 04`, e.g. docx renamed to `.pdf`) → null.
  - documents: upload stores bytes and returns them identically from `readDocumentFile`; 10 MB + 1 byte → `document_too_large`; Review Focus 2 (`x.pdf` with ZIP bytes) → `document_type_invalid` and no row; confidential document: ordinary observer → `canOpen: false` in list and `readDocumentFile` → `document_not_found`, freigeschalteter observer and admin can read; other facility → `document_not_found`; archived child: observer → `document_not_found`; upload to archived → `child_archived`; `deleteDocumentType` of a used type → `document_type_in_use`.
  - overview: required missing → cell null and `missingRequired: true`; important-not-required missing → null and `missingRequired` unaffected; two documents of one type → newest date shown; confidential cell for ordinary observer has `canOpen: false`; planned and archived children absent.
- [ ] **Step 2: Run** both files — Expected: FAIL
- [ ] **Step 3: Implement** lib, service, routes, `getChild` documents
- [ ] **Step 4: Run** `npm test` and `npm run typecheck` — Expected: PASS / no errors
- [ ] **Step 5: Commit** `feat: child documents with signature check and overview`

---

### Task 6: Leaving, archive, automatic deletion, facility move, group guard

**Files:**
- Modify: `server/services/children.ts`, `server/services/appSettings.ts` (retention), `server/services/groups.ts` (`deleteGroup`), `server/plugins/database.ts` (daily purge)
- Create routes: `server/api/children/[id]/leave.post.ts`, `[id]/unleave.post.ts`, `[id].delete.ts`, `children/archive.get.ts` (all `requireAdmin`); `server/api/children/[id]/facility.put.ts`, `server/api/child-retention.get.ts`, `child-retention.put.ts` (all `requireProvider`)
- Modify: `server/api/groups/[id].delete.ts` (pass `todayIso()`), `server/schemas.ts`, `shared/types/api.ts`, `tests/api/permissions.test.ts`
- Test: `tests/services/childLifecycle.test.ts`, `tests/services/groups.test.ts`

**Interfaces:**
- Consumes: Tasks 1–5 (`purgeDate`, `childStatus`, `DEFAULT_DOCUMENT_TYPES`, `listDocumentTypes`)
- Produces:
  - `getChildRetentionYears(db): number` (app setting `child_retention_years`, default 3), `setChildRetentionYears(db, years)` — not an integer 1–10 → 400 `invalid_retention`
  - `leaveChild(db, facilityId, id, leftOn: IsoDate, today)` — `leftOn` before `today` minus 1 year → 400 `left_on_too_early`; `unleaveChild(db, facilityId, id)`; `deleteChild(db, facilityId, id)` (rows cascade)
  - `ArchivedChildDto { id; name; leftOn: IsoDate; purgeOn: IsoDate }`; `listArchive(db, facilityId, today): ArchivedChildDto[]`
  - `getChild(...).purgeOn` = `purgeDate(leftOn, years)` for managers when `leftOn` is set, else null
  - `purgeExpiredChildren(db, today): number` — deletes every child (all facilities) with `purgeDate(left_on, years) <= today`, in one transaction; stores app setting `children_purged_on = today` and returns 0 without work when it already equals today
  - `moveChildToFacility(db, childId, targetFacilityId)` — 404 `child_not_found`/`facility_not_found`; clears `group_id` and `care_type_id`; remaps each document to the target's type with the same name, else the target's "Sonstiges" (created with the default flags if missing)
  - `deleteGroup(db, facilityId, id, today: IsoDate)` — 409 `group_has_children` when a non-archived child has the group; archived children keep nothing (FK SET NULL)
  - Plugin: in the existing hourly interval (and once at start) call `purgeExpiredChildren(useDb(), todayIso())`; log `Deleted <n> child record(s) after the retention period.` when n > 0 (no names); runs independently of `BACKUP_DIR`

- [ ] **Step 1: Write failing tests**
  - lifecycle: leave with today's date → still active today, archived tomorrow, in `listArchive` with `purgeOn` = leftOn + 3 years; `left_on_too_early`; unleave restores; retention 0 / 11 / 2.5 → `invalid_retention`; purge on the day before the purge date deletes nothing, on the purge date deletes child, contacts and documents; second call the same day returns 0; facility move remaps "Masernnachweis" to the target's "Masernnachweis" and an unknown custom type to "Sonstiges" (created if the target lacks it), clears group and care type.
  - groups: deleting a group with an active child → `group_has_children`; with only an archived child succeeds and the child's group becomes null.
- [ ] **Step 2: Run** the two files — Expected: FAIL
- [ ] **Step 3: Implement** services, plugin call, routes, permission lists
- [ ] **Step 4: Run** `npm test` and `npm run typecheck` — Expected: PASS / no errors
- [ ] **Step 5: Commit** `feat: leaving, archive, automatic deletion and facility move of children`

---

### Task 7: Frontend – list, record and contacts

**Files:**
- Create: `app/pages/children/index.vue` (tabs Liste, Geplant, Geburtstage; Dokumente and Archiv tabs come in Task 8), `app/pages/children/new.vue`, `app/pages/children/[id].vue`, `app/components/children/ChildImportantBox.vue`, `ChildMasterForm.vue`, `ChildContactsSection.vue`, `ChildHealthForm.vue`, `ChildConsentsForm.vue`, `TriStateSelect.vue`
- Modify: `app/layouts/default.vue` (nav "Kinder" for managers and observers), `app/locales/de.ts`

**Interfaces:**
- Consumes: Task 4 APIs and DTOs; `mayEditChildren`, `isManager`; `useAction`, `useConfirm`, `TimeInput`
- Produces (UI): list grouped by group with search and group filter, allergy and contact-ban icons with tooltip, "Kind anlegen" only when `mayEditChildren(user)`; record page with the "Wichtig" box (contact bans red, allergies, emergency contacts by rank with `tel:` links), the four sections each with "zuletzt geändert von … am …", edit mode only when `canEdit`; tri-state shown as ja / nein / offen (offen grey); contacts with add/edit/delete/move up/down

Texts (add under `children` in `de.ts`; use exactly):

```ts
children: {
  nav: 'Kinder', title: 'Kinder', tabs: { list: 'Liste', planned: 'Geplant', birthdays: 'Geburtstage', documents: 'Dokumente', archive: 'Archiv' },
  create: 'Kind anlegen', search: 'Suchen', allGroups: 'Alle Gruppen', noGroup: 'ohne Gruppe',
  age: (years: number, months: number) => `${years} J. ${months} M.`, important: 'Wichtig', contactBan: 'Kontaktverbot',
  allergies: 'Allergien', emergencyContacts: 'Notfallkontakte',
  sections: { master: 'Stammdaten', contacts: 'Bezugspersonen', health: 'Gesundheit', consents: 'Einwilligungen', documents: 'Dokumente' },
  lastChanged: (by: string, at: string) => `zuletzt geändert von ${by} am ${at}`,
  triState: { yes: 'ja', no: 'nein', open: 'offen' },
  fields: {
    lastName: 'Nachname', firstName: 'Vorname', birthDate: 'Geburtsdatum', address: 'Adresse', group: 'Gruppe', careType: 'Betreuungsform',
    entryDate: 'Eintritt', plannedEntryDate: 'geplanter Eintritt', infoMeetingDate: 'Infogespräch', schoolStartDate: 'voraussichtlicher Schulstart',
    primarySchool: 'Grundschule', note: 'Bemerkung',
    name: 'Name', relation: 'Beziehung', phoneHome: 'Telefon privat', phoneMobile: 'Telefon mobil', phoneWork: 'Telefon Arbeit',
    isGuardian: 'sorgeberechtigt', mayPickUp: 'darf abholen', emergencyRank: 'Notfallkontakt (Reihenfolge)', contactBanNote: 'Hinweis zum Kontaktverbot',
    measlesProof: 'Masernnachweis', measlesProofDate: 'Datum Masernnachweis', infectionBriefingDate: 'Belehrung Infektionsschutz',
    allergiesText: 'Allergien und Unverträglichkeiten', mayTakeTemperature: 'Fieber messen', mayApplySunscreen: 'Sonnenschutz auftragen', mayApplyPlaster: 'Pflaster kleben',
  },
  relations: ['Mutter', 'Vater', 'Oma', 'Opa', 'Tante', 'Onkel', 'Nachbar/in'],
  consents: {
    artworkDisplay: 'Bastel- und Malarbeiten aufhängen', photosDisplay: 'Einzel- und Gruppenfotos aufhängen',
    photosForeignPortfolios: 'Fotoerlaubnis für fremde Portfolios', photosInternalEvents: 'Fotos hausinterner Feste',
    photosWhatsapp: 'Fotos über WhatsApp versenden', photosNamesBirthdaysDisplay: 'Fotos, Namen und Geburtsdaten aufhängen',
    groupWorkWithNames: 'Gruppenarbeiten mit Namen ausstellen', whatsappContact: 'Kontaktaufnahme über WhatsApp',
    whatsappPhotos: 'Fotos über WhatsApp', whatsappParentGroup: 'WhatsApp-Elterngruppe',
  },
  consentGroups: { privacy: 'Datenschutz', whatsapp: 'WhatsApp' },
  addContact: 'Bezugsperson hinzufügen', birthdaysHint: 'Geburtstage der nächsten 8 Wochen', turns: (n: number) => `wird ${n}`,
},
```

Also add to `de.errors` German texts for every error code introduced in Tasks 2–6 (one sentence each, "du" form).

- [ ] **Step 1: Implement** pages, components, nav, texts
- [ ] **Step 2: Run** `npm run typecheck` and `npm test` — Expected: no errors / PASS
- [ ] **Step 3: Headless check** (if possible): dev server in the background, create a child via the API as the initial admin, fetch `/children` and `/children/<id>` HTML and confirm they render (status 200, names present); stop only the started process by PID; remove the worktree `.data`. Report what was not checked.
- [ ] **Step 4: Commit** `feat: children list and record pages`

---

### Task 8: Frontend – documents, overview, archive, settings, users, prints

**Files:**
- Create: `app/components/children/ChildDocumentsSection.vue`, `app/components/children/DocumentOverviewTab.vue`, `app/components/children/ArchiveTab.vue`, `app/components/settings/CareTypesSection.vue`, `app/components/settings/DocumentTypesSection.vue`, `app/components/settings/ChildRetentionSection.vue`, `app/pages/print/children/birthdays.vue`, `app/pages/print/children/documents.vue`
- Modify: `app/pages/children/index.vue` (tabs Dokumente, Archiv), `app/pages/children/[id].vue` (documents section; "Kind abmelden", "Abmeldung zurücknehmen", "Sofort löschen", "In andere Einrichtung verschieben" by role), `app/pages/admin/settings.vue`, `app/pages/admin/users.vue` (checkbox "darf Kinderakten pflegen" for Mitarbeiter accounts), `app/components/users/RightsTable.vue` (group "Kinder"), `app/locales/de.ts`

**Interfaces:**
- Consumes: Tasks 3, 5, 6 APIs; `PrintActions` (`fileName`), `useAction`, `useConfirm`
- Produces (UI):
  - Documents section: upload form (file input `accept="application/pdf,image/jpeg,image/png"` with camera capture allowed, type select with the type's confidential default, title, date default today, visibility); list with open (new tab, `file.get`), download (`?download=1`), edit, delete; lock icon and no link when `!canOpen`
  - Overview tab: table per `DocumentOverviewDto`, ✓ + date (link when `canOpen`, lock otherwise), red "fehlt" for missing required, empty for missing important; filter "nur Kinder mit fehlenden Dokumenten"; print link to `/print/children/documents`
  - Birthdays tab gets a print link to `/print/children/birthdays` (all active children by month and day)
  - Archive tab (managers only): name, Austritt, "wird gelöscht am", buttons Abmeldung zurücknehmen / Sofort löschen (with confirm)
  - Settings: Betreuungsformen and Dokumentarten sections for managers; Löschfrist section for the Träger
  - Rights table rows (provider, admin, observer, terminal): Kinderliste und Akten ansehen yes/yes/yes/no; Kinder anlegen und Akten ändern yes/yes/6/no; Vertrauliche Dokumente öffnen yes/yes/6/no; Kinder abmelden, Archiv, löschen yes/yes/no/no; Löschfrist einstellen yes/no/no/no — footnote 6 (next free number; check the existing footnotes): „nur mit Freischaltung „darf Kinderakten pflegen““

Texts (add to `de.ts`; use exactly):

```ts
childDocuments: {
  upload: 'Dokument hochladen', file: 'Datei (PDF, JPG oder PNG, höchstens 10 MB)', type: 'Art', title: 'Bezeichnung', date: 'Datum',
  visibility: 'Sichtbarkeit', all: 'alle Mitarbeiter', confidential: 'vertraulich', uploadedBy: (by: string, at: string) => `hochgeladen von ${by} am ${at}`,
  open: 'Öffnen', download: 'Herunterladen', missing: 'fehlt', onlyMissing: 'nur Kinder mit fehlenden Dokumenten', confirmDelete: 'Dokument wirklich löschen?',
},
childLifecycle: {
  leave: 'Kind abmelden', leftOn: 'Austrittsdatum', unleave: 'Abmeldung zurücknehmen', deleteNow: 'Sofort löschen',
  confirmDelete: 'Akte mit allen Bezugspersonen und Dokumenten endgültig löschen?', purgeOn: (date: string) => `wird gelöscht am ${date}`,
  move: 'In andere Einrichtung verschieben', archived: 'Abgemeldet – die Akte kann nicht mehr geändert werden.',
},
childSettings: {
  careTypes: 'Betreuungsformen', documentTypes: 'Dokumentarten', important: 'wichtig', required: 'für jedes Kind nötig', confidentialDefault: 'vertraulich',
  retention: 'Löschfrist für abgemeldete Kinder', retentionYears: 'Jahre nach dem Austritt',
  retentionHint: 'Abgemeldete Kinder werden nach Ablauf dieser Frist mit allen Daten und Dokumenten automatisch gelöscht. Bitte die Frist mit dem Datenschutzbeauftragten abstimmen.',
},
users: { ..., canEditChildren: 'darf Kinderakten pflegen' },
```

- [ ] **Step 1: Implement** components, pages, settings, users, rights table, prints, texts
- [ ] **Step 2: Run** `npm run typecheck` and `npm test` — Expected: no errors / PASS
- [ ] **Step 3: Headless check** (if possible): dev server, upload a small PDF via the API, confirm `file.get` returns it with the security headers and that `/print/children/birthdays` renders; stop only the started process by PID; remove the worktree `.data`. Report what was not checked.
- [ ] **Step 4: Commit** `feat: documents, overview, archive and settings for child records`

---

### Task 9: Operating guide and final verification

**Files:**
- Modify: `docs/BETRIEB.md`

- [ ] **Step 1: Add a section "Datenschutz (Kinderakten)"** in plain German: what is stored (Kinderakten, Dokumente in der Datenbank); who sees what (rights table of spec section 4 in short); automatic deletion after the retention period (Träger setting, default 3 years) and that deleted data stays up to 14 days in the daily backups; the downloaded backup contains all child data and must be kept safe; disk encryption of the server is the operator's job; update the backup section to mention that the database now contains documents and is larger.
- [ ] **Step 2: Run** `npm test`, `npm run typecheck`, `npm run build` — Expected: all pass / no errors (paste the summary lines into the report)
- [ ] **Step 3: Commit** `docs: data protection notes for child records`
