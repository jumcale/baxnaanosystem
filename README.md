<p align="center">
  <img src="client/public/baxnaano-logo.jpg" alt="Baxnaano Logo" width="110" />
</p>

# Baxnaano Pharmacy & Veterinary Clinic Management System

Production-ready, **Authoritative Online-Only Multi-Branch PWA** built for **Baxnaano Pharmacy & Veterinary Clinic** across Somaliland:

| Branch ID | Branch Name | Type | Location |
| :--- | :--- | :--- | :--- |
| **`B1`** | **Baxnaano Pharmacy** | Human Health (`PHARMACY`) | **Arabsiyo** |
| **`B2`** | **Baxnaano Veterinary** | Livestock Health (`VETERINARY`) | **Arabsiyo** |
| **`B3`** | **Baxnaano Veterinary** | Livestock Health (`VETERINARY`) | **Gabiley** |

---

## Key Architecture Highlights

1. **Authoritative Online-Only Client-Server Architecture**:
   - Zero local-first business data caching or IndexedDB replication. All reads and mutations hit the authoritative Express API and PostgreSQL database.
   - PWA remains installable for quick launch, but service worker caches strictly static application shell assets (`js`, `css`, `html`, `svg`), never `/api/` endpoints.
   - Persistent online connectivity indicator and top banner pause mutation buttons when offline to guarantee data integrity across devices.
2. **Strict Multi-Branch Isolation & Admin Consolidated Scope**:
   - Every domain record carries an immutable `branchId`.
   - Branch users (`Branch Manager`, `Cashier`, `Pharmacist`, `Vet Officer`) are strictly locked to their own branch (`B1`, `B2`, or `B3`) via server middleware (`enforceBranchScope`), rejecting any cross-branch tampering attempts with `403 CROSS_BRANCH_ACCESS_DENIED`.
   - `Admin` users can view consolidated data across **All Branches (`ALL`)**, filter by individual branch, and compare branches side-by-side.
3. **FEFO (First Expiry, First Out) & Stock Allocation**:
   - Shared pure allocator (`shared/src/inventory.ts`) and database transactions allocate stock from earliest expiring batches first and strictly reject expired batches.
   - Ledger-based stock movements (`StockMovement`) track every unit delta with idempotent client-generated UUIDs preventing double-submits.
4. **Dual Currency (`USD` & `SLSH`) & Split Payments**:
   - Supports **Cash**, **EVC Plus**, **Zaad**, **eDahab**, and **Customer Credit** in `USD` or `SLSH` with configurable exchange rates and thermal/PDF receipts.
5. **Hardened Security & Session Management**:
   - Short-lived JWT access tokens stored **in memory only** (never in `localStorage`).
   - Long-lived session rehydration via `HttpOnly`, `SameSite=Strict` refresh cookies.
   - Login rate-limiting and mandatory temporary password reset on first login (`mustChangePassword: true`).
6. **Bilingual Interface (`English` Primary & `Af-Soomaali` Secondary)**:
   - Every string is powered by `i18next` with English (`en`) as the primary default language and instant switching to Somali (`so`).

---

## Quick Start (Local Development)

### 1. Prerequisites
- **Node.js** 20+
- **PostgreSQL** 15+ running locally on port `5432` (or Docker Desktop)

### 2. Configure Environment
```bash
cp .env.example .env
```

Set valid secrets in `.env`:
- `JWT_ACCESS_SECRET` (≥ 32 characters)
- `JWT_REFRESH_SECRET` (≥ 32 characters)
- `CORS_ORIGIN` (e.g. `http://localhost:5173`)
- `DATABASE_URL` (points to local postgres)

### 3. Install Dependencies & Generate Prisma Client
```bash
npm install
npm run db:generate
```

### 4. Run Database Migrations & Seed Sample Data
```bash
npm run db:migrate
npm run db:seed
```
*Note: Seeding generates random temporary passwords printed once in the console table. All accounts require password change on first login.*

### 5. Start Development Servers (Backend + PWA Frontend)
```bash
npm run dev
```
- **PWA Frontend**: `http://localhost:5173`
- **Express API**: `http://localhost:4000/api`

---

## Running Unit & Integration Tests

```bash
npm test
```

## Production Docker Deployment

```bash
docker compose up --build -d
```
