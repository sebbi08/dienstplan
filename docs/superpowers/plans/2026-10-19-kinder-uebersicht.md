# Übersicht der Kinder – Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A read-only „Übersicht“ tab under „Kinder“ with seven sub-tabs laid out like the Excel sheets (Datenschutz, Messenger, Gesundheit, Abholberechtigte, Sorgeberechtigte, Notfallkontakte, Telefonnummern), visible at the tablet with the group rules of the records, printable by Leitung/Träger.

**Architecture:** One reader service builds an `ChildrenOverviewDto` for the children the viewer may see (same filter as `listChildren`), and one `requireChildReader(` route serves it. The client renders a tab with sub-tabs from a column definition per sub-tab and a shared table component; a print page reuses the same definitions.

**Tech Stack:** Nuxt 4, Nitro, drizzle-orm + better-sqlite3, Nuxt UI 4, Vitest.

**Spec:** `docs/superpowers/specs/2026-10-19-kinder-uebersicht-design.md`

## Global Constraints

- UI German, informal "du"; code, identifiers, comments, commits English. No Docker/CI changes. No migration.
- Never run `npm install`/`npm ci`. Never kill processes by image name; stop only processes you started (by PID). Port 3000 is the controller's dev server — use `--port 3100` and a scratch database copy for own checks.
- Branch `claude/children-overview`, started from the finished `claude/meals` (consent keys incl. `signalPhotos`, `insectRepellent`; no `photosWhatsapp`).
- Children: active children of the viewer's facility, filtered with the same group rule as `listChildren` (`seesGroup(viewer.groups, row.groupId)` — own + readable groups; null access = all), ordered like `listChildren` (groups' order, no group last, then name).
- Access: `requireChildReader(` (tablet lock for staff, every device for Leitung/Träger). Print page: Leitung/Träger only, like the existing children print pages (check `app/pages/print/children/birthdays.vue` and its guard).
- Sub-tabs and columns exactly as in spec §2 (order and labels). Consent values: ✓ ja (green), ✗ nein (red), – offen (grey).
- Abholberechtigte = contacts with `mayPickUp && !contactBan`, label „‹Name› (‹Beziehung›)“ (without parentheses when the relation is empty). Kontaktverbot = contacts with `contactBan`, name plus note, red. Notfallkontakte = contacts with `emergencyRank` not null, ascending. Telefonnummern = all contacts in the record's order (`sortOrder`, id) with name, relation and phone home / mobile / work, plus the child's address.
- Child name links to the record when `groupRight(child.groupId, viewer.groups) !== 'none'` (always true for listed children — keep the link).
- Tests: `npx vitest run <file>`; all: `npm test`; types: `npm run typecheck`; build: `npm run build`.

## Review Focus

1. A staff member of group A with read access to B: sees A and B, not C; C's phone numbers and contact bans never reach the client. → Task 1 test.
2. A contact with both „darf abholen“ and Umgangsverbot is never listed as Abholberechtigt. → Task 1 test.
3. A staff member on their own phone (not the tablet) gets the tablet-only refusal (`children_tablet_only`), like the records. → Task 1 test (route/permissions).
4. A child with no contacts / empty health fields: rows render with empty cells, no crash, consents shown as –. → Task 1 test (DTO) and Task 2 (UI).
5. Long texts (allergies, many contacts) stay readable on a tablet in portrait: horizontal scroll inside the table, sticky name column. → Task 2.

---

### Task 1: Overview service and route

