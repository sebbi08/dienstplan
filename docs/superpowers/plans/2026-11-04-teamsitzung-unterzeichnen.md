# Teamsitzungsprotokolle unterzeichnen – Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Participants of a team meeting are chosen from the facility's staff and confirm the released minutes with one click (own account) or with name + PIN at the facility tablet; minutes, list and printout show who signed.

**Architecture:** A new table `team_meeting_participants` (one row per chosen employee, name kept as text, `signed_at`/`signed_via`) next to `team_meetings`, whose free-text `participants` column stays as the field for further participants. `server/services/teamMeetings.ts` stores the chosen participants with the header, signs, and clears signatures on reopen; one new route `POST /api/team-meetings/[id]/sign`. The pages get a checkbox list in the header, a „Unterzeichnet“ section with the sign button (tablet: name + PIN dialog), counts in the list and the lines on the printout.

**Tech Stack:** Nuxt 4, Nitro, drizzle-orm + better-sqlite3 (migrations via `npm run db:generate`, drizzle-kit from node_modules), Nuxt UI 4, Vitest.

**Spec:** `docs/superpowers/specs/2026-11-04-teamsitzung-unterzeichnen-design.md`

## Global Constraints

- All user-facing text German, in `app/locales/de.ts`; code, comments and commits English.
- Never run `npm install`/`npm ci` or download packages; `npm run db:generate` (local drizzle-kit) is allowed.
- Every `$fetch` typed `$fetch<T>(…)` (route typing is emptied, see nuxt.config `types:extend`).
- A new API route: run `node scripts/route-access-snapshot.mjs` and raise the route count in `tests/domain/permissions.test.ts` (`toHaveLength(317)` → 318).
- Commit only own files: `git commit -m "…" -- <paths>` (other agents may have staged files).
- The free-text field keeps its label **„Teilnehmer“** (not „Gäste“); its limit stays 300 characters.
- Signing only when the meeting is `released`; reopening clears every `signed_at`/`signed_via` of the meeting, participants stay.
- No one signs for another person; the tablet signs only with that person's PIN (`verifyEmployeePin`, same lock as stamping).

## Review Focus

- A participant who left (`left_on` before today) cannot sign (409 `employee_inactive`) but stays listed; they stay choosable only if already chosen.
- Signing twice: 409 `team_meeting_already_signed`, the first time stays unchanged.
- A Mitarbeiter of another facility, or an employee id of another facility sent by the tablet: 404 `employee_not_found` before the PIN is checked (no attempt counted).
- Deleting an employee for good keeps the participant row with its name (`employee_id` becomes null); the minutes still show the name.
- Saving the header with the participant list while someone released in between: nothing is written (existing 409 `team_meeting_released` path covers the participant rows too, same transaction).

---

### Task 1: Participants stored with the header

**Files:**
- Modify: `server/db/schema.ts` (new table after `teamMeetings`)
- Create: migration via `npm run db:generate` (expect `server/db/migrations/0065_*.sql` + meta snapshot/journal)
- Modify: `shared/types/api.ts` (team meeting types)
- Modify: `server/schemas.ts` (`teamMeetingHeaderSchema`)
- Modify: `server/services/teamMeetings.ts`
- Test: `tests/services/teamMeetings.test.ts` (adapt `header`), new `tests/services/teamMeetingSigning.test.ts` (participants part)

