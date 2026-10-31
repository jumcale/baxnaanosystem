<p align="center">
  <img src="client/public/baxnaano-logo.jpg" alt="Baxnaano Logo" width="110" />
</p>

# Baxnaano Pharmacy & Veterinary Clinic Management System

Production-ready, **Offline-First Multi-Branch PWA** built for **Baxnaano Pharmacy & Veterinary Clinic** across Somaliland:

| Branch ID | Branch Name | Type | Location |
| :--- | :--- | :--- | :--- |
| **`B1`** | **Baxnaano Pharmacy** | Human Health (`PHARMACY`) | **Arabsiyo** |
| **`B2`** | **Baxnaano Veterinary** | Livestock Health (`VETERINARY`) | **Arabsiyo** |
| **`B3`** | **Baxnaano Veterinary** | Livestock Health (`VETERINARY`) | **Gabiley** |

---

## Key Architecture Highlights

1. **Strict Multi-Branch Isolation & Admin Consolidated Scope**:
   - Every table carries `branchId`.
   - Branch users (`Branch Manager`, `Cashier`, `Pharmacist`, `Vet Officer`) are strictly locked to their own branch (`B1`, `B2`, or `B3`) in both the API middleware and local IndexedDB.
   - `Admin` users can view consolidated data across **All Branches (`ALL`)**, filter by individual branch, and compare branches side-by-side.
2. **Offline-First IndexedDB (Dexie) + Background Sync Queue**:
   - All writes go to local IndexedDB first (`client/src/db/dexie.ts`), then enqueue into `syncQueue` with exponential backoff + jitter (`client/src/services/sync.engine.ts`).
   - **Ledger-Based Stock**: Stock is never overwritten during sync conflicts; batch stock is always computed as `SUM(quantityDelta)` from `StockMovement`.
3. **FEFO (First Expiry, First Out) & Expired Batch Blocking**:
   - Shared pure allocator (`shared/src/inventory.ts`) automatically deducts from the earliest expiring batch and strictly blocks expired batches.
4. **Dual Currency (`USD` & `SLSH`) & Split Payments**:
   - Supports **Cash**, **EVC Plus**, **Zaad**, **eDahab**, and **Customer Credit** in `USD` or `SLSH` with configurable exchange rates and **58mm / 80mm thermal & PDF receipts**.
5. **Bilingual Interface (`English` Primary & `Af-Soomaali` Secondary)**:
   - Every string is powered by `i18next` (`client/src/i18n/index.ts`) with English (`en`) as the primary default language and instant switching to Somali (`so`).

---

## Quick Start (Local Development)

### 1. Prerequisites
- **Node.js** 20+
- **PostgreSQL** 15+ running locally on port `5432` (or Docker Desktop)

### 2. Configure Environment
```bash
cp .env.example .env
```

On Windows, copy `.env.example` to `.env` in File Explorer or PowerShell. The Prisma
commands and server both load this root `.env` file.

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

### 5. Start Development Servers (Backend + PWA Frontend)
```bash
npm run dev
```
- **PWA Frontend**: `http://localhost:5173`
- **Express API**: `http://localhost:4000/api`

---

## Default Seeded Accounts (Password: `Password123!`)

| Username | Role | Branch Scope |
| :--- | :--- | :--- |
| `admin` | `ADMIN` | All Branches (`B1`, `B2`, `B3` + Consolidated `ALL`) |
| `manager_b1` | `BRANCH_MANAGER` | `B1` — Baxnaano Pharmacy (Arabsiyo) |
| `manager_b2` | `BRANCH_MANAGER` | `B2` — Baxnaano Veterinary (Arabsiyo) |
| `vet_b2` | `VET_OFFICER` | `B2` — Baxnaano Veterinary (Arabsiyo) — Isolated User & Branch Scope |
| `vet_b3` | `VET_OFFICER` | `B3` — Baxnaano Veterinary (Gabiley) — Isolated User & Branch Scope |
| `cashier_b3` | `CASHIER` | `B3` — Baxnaano Veterinary (Gabiley) |

---

## Running Unit & Integration Tests

```bash
npm test
```

## Production Docker Deployment

```bash
docker compose up --build -d
```
