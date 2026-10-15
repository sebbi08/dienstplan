# Kinderakten nur am Tablet – Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Mitarbeiter see child records only at their facility's tablet after unlocking with name + PIN; their own accounts get no child data; Leitung/Träger are unchanged.

**Architecture:** A server-side unlock row (`terminal_unlocks`) referenced by a token in the tablet's session turns a tablet request into a *child viewer* with the unlocking person's rights. The three child guards (`requireChildReader/Editor/Manager`) resolve that viewer for every child route, so the existing child pages run on the tablet unchanged apart from where they read rights. Visibility of planned children at the tablet is enforced in the services; documents open in an in-app viewer at the tablet.

**Tech Stack:** Nuxt 4, Nitro, drizzle-orm + better-sqlite3, nuxt-auth-utils, Nuxt UI 4, Vitest; new dependency `pdfjs-dist` (Task 5, installed by the controller).

**Spec:** `docs/superpowers/specs/2026-10-15-kinderakten-nur-am-tablet-design.md`

## Global Constraints

- UI German, informal "du"; code, identifiers, comments, commits English. No Docker/CI changes.
- `node_modules` is a junction to the main checkout — never run `npm install`/`npm ci`. Never kill processes by image name; stop only processes you started (by PID). Port 3000 is used by the controller's dev server — use another port (`npx nuxt dev --port 3100`) for own checks.
- Branch `claude/tablet-children`; newest migration is `0031_*`. The new migration is generated with `npx drizzle-kit generate --name tablet_children` as `0032_tablet_children`; its journal `when` must be later than 0031's.
- Service convention `fn(db, facilityId, …)`; errors via `ServiceError(status, code)`; every new error code gets a German "du" text in `de.errors`. Other facilities' rows answer 404 `*_not_found`.
- Lock time: integer minutes 1–30, default 2 (per facility). PIN: 5 wrong attempts → 15 minutes locked, shared counter with stamping.
- Server accepts an unlock until `last_active_at + lockMinutes + 30 s` (`UNLOCK_GRACE_SECONDS = 30`); the tablet locks itself at last interaction + lockMinutes and sends `keep-alive` after an interaction at most every 15 s (`KEEP_ALIVE_MIN_SECONDS = 15`).
- Visibility switches apply only to viewers without manager rights; managers (Leitung/Träger) see all children everywhere.
- At the tablet never available: settings routes and `children/[id]/facility.put.ts` (Träger move).
- Tests: `npx vitest run <file>`; all: `npm test`; types: `npm run typecheck`; build: `npm run build`.

## Review Focus

1. A Mitarbeiter's own account calling any child route (incl. a document file URL) must get 403 `children_tablet_only` — a single route left on an old guard leaks data. → Task 3 sweeps all routes in the permissions test and adds a service-level test for the resolver.
2. The person who unlocked loses the right mid-session (Freischaltung removed, PIN cleared, employment ended, help-out entry deleted) — the next request must use the new rights or lock. → Task 2 tests.
3. A stale token: tablet locked or another person unlocked, then an old request/session token arrives — must be `tablet_locked`, never the new person's rights. → Task 2 test "a replaced token is locked".
4. Hidden planned child opened by direct link at the tablet (record, document file) — must be 404, also for a reader with the edit permission; a manager at the tablet still sees it. → Task 3 tests.
5. The device sleeps with a record open; on wake the page must lock (server expiry + client `visibilitychange` check), not show the record until the next tap. → Task 4 step and controller click-through.

---

### Task 1: Tablet settings per facility

**Files:**
- Modify: `server/db/schema.ts` (`facilities`), Create: `server/db/migrations/0032_tablet_children.sql` (+ journal/snapshot, generated) — the migration also creates `terminal_unlocks` (Task 2 uses it)
- Create: `shared/domain/tablet.ts`, `server/services/tabletSettings.ts`, `server/api/tablet-settings.get.ts`, `server/api/tablet-settings.put.ts`, `app/components/settings/TabletSection.vue`
- Modify: `server/schemas.ts`, `shared/types/api.ts`, `app/pages/admin/settings.vue`, `app/locales/de.ts`, `tests/api/permissions.test.ts` (new routes fall under the default `requireAdmin(` rule — nothing to list)
- Test: `tests/services/tabletSettings.test.ts`, `tests/services/db.test.ts` (migration)