**Interfaces:**
- Produces:
  - Table `teamMeetingParticipants` = `team_meeting_participants`: `id` pk, `meetingId` (→ team_meetings.id, cascade), `employeeId` (→ employees.id, `onDelete: 'set null'`, nullable), `name` text not null, `sortOrder` int not null, `signedAt` text nullable, `signedVia` text enum `['account','tablet']` nullable; unique index on (`meeting_id`, `employee_id`).
  - `TeamMeetingHeader.participantIds: number[]` (the chosen employees, in the order shown).
  - `export interface TeamMeetingSignerDto { employeeId: number | null; name: string; signedAt: string | null; signedVia: 'account' | 'tablet' | null }`
  - `TeamMeetingListItemDto` gains `signers: TeamMeetingSignerDto[]` (in `sortOrder`) and `mineOpen: boolean` (the member's own employee is a participant without signature and the meeting is released).
  - `TeamMeetingsDto` and `TeamMeetingDto` gain `staff: { id: number; name: string; shortName: string }[]` (choosable: the facility's employees not left before today, in the staff list's order; `TeamMeetingDto` adds the meeting's already chosen ones even if left).
  - `TeamMeetingsDto` gains `toSign: { count: number; firstId: number | null }` (released meetings of the facility in any year where the member's own employee is an unsigned participant; `{0, null}` for the tablet or a member without employee; `firstId` = the oldest by date).
  - `TeamMember` gains `employeeId: number | null` (null for the tablet).

- [ ] **Step 1: Write failing tests** in `tests/services/teamMeetingSigning.test.ts` (setup like `teamMeetings.test.ts`: Leitung, Mitarbeiter accounts linked to employees Anna/Berta, a team template, the tablet):
  - `stores the chosen participants with their names, in order` — create with `participantIds: [berta, anna]` → `getTeamMeeting(…).signers` equals `[{ employeeId: berta, name: 'Berta', signedAt: null, signedVia: null }, { employeeId: anna, name: 'Anna', … }]`; `participants` (free text) unchanged.
  - `replaces the participants on save, keeping the stored name of those who stay` — rename Anna's employee after choosing, save with `[anna]` → name stays `'Anna'`; Berta's row gone.
  - `refuses an employee of another facility` → `'404 employee_not_found'`; `refuses a left employee unless already chosen` → new left one `'409 employee_inactive'`, an already chosen one who left meanwhile is kept.
  - `lists the choosable staff` — left employee absent from `listTeamMeetings(…).staff`, present in `getTeamMeeting(…).staff` when chosen.
  - `keeps the name when the employee is deleted for good` — delete the employee via the existing deletion service used by „Endgültig löschen“ → signer `{ employeeId: null, name: 'Anna', … }`.
  - In `tests/services/teamMeetings.test.ts` add `participantIds: []` to `header`.
- [ ] **Step 2: Run** `npx vitest run tests/services/teamMeetingSigning.test.ts tests/services/teamMeetings.test.ts` → FAIL (missing field/table).
- [ ] **Step 3: Implement** schema table, `npm run db:generate` (check the generated SQL creates only the new table and index), types, `participantIds: z.array(z.number().int()).max(200)` in the header schema, and in the service: `checkedHeader` validates the ids (unique, facility's employees; a left one only if already a participant of this meeting), `createTeamMeeting`/`saveTeamMeeting` write the rows in the same transaction (delete removed, insert new with the current employee name, update `sortOrder`; existing rows keep `name`, `signedAt`, `signedVia`), `toListItem`/`getTeamMeeting`/`listTeamMeetings` fill `signers`, `mineOpen`, `staff`, `toSign`. Load signers for all listed meetings in one query.
- [ ] **Step 4: Run** the two test files and `npm run typecheck` → PASS.
- [ ] **Step 5: Commit** `feat: team meeting participants chosen from the staff`.

### Task 2: Signing and reopening

**Files:**
- Modify: `server/services/teamMeetings.ts`
- Create: `server/api/team-meetings/[id]/sign.post.ts`
- Modify: `server/schemas.ts` (`teamMeetingSignSchema`)
- Modify: `app/locales/de.ts` (`errors`: new codes)
- Modify: `tests/fixtures/route-access-before.json` (regenerate), `tests/domain/permissions.test.ts` (318)
- Test: `tests/services/teamMeetingSigning.test.ts`

**Interfaces:**
- Consumes: Task 1 table, `TeamMember.employeeId`, `verifyEmployeePin(db, employeeId, pin, now)` from `server/services/terminal.ts`.
- Produces:
  - `signTeamMeeting(db: Db, member: TeamMember, id: number, input: { employeeId?: number; pin?: string }, now?: Date): TeamMeetingDto`
  - Route `POST /api/team-meetings/[id]/sign`, body `{ employeeId?: number; pin?: string }` (`teamMeetingSignSchema`: `employeeId` int optional, `pin` string max 20 optional), guard `requirePermission(event, 'teamMeetings.write', { allowTerminal: true, facility: 'active' })` like the list route.
  - Error codes: `team_meeting_not_released` (409), `team_meeting_not_participant` (403), `team_meeting_already_signed` (409), `team_meeting_sign_input_invalid` (400); existing `employee_inactive`, `employee_not_found`, `pin_missing`, `pin_invalid`, PIN lock codes.

- [ ] **Step 1: Write failing tests** (same file):
  - `signs with the own account after release` — `signedAt` = `NOW.toISOString()`, `signedVia: 'account'`, `mineOpen` false afterwards, `toSign.count` drops by one.
  - `refuses before release` → `'409 team_meeting_not_released'`; `refuses a non-participant` → `'403 team_meeting_not_participant'`; `refuses twice` → `'409 team_meeting_already_signed'`; `refuses a participant who left` → `'409 employee_inactive'`.
  - `signs at the tablet with the person's PIN` — `setPin(db, 1, anna, '123456')`; tablet member with `{ employeeId: anna, pin: '123456' }` → `signedVia: 'tablet'`; wrong PIN → `'401 pin_invalid'`, nothing stored; no PIN set → `'400 pin_missing'`; employee of another facility → `'404 employee_not_found'` and that person's `pinFailed` unchanged; the tablet without `employeeId`/`pin` → `'400 team_meeting_sign_input_invalid'`.
  - `an account ignores employeeId and signs only for itself` — Leitung (with linked employee) sends `{ employeeId: anna }` → its own row is signed, Anna's not.
  - `reopening clears every signature` — after two signatures, `reopenTeamMeeting` → all `signedAt`/`signedVia` null, participants unchanged; after a new release `mineOpen` is true again.
- [ ] **Step 2: Run** `npx vitest run tests/services/teamMeetingSigning.test.ts` → FAIL.
- [ ] **Step 3: Implement** `signTeamMeeting` (tablet: `member.employeeId === null` → needs both fields, else 400 `team_meeting_sign_input_invalid`; check the employee is a participant row of the meeting and belongs to `member.facilityId` before `verifyEmployeePin`; account: uses `member.employeeId`, ignores input; left = `left_on` before today in Berlin; update with `signed_at IS NULL` in the WHERE so a race keeps the first), clear signatures inside `reopenTeamMeeting`'s update transaction, the route, schema, error texts in `de.errors` (German: „Unterzeichnen geht erst nach der Freigabe.“, „Nur Teilnehmer der Sitzung unterzeichnen.“, „Du hast dieses Protokoll schon unterzeichnet.“, „Bitte wähle deinen Namen und gib deine PIN ein.“), regenerate the route fixture, bump the count.
- [ ] **Step 4: Run** the test file, `npx vitest run tests/domain/permissions.test.ts tests/api`, `npm run typecheck` → PASS.
- [ ] **Step 5: Commit** `feat: sign released team meeting minutes`.

### Task 3: Pages – choose, sign, see

**Files:**
- Modify: `app/utils/teamMeetings.ts` (`TeamMeetingHeaderForm.participantIds: number[]`, `headerForm`, `headerBody`)
- Modify: `app/components/team-meetings/HeaderFields.vue` (prop `staff`; section „Teilnehmer“: checkboxes of the staff, below the existing text input with placeholder `de.teamMeetings.participantsMorePlaceholder`)
- Create: `app/components/team-meetings/Signers.vue` (list + sign button + tablet dialog)
- Modify: `app/pages/team-meetings/[id].vue`, `app/pages/team-meetings/index.vue`
- Modify: `app/locales/de.ts` (`teamMeetings`)

**Interfaces:**
- Consumes: Task 1 DTO fields, Task 2 route.
- Produces: `TeamMeetingsSigners` component, props `{ meeting: TeamMeetingDto; tablet: boolean }`, emits `signed(meeting: TeamMeetingDto)`.

- [ ] **Step 1: Texts** in `de.teamMeetings` (exact): `participantsMorePlaceholder: 'weitere, z. B. Frau Weber (Fachberatung)'`, `participantsPick: 'Aus dem Team (unterzeichnen das Protokoll)'`, `signersTitle: 'Unterzeichnet'`, `signedCount: (signed: number, total: number) => \`${signed} von ${total} unterzeichnet\``, `signedAt: (at: string) => \`unterzeichnet am ${at}\``, `signOpen: 'noch offen'`, `signAfterRelease: 'Unterzeichnen nach der Freigabe'`, `sign: 'Gelesen und unterzeichnen'`, `signConfirm: 'Bestätigst du, dass du das Protokoll gelesen hast?'`, `signed: 'Unterzeichnet'`, `signTablet: 'Unterzeichnen'`, `signName: 'Dein Name'`, `signPin: 'Deine PIN'`, `mineOpen: 'Du hast noch nicht unterzeichnet'`, `toSign: (count: number) => count === 1 ? 'Du musst noch 1 Protokoll unterzeichnen.' : \`Du musst noch ${count} Protokolle unterzeichnen.\``, `toSignOpen: 'Zum Protokoll'`, `signaturesVoid: 'Unterzeichnungen von vorher sind verfallen; nach der neuen Freigabe unterzeichnen alle neu.'`, `reopenVoidsSignatures: 'Die bisherigen Unterzeichnungen verfallen dabei; nach der neuen Freigabe unterzeichnen alle neu.'`.
- [ ] **Step 2: Header** — checkboxes from `staff` (name, short name grey), keep the free-text input with the label „Teilnehmer“ shown once over both; `headerForm`/`headerBody` carry `participantIds` (from `meeting.signers` with `employeeId !== null`).
- [ ] **Step 3: `Signers.vue`** — shows every signer: „✓ Name“ + `signedAt(formatDateTime(...))` or `signOpen` (draft: `signAfterRelease`), and `signedCount`. Account (`!tablet`): button `sign` when `meeting.mineOpen`, `useConfirm` with `signConfirm`, POST with `{}`. Tablet: button `signTablet` when released and someone is open → modal with a select of the open participants with `employeeId !== null` and a PIN input (numeric, `PIN_LENGTH`), POST `{ employeeId, pin }`; errors via the page's existing error toast/`useAction`. Hidden entirely when `signers` is empty.
- [ ] **Step 4: Meeting page** — render `TeamMeetingsSigners` below the minutes (tablet = `user.role === 'terminal'`), replace the meeting with the answer on `signed`; under the existing reopened line show `signaturesVoid` when `reopenedAt` and signers exist; the reopen dialog shows `reopenVoidsSignatures` when any signer has `signedAt`. Pass `staff` to `HeaderFields`.
- [ ] **Step 5: List page** — per released meeting with signers: `signedCount` (green when all signed), and `mineOpen` text; above the list (not on the tablet) a notice with `toSign(count)` and a link `toSignOpen` to `/team-meetings/${firstId}` when `toSign.count > 0`. Pass `staff` to `HeaderFields` in the create dialog.
- [ ] **Step 6: Verify** `npm run typecheck`, `npm test`, `npm run build`; browser check on a scratch DB copy (port 3101): create with participants, release as Träger, sign as Mitarbeiterin (observer login), list shows counts.
- [ ] **Step 7: Commit** `feat: choose participants and sign team meeting minutes in the pages`.

### Task 4: Printout

**Files:**
- Modify: `app/utils/forms.ts` (`teamSheet`, `teamMeetingStamps` if needed)
- Modify: `app/locales/de.ts`
- Test: existing tests of `app/utils/forms.ts`, if any (`grep -rn teamSheet tests`); else verify in the browser.

- [ ] **Step 1:** Header row „Teilnehmer“: chosen names (`signers.map(s => s.name)`) joined with `', '`, then the free text, joined with `', '` (skip empties).
- [ ] **Step 2:** `closing` gets, after the release/reopen lines and only when signers exist: `de.teamMeetings.printSigned(name, formatDateTime(signedAt))` = `` `Unterzeichnet: ${name} – ${at}` `` per signed one, then one line `de.teamMeetings.printUnsigned(names)` = `` `Noch nicht unterzeichnet: ${names.join(', ')}` `` when any are open.
- [ ] **Step 3: Verify** typecheck + build, print page in the browser (scratch server) shows the lines.
- [ ] **Step 4: Commit** `feat: signatures on the team meeting printout`.