**Files:**
- Modify: `server/services/children.ts` (or Create `server/services/childrenOverview.ts` if `children.ts` is too large — follow the file's size), `shared/types/api.ts`
- Create: `server/api/children/overview.get.ts`
- Test: `tests/services/childrenOverview.test.ts`, `tests/api/permissions.test.ts` (route in the child-reader list)

**Interfaces:**
- Produces:
  - `interface OverviewContactDto { name: string; relation: string; phoneHome: string; phoneMobile: string; phoneWork: string; isGuardian: boolean; mayPickUp: boolean; contactBan: boolean; contactBanNote: string; emergencyRank: number | null }`
  - `interface ChildrenOverviewRowDto { id: number; lastName: string; firstName: string; groupId: number | null; address: string; consents: ChildConsents; measlesProof: boolean | null; measlesProofDate: IsoDate | null; infectionBriefingDate: IsoDate | null; allergies: string; mayTakeTemperature: boolean | null; mayApplySunscreen: boolean | null; mayApplyPlaster: boolean | null; contacts: OverviewContactDto[] /* record order */ }`
  - `interface ChildrenOverviewDto { groups: { id: number | null; name: string }[] /* listed children's groups in order, null last with '' */; children: ChildrenOverviewRowDto[] }`
  - `childrenOverview(db: Db, viewer: ChildViewer, today: IsoDate): ChildrenOverviewDto`
  - Route `GET /api/children/overview` → `requireChildReader(`.
- [ ] **Step 1: Failing tests:** Review Focus 1–4 (group filter incl. readable group, contacts of hidden children absent, ban+pickup contact present with flags so the client can exclude it, tablet-only refusal for staff off the tablet via the route/permissions test, empty child); order like `listChildren`; consents/health values copied; inactive (left/planned) children absent.
- [ ] **Step 2: Run** — Expected: FAIL.
- [ ] **Step 3: Implement** (reuse `childStatus`, `seesGroup`, `listOrder`, the consents mapping used by `getChild`).
- [ ] **Step 4: Run** focused files, `npm test`, `npm run typecheck` — Expected: PASS.
- [ ] **Step 5: Commit** `feat: children overview data for the Excel-like tables`.

### Task 2: Overview tab, print page and docs

**Files:**
- Create: `app/utils/childrenOverview.ts` (column definitions per sub-tab: key, short label, full label, cell value function; pure, unit-tested), `app/components/children/OverviewTab.vue`, `app/pages/print/children/overview/[sheet].vue`
- Modify: `app/pages/children/index.vue` (tab „Übersicht“ after „Liste“, for everyone who sees the children tabs), `app/locales/de.ts`, `docs/BETRIEB.md`
- Test: `tests/domain/childrenOverview.test.ts` (or the folder the project uses for pure app utils — check how `app/utils/coverageRuleSections.ts` is tested)

**Interfaces:**
- Consumes: Task 1 `GET /api/children/overview`, `ChildrenOverviewDto`.
- Produces: `OVERVIEW_SHEETS` (`'privacy' | 'messenger' | 'health' | 'pickup' | 'guardians' | 'emergency' | 'phones'`) with labels „Datenschutz“, „Messenger“, „Gesundheit“, „Abholberechtigte“, „Sorgeberechtigte“, „Notfallkontakte“, „Telefonnummern“.
- [ ] **Step 1: Failing tests** for the column helper: privacy columns in spec order with the six consent keys; messenger = `whatsappContact`, `whatsappPhotos`, `signalPhotos`, `whatsappParentGroup`; health order; pickup excludes banned contacts and formats „Name (Beziehung)“; emergency sorted by rank; tri-state → '✓' / '✗' / '–'.
- [ ] **Step 2: Run** — Expected: FAIL.
- [ ] **Step 3: Implement** the helper, the tab (sub-tab buttons like the other tabs, group filter like the list, table with sticky first column and horizontal scroll, header `title` with the full label, ✓ green / ✗ red / – grey, Kontaktverbot red), and the print page (A4 quer, header: facility, sheet, group or „alle Gruppen“, date; print button only for Leitung/Träger, none at the tablet).
- [ ] **Step 4: Docs:** BETRIEB.md: „Übersicht“ (what each sub-tab shows, who sees it, print).
- [ ] **Step 5: Run** `npm test`, `npm run typecheck`, `npm run build`; headless check on port 3100 — Expected: PASS.
- [ ] **Step 6: Commit** `feat: children overview tab with Excel-like sheets and print`.

### Task 3: Controller check (no implementer)

- [ ] On the preview copy: as Berta at the tablet (group Bären, read access to Mäuse) the overview shows Bären and Mäuse children only; each sub-tab; as Träger all children and print of one sheet.