**Interfaces:**
- Produces:
  - `shared/domain/tablet.ts`: `DEFAULT_TABLET_LOCK_MINUTES = 2`, `MIN_TABLET_LOCK_MINUTES = 1`, `MAX_TABLET_LOCK_MINUTES = 30`, `UNLOCK_GRACE_SECONDS = 30`, `KEEP_ALIVE_MIN_SECONDS = 15`.
  - `shared/types/api.ts`: `interface TabletSettingsDto { lockMinutes: number; showWaitlist: boolean; showFutureContracts: boolean }`.
  - `server/services/tabletSettings.ts`: `getTabletSettings(db: Db, facilityId: number): TabletSettingsDto`; `setTabletSettings(db: Db, facilityId: number, input: TabletSettingsDto): void` (400 `tablet_lock_minutes_invalid` outside 1–30 or not an integer).
  - Schema columns on `facilities`: `tabletLockMinutes` (`tablet_lock_minutes`, integer not null default 2), `tabletShowWaitlist` (`tablet_show_waitlist`, boolean not null default false), `tabletShowFutureContracts` (`tablet_show_future_contracts`, boolean not null default false).
  - Table `terminalUnlocks` (`terminal_unlocks`): `id` text PK; `terminalUserId` integer not null → `users.id` on delete cascade, unique; `facilityId` integer not null → `facilities.id` cascade; `employeeId` integer not null → `employees.id` cascade; `createdAt` text not null; `lastActiveAt` text not null.

- [ ] **Step 1: Write failing tests** in `tests/services/tabletSettings.test.ts`:
  - `returns the defaults for a facility` → `getTabletSettings(db, 1)` equals `{ lockMinutes: 2, showWaitlist: false, showFutureContracts: false }`.
  - `stores the settings per facility` → after `setTabletSettings(db, 1, { lockMinutes: 5, showWaitlist: true, showFutureContracts: false })`, facility 1 returns those, a second facility (`addFacility`) still the defaults.
  - `refuses a lock time outside 1–30 minutes` → `errorCode(() => setTabletSettings(db, 1, { lockMinutes: 0, … }))` and `31` and `2.5` are `'tablet_lock_minutes_invalid'`; nothing stored.
  - In `tests/services/db.test.ts`: `0032 adds the tablet columns with defaults to existing facilities` (follow the existing per-migration test pattern there) and `terminal_unlocks rows go with their tablet account` (deleting the user deletes the row).
- [ ] **Step 2: Run** `npx vitest run tests/services/tabletSettings.test.ts tests/services/db.test.ts` — Expected: FAIL (module/columns missing).
- [ ] **Step 3: Schema + migration.** Add the columns and table to `server/db/schema.ts`, run `npx drizzle-kit generate --name tablet_children`; check it is `0032_tablet_children` with a later `when`, and that the `ADD COLUMN` defaults are present.
- [ ] **Step 4: Implement** `shared/domain/tablet.ts`, `tabletSettings.ts`, `tabletSettingsSchema` in `server/schemas.ts` (`lockMinutes` int, two booleans), routes `GET/PUT /api/tablet-settings` with `requireAdmin(` on the admin's `facilityId`.
- [ ] **Step 5: UI.** `TabletSection.vue` in `admin/settings.vue` for managers (after `SettingsChildRetentionSection` placement rules: visible to Leitung and Träger): number field „Sperrzeit ohne Bedienung (Minuten)“, switches „Vormerkungen am Tablet zeigen“, „Künftige Kinder mit Vertrag am Tablet zeigen“, hint text verbatim from spec §7, save with the toast pattern of `SchoolChildrenSection.vue`. Texts in `de.ts` (`tablet` block) and `errors.tablet_lock_minutes_invalid: 'Die Sperrzeit muss zwischen 1 und 30 Minuten liegen.'`.
- [ ] **Step 6: Run** the two test files, `npm run typecheck` — Expected: PASS, exit 0.
- [ ] **Step 7: Commit** `feat: tablet settings per facility (lock time, planned children)`.

### Task 2: Unlocking the tablet

