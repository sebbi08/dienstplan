# Dienstplan Kindergarten

Duty-roster web app for a kindergarten (UI in German). Nuxt 4 + SQLite (better-sqlite3, Drizzle ORM).

- Spec: `docs/superpowers/specs/2026-09-30-dienstplan-kindergarten-design.md`
- Operating guide (German): `docs/BETRIEB.md`

## Development

```bash
npm install
cp .env.example .env
npm run dev
```

Open http://localhost:3000 and log in with the admin from `.env`.

```bash
npm test           # unit and service tests
npm run typecheck  # vue-tsc
npm run db:generate  # after changing server/db/schema.ts
```

## Structure

- `shared/domain/` – pure business rules (times, targets, balances, leave, warnings, day overview)
- `server/services/` – use cases on the database, `server/api/` – thin HTTP handlers
- `app/` – pages and components; all German texts in `app/locales/de.ts`
