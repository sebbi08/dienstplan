# Rechte und Rollen, Teil 3 (Rolle Gruppenleitung) – Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A new account role „Gruppenleitung“ whose rights the Träger sets on the rights page like Leitung and Mitarbeiter; by default Mitarbeiter rights plus „Kinder eintragen“ (own group) with the own account.

**Architecture:** Role value `group_lead` in the users table and the `Role` type; bundle defaults for it in `shared/domain/permissionBundles.ts`; everywhere the code distinguishes roles for management rules (users, rights, PINs, tablet, nav) the new role sits between Leitung and Mitarbeiter; rights page gets a third column.

**Tech Stack:** Nuxt 4, Nitro, drizzle-orm + better-sqlite3, Nuxt UI 4, Vitest.

**Spec:** `docs/superpowers/specs/2026-10-27-rechte-und-rollen-design.md` §6 (Teil 3); Teil 2 spec `2026-10-28-rechte-teil2-design.md`.

## Global Constraints

- Role id `group_lead`, German label „Gruppenleitung“. Linked to an employee like Leitung/Mitarbeiter (an account without employee is refused like for Mitarbeiter today, if that is the rule — mirror the observer rules).
- Default bundles = observer defaults + `childrenEdit` (scope 'group') + `childrenOwnAccount` (so „Kinder“ appears in the menu with the own account) — scope of `childrenView` / `childrenAttendance` stays 'group'. Everything else configurable on the rights page (third column) and per person.
- Management rules: the Träger manages all; the Leitung manages group_lead accounts like observer accounts (create, edit, reset, deactivate, PIN, the childrenEdit exception — for group_lead the exception is moot because the role has it; the Leitung may NOT change any other right); a group_lead account never manages admin/provider accounts; with usersManage granted it manages only terminal accounts (like a Mitarbeiter). Own-account rules as for non-Träger.
- Tablet: a person whose linked active account is group_lead gets that account's rights (as for other accounts). Nav/menus purely by permissions (office layout appears as soon as office keys are held).
- Migration: if the users.role column has a CHECK constraint, rebuild it; otherwise no migration needed (drizzle enum is TS-only) — verify. The route-access fixture gains the actor `group_lead` only if the snapshot model requires every role — regenerate per the script docs and verify the diff only adds group_lead where its defaults allow.
- UI German, informal „du“; no new npm dependencies; never npm install/npx downloads; never read outside `C:\Users\schad\Code`.
- Tests: `npx vitest run <file>`; all `npm test`; `npm run typecheck`; `npm run build`; `node scripts/route-access-snapshot.mjs --check`.

## Review Focus

1. A group_lead with defaults: edits children of the own group (office and tablet), reads only own group (+ read-access groups), can't edit other groups; sees „Kinder“ in the menu; everything else as a Mitarbeiter (Task 1 tests).
2. Changing the group_lead column on the rights page affects all group_lead accounts; exceptions per person work (Task 1 + 2).
3. Leitung creates/edits/resets a group_lead account of its facility; a group_lead can't promote itself or manage Leitung/Mitarbeiter accounts (Task 1 tests).
4. Existing roles unchanged (route fixture for existing actors identical) (Task 1).
5. Users page and Zugang tab offer „Gruppenleitung“ where allowed; rights page shows three columns, phone view picks among three roles (Task 2 + controller check).

---

### Task 1: Server

**Files:** `shared/types/api.ts` (Role), `server/db/schema.ts` (+ migration if needed), `shared/domain/roles.ts` (manageableRoles, accountLock), `shared/domain/permissionBundles.ts` (BUNDLE_DEFAULTS group_lead, RightsRole), `server/services/rights.ts`, `server/services/users.ts`, `server/services/tabletUnlock.ts`, anything else that switches on role (grep `'observer'`), route snapshot model/fixture, tests.

- [ ] Failing tests RF1, RF3, RF4 → implement → commit `feat: Gruppenleitung role`.

### Task 2: Client and docs

**Files:** users page + AccessSection (role select „Gruppenleitung“), rights page third column (+ phone role picker), RightsTable overview, labels in de.ts, nav tests (group_lead defaults show „Kinder“), docs/BETRIEB.md (Rechte und Rollen: Gruppenleitung).

- [ ] `npm test`, typecheck, build → commit `feat: Gruppenleitung in the pages`.

### Task 3: Controller check (no implementer)

- [ ] Scratch copy: create a group_lead account for an employee with a group; log in as it (or check via rights API + screenshots as Träger); rights page three columns; Leitung view.