**Files:**
- Modify: `server/services/terminal.ts` (extract PIN check), `shared/types/auth.d.ts`, `shared/types/api.ts`, `server/services/dailyRun.ts`, `server/schemas.ts`, `tests/api/permissions.test.ts` (`TERMINAL_ROUTES`)
- Create: `server/lib/childViewer.ts`, `server/services/tabletUnlock.ts`, `server/api/terminal/children/unlock.post.ts`, `lock.post.ts`, `keep-alive.post.ts`, `status.get.ts`
- Test: `tests/services/tabletUnlock.test.ts`, `tests/services/terminal.test.ts` (unchanged behaviour), `tests/services/dailyRun.test.ts`

**Interfaces:**
- Consumes: Task 1 constants, `getTabletSettings`, table `terminalUnlocks`; `terminalStatus(db, facilityId, now)`; `getActiveUser`/`toSessionUser` (`server/services/auth.ts`).
- Produces:
  - `server/services/terminal.ts`: `export function verifyEmployeePin(db: Db, employeeId: number, pin: string, now: Date): void` — the existing missing/locked/invalid/lock-after-5 logic (codes `pin_missing`, `pin_locked`, `pin_invalid`), used by `terminalStamp` and `unlockChildren`.
  - `shared/types/api.ts`: `interface ChildVisibility { waitlist: boolean; futureContracts: boolean }`; `interface ChildRightsDto { canEdit: boolean; isManager: boolean; canMoveFacility: boolean; showWaitlist: boolean; showFutureContracts: boolean }`; `type TabletUnlockStatusDto = { unlocked: false } | { unlocked: true; employeeId: number; name: string; rights: ChildRightsDto; lockMinutes: number }`.
  - `server/lib/childViewer.ts`:
    ```ts
    export interface ChildViewer {
      /** Account for "changed by"; null for a person without (active) account at the tablet, who can only read. */
      id: number | null
      role: Role
      canEditChildren: boolean
      facilityId: number
      /** null = sees every child (managers); set at the tablet for everyone else. */
      visibility: ChildVisibility | null
      onTablet: boolean
    }
    export type ChildActor = ChildViewer & { id: number }
    ```
  - `server/services/tabletUnlock.ts`:
    - `unlockChildren(db: Db, terminal: { id: number; facilityId: number }, employeeId: number, pin: string, now?: Date): { token: string; status: TabletUnlockStatusDto }` — person must be in `terminalStatus(db, terminal.facilityId, now)` (else 404 `employee_not_found`, no attempt counted), then `verifyEmployeePin`; deletes expired rows of all tablets and any row of this terminal user, inserts a new row with `token = randomBytes(32).toString('base64url')`.
    - `lockChildren(db: Db, terminalUserId: number): void`.
    - `tabletChildViewer(db: Db, terminal: { id: number; facilityId: number }, token: string | undefined, now?: Date, touch?: boolean): ChildViewer` — 403 `tablet_locked` when no row for the token, row's terminal user/facility differ, `now > lastActiveAt + lockMinutes·60 s + UNLOCK_GRACE_SECONDS`, or the person is no longer in `terminalStatus`; in that last case the row is deleted. `touch` (default true) sets `lastActiveAt = now`.
    - `tabletUnlockStatus(db, terminal, token, now?): TabletUnlockStatusDto` — same checks without touching; `{ unlocked: false }` instead of throwing.
    - `deleteExpiredUnlocks(db: Db, now: Date): number`.
  - Rights rule (inside `tabletChildViewer`, spec §4.1): home staff (`employee.facilityId === terminal.facilityId`) with an active linked account (`users.employeeId = employee.id`, `active`) → `{ id: account.id, role: account.role, canEditChildren: account.canEditChildren }`; everyone else (no/inactive account, helper) → `{ id: null, role: 'observer', canEditChildren: false }`. `visibility = isManager(role) ? null : { waitlist: settings.showWaitlist, futureContracts: settings.showFutureContracts }`; `onTablet: true`; `facilityId: terminal.facilityId`.
  - `ChildRightsDto` for the tablet: `canEdit = mayEditChildren(viewer)`, `isManager = isManager(role)`, `canMoveFacility: false`, show flags = `visibility ?? true`.
  - Session: `UserSession.childUnlock?: string` in `shared/types/auth.d.ts`. Routes (all `requireTerminal(`): `unlock.post` (body `{ employeeId, pin }` via `tabletUnlockSchema`, stores the token with `setUserSession(event, { childUnlock: token })`, returns the status), `lock.post` (`lockChildren`, returns `{ unlocked: false }`), `keep-alive.post` (`tabletChildViewer` with touch, returns the status), `status.get` (`tabletUnlockStatus`). Never rely on clearing `childUnlock` in the session — the row is the truth.
  - `runDaily(db, today, log, now: Date = new Date())` gains a fourth part `'Deleting expired tablet unlocks failed'` → `deleteExpiredUnlocks(db, now)`; `DailyRunResult` gets `unlocksDeleted: number`.

