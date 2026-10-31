# Baxnaano ERP — Online-Only Hardening & Refinement Changelog

## Summary of Changes
Complete transition of Baxnaano Pharmacy & Veterinary Clinic Management System from an offline-first hybrid model to an authoritative, online-only multi-branch architecture.

---

## 1. Deleted Offline Files & Modules

### Client-Side Deletions (3,936 Lines of Code Removed)
- `client/src/db/dexie.ts` (Dexie database initialization, table schemas, and offline indexes)
- `client/src/services/sales.offline.ts` (IndexedDB POS queue and offline sale persistence)
- `client/src/services/inventory.offline.ts` (IndexedDB product/batch cache)
- `client/src/services/finance.offline.ts` (IndexedDB expense and customer credit records)
- `client/src/services/appointments.offline.ts` (IndexedDB clinical appointment queue)
- `client/src/services/reports.offline.ts` (IndexedDB client-side report rollups)
- `client/src/services/settings.offline.ts` (IndexedDB local branch settings cache)
- `client/src/services/seed.offline.ts` (Offline dummy mock data seeder)

### Server-Side Deletions
- `server/src/routes/sync.routes.ts` (`POST /api/sync/push`, `GET /api/sync/pull`)
- Unsafe endpoint `POST /api/auth/offline-exchange` in `server/src/routes/auth.routes.ts`
- Automatic dummy stock fabrication bypass in `server/src/routes/sales.routes.ts` (`allowNegativeInOfflineSync`)

---

## 2. Removed Dependencies
- `dexie` (removed from `client/package.json`)
- `dexie-react-hooks` (removed from `client/package.json`)

---

## 3. Database Schema & Migration Additions
- **Baseline Migration**: Generated baseline migration `0_init` representing initial PostgreSQL schema:
  `server/prisma/migrations/0_init/migration.sql`
- **User Security Migration**: `20261031_add_must_change_password`:
  Added `mustChangePassword Boolean @default(false)` to `User` model.
- **SyncQueue Table**: Retained in `schema.prisma` for zero-downtime Release A (all code references purged); scheduled for dropping in Release B migration.

---

## 4. Contract Integrity Fixes
- **Dashboard Discrepancy Fix**: Fixed field misalignment where server returned `{ kpis: { ... }, alerts: { ... } }` and client was querying `res.kpi`.
- **Shared Response Schemas**:
  - `shared/src/reports.ts`: `DashboardAnalyticsResponseSchema`, `ComprehensiveReportResponseSchema`
  - `shared/src/sales.ts`: `ReceiptDataSchema`
  - `shared/src/finance.ts`: `ExpenseRecordSchema`, `CustomerAgingSchema`
  - `shared/src/inventory.ts`: `BatchItemSchema`, `ProductItemSchema`
- **Client Parsing**: All client APIs (`sales.api.ts`, `inventory.api.ts`, `expenses.api.ts`, `credit.api.ts`, `reports.api.ts`) parse responses with shared Zod schemas.

---

## 5. Security & Authentication Hardening
- **Fail-Fast Environment Config**: Created `server/src/config/env.ts` validating all critical secrets (`JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`, `CORS_ORIGIN`, `DATABASE_URL`) on server boot using Zod.
- **In-Memory Access Tokens**: Access token stored in memory closure; removed all JWT storage in `localStorage`.
- **HttpOnly Refresh Cookies**: Scoped to `/api/auth` with `HttpOnly`, `SameSite=Strict`, and `Secure` (production).
- **Brute Force Protection**: Rate-limiting on `/api/auth/login` (5 attempts / 15 minutes per IP + username).
- **Default Credential Elimination**: Replaced static `Password123!` in `seed.ts` with random temporary passwords printed once to the console.
- **Database Safety Guard**: Added check in `seed.ts` and `setup.ts` preventing destructive operations against non-localhost databases.

---

## 6. Deployment & Runtime Hardening
- **Dockerfile**:
  - Removed container startup database pushes and migrations (`CMD ["npm", "run", "start", "-w", "server"]`).
  - Added Docker `HEALTHCHECK` with `wget -qO- http://localhost:4000/api/health`.
- **Structured Request Logging**: Created `server/src/middleware/logger.ts` outputting JSON access logs with automatic redaction of passwords, tokens, cookies, and secret keys.
- **GitHub Actions CI**: Created `.github/workflows/ci.yml` verifying lint, typechecking, tests against PostgreSQL 16 container, and client build.