- [ ] **Step 1: Write failing tests** in `tests/services/tabletUnlock.test.ts` (fixtures as in `terminal.test.ts`: `setTimeTrackingFrom(db, 1, '2026-10-01')`, `setPin`, a tablet `addUser(db, 'tablet', 'terminal')`; times `at('2026-10-06T06:00:00Z')`):
  - `unlocks with the right PIN and returns the person and rights` → status `{ unlocked: true, name: 'Anna', rights: { canEdit: false, isManager: false, canMoveFacility: false, showWaitlist: false, showFutureContracts: false }, lockMinutes: 2 }`.
  - `wrong PINs count together with stamping` → 4× `pin_invalid` via `unlockChildren`, 5th via `terminalStamp` → `pin_locked`; `unlockChildren` with the right PIN 14 min later → `pin_locked`.
  - `refuses people not on the tablet list` (no PIN, left, employee of another facility without help-out) → `employee_not_found`.
  - `locks after the lock time plus grace` → viewer at +2 min 29 s ok (no touch), at +2 min 31 s `tablet_locked`; with touch at +1 min, ok at +3 min 29 s.
  - `a changed lock time applies at once` → `setTabletSettings` to 1 min, viewer at +1 min 31 s → `tablet_locked`.
  - `locking and a second unlock end the first` → after `lockChildren` the token is `tablet_locked`; after another person unlocks, the first token is `tablet_locked` and the new one gives the new person.
  - `a token of another tablet or facility is locked` → second tablet account (facility 2) with the first token → `tablet_locked`.
  - `rights follow the account freshly`:
    - no account → `{ id: null, role: 'observer', canEditChildren: false }`;
    - observer account with `canEditChildren` → `canEditChildren: true`, `id` = account id; after clearing the flag in the DB the next viewer has `false`;
    - deactivated account → read-only (`id: null`);
    - Leitung account (`addUser(db, 'leitung', 'admin', employeeId)`) → `role: 'admin'`, `visibility: null`.
  - `a helper reads only and only on planned days` → helper of facility 2 with help-out entry in facility 1 today (pattern from `terminal.test.ts`) and an observer account with `canEditChildren` → viewer `{ id: null, role: 'observer', canEditChildren: false }`; after deleting the entry → `tablet_locked` and the row is gone.
  - `clearing the PIN or ending employment locks` → `clearPin` then viewer → `tablet_locked`.
  - `visibility reflects the switches for non-managers` → after `setTabletSettings(…, showWaitlist: true)` the observer viewer has `visibility: { waitlist: true, futureContracts: false }`.
  - `deleteExpiredUnlocks removes only expired rows`; in `dailyRun.test.ts`: `the daily run deletes expired tablet unlocks` → `unlocksDeleted: 1`.
  - In `terminal.test.ts`: existing tests stay green unchanged.
- [ ] **Step 2: Run** `npx vitest run tests/services/tabletUnlock.test.ts tests/services/terminal.test.ts tests/services/dailyRun.test.ts` — Expected: FAIL (module missing).
- [ ] **Step 3: Implement** `verifyEmployeePin` (move, don't change behaviour), `childViewer.ts`, `tabletUnlock.ts`, the four routes, `tabletUnlockSchema` (`employeeId` int, `pin` string max 10), the session type, the daily-run part; add the routes to `TERMINAL_ROUTES`.
- [ ] **Step 4: Run** the three test files, `npx vitest run tests/api/permissions.test.ts`, `npm run typecheck` — Expected: PASS, exit 0.
- [ ] **Step 5: Commit** `feat: unlocking the tablet for child records with name and PIN`.

### Task 3: Child guards resolve the child viewer

**Files:**
- Modify: `server/utils/auth.ts`, `server/services/tabletUnlock.ts` (resolver), `shared/domain/children.ts`, every route under `server/api/children/**`, `server/api/child-*/**`, `server/api/care-types/index.get.ts`, `server/api/document-types/index.get.ts` that uses a child guard or is one of the nine manager routes, the services they call (`children.ts`, `childContacts.ts`, `childDocuments.ts`, `childGroupChanges.ts`, `documentReview.ts` where they take a `SessionUser` actor/viewer), `app/locales/de.ts`, `tests/api/permissions.test.ts`
- Test: `tests/services/childViewer.test.ts`, existing child service tests (adapt fixtures to `ChildViewer`)

**Interfaces:**
- Consumes: `ChildViewer`, `ChildActor`, `tabletChildViewer` (Task 2).
- Produces:
  - `server/services/tabletUnlock.ts`: `resolveChildViewer(db: Db, user: SessionUser, token: string | undefined, now?: Date): ChildViewer` — `terminal` → `tabletChildViewer(…, touch true)`; manager → `{ id: user.id, role, canEditChildren, facilityId (403 no_facility if null), visibility: null, onTablet: false }`; anyone else → 403 `children_tablet_only`.
  - `server/utils/auth.ts`:
    - `requireChildReader(event): Promise<ChildViewer>` — `requireUser(event, { allowTerminal: true })`, session `childUnlock`, `resolveChildViewer`; for non-tablet viewers also `checkPageFacility`.
    - `requireChildEditor(event): Promise<ChildActor>` — reader + `mayEditChildren(viewer)` (else 403 `forbidden`); `id` is non-null by construction (assert).
    - `requireChildManager(event): Promise<ChildActor>` — reader + `isManager(viewer.role)` (else 403 `forbidden`).
  - `shared/domain/children.ts`: `hiddenFromViewer(child: { admissionStatus: AdmissionStatus; entryDate: IsoDate | null; leftOn: IsoDate | null }, visibility: ChildVisibility | null, today: IsoDate): boolean` — true only when `childStatus` is `planned` and (`waitlist` → `!visibility.waitlist`; contract → `!visibility.futureContracts`); `visibility === null` → false.
  - Services: parameters typed `SessionUser` (or `SessionUser & { facilityId }`) for a child viewer/actor become `ChildViewer` / `ChildActor`. Visibility is enforced in `listPlanned(db, viewer, today)` (hidden part returns `[]`), `getChild` (404 `child_not_found`), `readDocumentFile` (404 `document_not_found`); the active-only lists need no change (planned children are never in them).
  - Routes: the nine child routes on `requireAdmin(` today move to `requireChildManager(`: `children/[id].delete`, `children/archive.get`, `children/occupancy.get`, `children/school-children.get`, `children/[id]/group-change.post`, `child-group-changes/[id].put`, `child-group-changes/[id].delete`, `children/[id]/leave.post`, `children/[id]/unleave.post`. `children/[id]/facility.put` stays `requireProvider(`; care-type/document-type writes stay `requireAdmin(`.
  - Permissions test: new list `CHILD_MANAGER_ROUTES` (the nine) checked for `requireChildManager(`; remove them from `ADMIN_ROUTES`; comments of the child lists drop "not the tablet"; public-route regex includes `ChildManager`.
  - `de.errors.children_tablet_only: 'Kinderakten siehst du nur am Tablet deiner Einrichtung.'`, `de.errors.tablet_locked: 'Das Tablet ist gesperrt. Tippe deinen Namen an und gib deine PIN ein.'`.

- [ ] **Step 1: Write failing tests** in `tests/services/childViewer.test.ts`:
  - `a Mitarbeiter account gets no child data` → `resolveChildViewer(db, observer, undefined)` and with `canEditChildren` → `children_tablet_only`.
  - `Leitung and Träger keep their access` → admin/provider viewers `{ visibility: null, onTablet: false }`.
  - `the tablet needs an unlock` → terminal user without token → `tablet_locked`; with a token from `unlockChildren` → viewer of the person.
  - `hidden planned children at the tablet` (facility switches off; children: waitlist, contract with entry 2026-11-01, contract without entry date, active): for an unlocked observer → `listPlanned` returns `{ waitlist: [], contracted: [] }`, `getChild` of each planned child → `child_not_found`, `readDocumentFile` of a document of the waitlist child → `document_not_found`; the active child opens. With `showWaitlist: true` the waitlist child appears and opens, the contract children stay hidden. An unlocked Leitung sees and opens all.
  - `an unlocked editor's change is stored under the account` → `uploadDocument` with the tablet actor; the document's `uploadedBy` is the account id.
  - Unit test of `hiddenFromViewer` in `tests/domain/` for the four cases and `visibility: null`.
- [ ] **Step 2: Run** `npx vitest run tests/services/childViewer.test.ts` — Expected: FAIL.
- [ ] **Step 3: Implement** the resolver, guards, `hiddenFromViewer`, service type changes and visibility checks, route guard changes, permission lists, error texts. Adapt existing child service tests that pass a `SessionUser` (spread it into a `ChildViewer` with `visibility: null, onTablet: false`; a small helper in `tests/helpers/fixtures.ts`: `asChildViewer(user: SessionUser, facilityId = 1): ChildActor`).
- [ ] **Step 4: Run** `npm test`, `npm run typecheck` — Expected: all PASS, exit 0.
- [ ] **Step 5: Commit** `feat: child records only for managers and the unlocked tablet`.

### Task 4: Tablet pages, lock bar and rights in the child pages

**Files:**
- Create: `app/composables/useChildRights.ts`, `app/components/terminal/PinPad.vue`, `app/components/terminal/TabletUnlockBar.vue`, `app/plugins/tabletLocked.client.ts`
- Modify: `app/pages/terminal.vue`, `app/middleware/auth.global.ts`, `app/layouts/default.vue`, `app/pages/children/index.vue`, `app/pages/children/new.vue`, `app/components/children/PlannedTab.vue`, `app/components/children/ChildLifecycleSection.vue`, `app/components/children/ChildMasterForm.vue`, `app/locales/de.ts` (`users.canEditChildren` hint, `terminal` texts), `docs/BETRIEB.md`

**Interfaces:**
- Consumes: Task 2 routes and `TabletUnlockStatusDto`/`ChildRightsDto`; constants from `shared/domain/tablet.ts`.
- Produces:
  - `useChildRights(): { rights: ComputedRef<ChildRightsDto | null>; onTablet: ComputedRef<boolean>; unlock: Ref<TabletUnlockStatusDto | null>; refreshUnlock(): Promise<void>; lock(): Promise<void> }` — shared via `useState('tablet-unlock')`. Office: rights from the session user (`canEdit = mayEditChildren(user)`, `isManager`, `canMoveFacility = role === 'provider'`, both show flags `true`). Tablet: from the status route.
  - `PinPad.vue`: `v-model` (string, max 4 digits), props `busy: boolean`, emits `back`; markup moved from `terminal.vue`.

- [ ] **Step 1: Tablet start page.** `terminal.vue` gets a start view with two large buttons „Stempeln“ and „Kinder“ (`mode: 'start' | 'stamp' | 'children'`). Entering the start view or „Stempeln“ calls `lock()`. „Kinder“ shows the same people list (`/api/terminal/status`), then `PinPad`; on success `POST /api/terminal/children/unlock`, store the status, `navigateTo('/children')`; errors with the existing `errorMessage`.
- [ ] **Step 2: Guards and menu.** Middleware: terminal may visit `/terminal`, `/plan/…`, `/children`, `/children/…`; on `/children…` it loads the unlock status (`refreshUnlock()`) and goes to `/terminal` when not unlocked (also on a full page load); an `observer` on `/children…` → `navigateTo('/')`. Layout: „Kinder“ only for managers; for the terminal on `/children…` render `TabletUnlockBar` instead of the menu.
- [ ] **Step 3: Lock bar.** `TabletUnlockBar.vue`: „Aufgeschlossen: ‹Name›“ + „Sperren“. Listens to `pointerdown`, `keydown`, `scroll` (passive) on `window`; deadline = last interaction + `lockMinutes`; after an interaction sends `keep-alive` if the last one is ≥ `KEEP_ALIVE_MIN_SECONDS` ago; at the deadline, on „Sperren“, and on `visibilitychange` to visible past the deadline → `lock()` + `navigateTo('/terminal')`. No status → `navigateTo('/terminal')`.
- [ ] **Step 4: Locked responses.** `tabletLocked.client.ts`: wrap `globalThis.$fetch` with `$fetch.create({ onResponseError })`; when `response._data?.data?.code === 'tablet_locked'` and the user is the terminal, clear the unlock state and `navigateTo('/terminal')`.
- [ ] **Step 5: Rights in the child pages.** Replace the `user`-based checks with `useChildRights()`: `index.vue` (`canCreate = rights.canEdit`, `isLeader = rights.isManager`; tab „Vormerkungen & Verträge“ only when `showWaitlist || showFutureContracts`), `new.vue`, `PlannedTab.vue` (show only the enabled parts), `ChildLifecycleSection.vue` (`manager = rights.isManager`, `isProvider = rights.canMoveFacility`), `ChildMasterForm.vue` (`isManager` → `rights.isManager`). Hint for the permission in the user form: „Gilt am Tablet der Einrichtung. Mit dem eigenen Konto sehen Mitarbeiter keine Kinder.“
- [ ] **Step 6: Docs.** `docs/BETRIEB.md` „Datenschutz (Kinderakten)“: children for Mitarbeiter only at the tablet (name + PIN), lock time and the two switches under Einstellungen → Tablet, PIN needed (Leitung assigns it as for stamping), documents at the tablet are shown in the app without download.
- [ ] **Step 7: Run** `npm test`, `npm run typecheck`, `npm run build` — Expected: PASS, exit 0, build ok. Then a headless check on port 3100: as the tablet `GET /children` without unlock redirects to `/terminal`; an observer session gets 403 `children_tablet_only` from `/api/children?status=active` and `/children` redirects to `/`.
- [ ] **Step 8: Commit** `feat: child pages on the tablet with lock bar and automatic lock`.

### Task 5: Documents at the tablet

**Controller before dispatch:** install `pdfjs-dist` (exact current version, `--save-exact --ignore-scripts`) and commit `package.json`/`package-lock.json`; tell the implementer the version.

**Files:**
- Create: `app/components/children/DocumentViewer.vue`
- Modify: `app/components/children/ChildDocumentsSection.vue`, `app/components/children/DocumentOverviewTab.vue`, `app/utils/children.ts` (if needed), `app/locales/de.ts`

**Interfaces:**
- Consumes: `useChildRights().onTablet`; `/api/child-documents/:id/file` (unchanged).
- Produces: `DocumentViewer.vue` props `{ documentId: number; title: string; mimeType: string }`, `v-model:open` (boolean).

- [ ] **Step 1: Viewer.** Loads the file with `$fetch(…, { responseType: 'arrayBuffer' })`. PDF: `pdfjs-dist` (`getDocument({ data })`, worker via `GlobalWorkerOptions.workerSrc = new URL('pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url).toString()`), every page rendered to a `<canvas>` at the container width. JPEG/PNG: `URL.createObjectURL(new Blob([data], { type: mimeType }))`, revoked on close/unmount. Data dropped on close and unmount (also when the lock navigates away). Errors → German text `childDocuments.viewerFailed: 'Das Dokument konnte nicht angezeigt werden.'`.
- [ ] **Step 2: Use it at the tablet.** In `ChildDocumentsSection.vue` and `DocumentOverviewTab.vue`: with `onTablet` the title/✓ opens `DocumentViewer`; the open-in-browser and download links are not rendered. Office unchanged.
- [ ] **Step 3: Camera.** In the upload form at the tablet a second button „Foto aufnehmen“ with a hidden `<input type="file" accept="image/*" capture="environment">` feeding the same upload path (same size/type checks; a non-JPEG/PNG photo gets the existing error text).
- [ ] **Step 4: Run** `npm run typecheck`, `npm run build`, `npm test` — Expected: exit 0, build ok, PASS.
- [ ] **Step 5: Commit** `feat: documents open in the app at the tablet; photo upload`.

### Task 6: Controller click-through (no implementer)

- [ ] Built-in browser at tablet size (`resize_window` 1024×768) on the controller's dev server: tablet login (test credentials from `.env`), start page buttons, unlock as a Mitarbeiter without account (read only), as one with the permission (edit, photo upload, PDF in the viewer, no download link), as Leitung (Belegung/Archiv), switches off/on for planned children, „Sperren“, automatic lock after the lock time, a Mitarbeiter account sees no „Kinder“ and `/children` redirects. Record findings in the ledger; fixes go to the final fix wave.
