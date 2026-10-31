# Baxnaano ERP — Online-Only System Architecture

## 1. Architectural Philosophy

Baxnaano ERP is an **authoritative, online-only multi-branch enterprise resource planning system** purpose-built for pharmacy and veterinary clinics.

All local-first, offline database synchronization, and IndexedDB data caching have been completely removed. Devices (desktop PCs, laptops, and mobile phones) access an authoritative centralized PostgreSQL database through an Express.js REST API.

```
+--------------------------------------------------------+
|                React 18 + Vite PWA Client               |
|                                                        |
|  - UI State in Memory (React Query / Context)          |
|  - Zero Local Business Data Storage                    |
|  - In-Memory Access Token (No sensitive localStorage)  |
|  - Service Worker Caches Static Assets ONLY            |
+---------------------------+----------------------------+
                            | HTTPS / JSON (Wired to API)
                            v
+--------------------------------------------------------+
|                  Express Backend API                   |
|                                                        |
|  - Fail-fast Zod Configuration (env.ts)                |
|  - Helmet, Structured JSON Logging, CORS Protection    |
|  - Strict Branch Isolation Middleware (enforceBranch)  |
|  - HttpOnly SameSite=Strict Refresh Cookie Session     |
|  - Transactional FEFO Stock & Idempotent UUID Engine   |
+---------------------------+----------------------------+
                            | Prisma ORM
                            v
+--------------------------------------------------------+
|                 PostgreSQL 16 Database                 |
|                                                        |
|  - Single Source of Truth                              |
|  - Multi-Branch Data Partitioned by branchId           |
|  - Ledger-Based Stock Movements (StockMovement)        |
+--------------------------------------------------------+
```

---

## 2. Core Architectural Pillars

### 2.1 Elimination of Offline Divergence
- **Root Cause of Discrepancies**: Previously, devices maintained disconnected Dexie IndexedDB instances that synced asynchronously via a sync queue, causing device-level dashboard discrepancies and inventory ghosting.
- **Resolution**: All business logic and report aggregations are computed directly by the PostgreSQL database.
- **Client Legacy Cleanup**: On boot, `purgeLegacyLocalData()` deletes legacy IndexedDB instances (`BaxnaanoOfflineDB`, `BaxnaanoERP_DB`) and stale authentication tokens from `localStorage`.
- **PWA Service Worker**: Configured with `navigateFallbackDenylist: [/^\/api\//]` and `runtimeCaching: []`, ensuring API responses are never cached by the service worker.

### 2.2 Session Security & Token Architecture
1. **Access Token**:
   - Short-lived JWT (15 minutes).
   - Stored **strictly in memory** via a closure module (`client/src/api/client.ts`).
   - Never written to `localStorage` or `sessionStorage`.
2. **Refresh Token**:
   - Long-lived JWT (7 days).
   - Set as an `HttpOnly`, `SameSite=Strict`, `Secure` (in production) cookie scoped to `/api/auth`.
   - On application load, `AuthContext` calls `POST /api/auth/refresh` to rehydrate the user's session without exposing tokens to JavaScript.
3. **Brute Force Protection**:
   - `/api/auth/login` is rate-limited to 5 failed attempts per 15-minute window keyed on IP and username.
4. **Mandatory First Login Password Change**:
   - New accounts are initialized with random passwords and `mustChangePassword: true`.
   - Unauthenticated or non-reset sessions cannot access ERP functionality until `POST /api/auth/change-password` succeeds.

### 2.3 Strict Multi-Branch Isolation
- Every table carries an immutable `branchId` (`B1` Arabsiyo Pharmacy, `B2` Arabsiyo Vet, `B3` Gabiley Vet).
- The `enforceBranchScope` middleware:
  - Validates that non-admin users only access records belonging to their assigned `branchId`.
  - Rejects cross-branch tampering in query parameters, headers, or body with `403 CROSS_BRANCH_ACCESS_DENIED`.
  - Automatically overwrites `req.body.branchId` with the authenticated user's branch.
  - Allows `ADMIN` users to access individual branches or consolidated (`ALL`) views.

### 2.4 Transactional FEFO Allocation & Ledger Stock
- **Pure FEFO Engine**: `allocateStockFEFO` in `@baxnaano/shared` orders candidate batches by `expiryDate ASC`. Expired batches are blocked from allocation with `EXPIRED_BATCHES_ONLY` or `EXPIRED_BATCH_BLOCKED`.
- **Ledger-Based Accounting**: Batch quantity is not an arbitrary counter; stock changes are recorded as atomic `StockMovement` ledger entries with `quantityDelta`.
- **Idempotency**: All sales accept a client-generated UUID `id`. If a network retry occurs or the user double-clicks checkout, the server detects the existing UUID and returns the authoritative receipt without double-deducting stock or creating duplicate ledger rows.

### 2.5 Multi-Currency & Accounting Precision
- **USD Base**: USD is the canonical accounting base currency.
- **SLSH Handling**: Somaliland Shillings are converted using the active branch exchange rate and rounded to whole integers per local market standard.
- **Credit Aging**: Customer debts are evaluated via FIFO bucket analysis into 0–30 days, 31–60 days, and 60+ days overdue buckets.

### 2.6 Contract Integrity & Response Validation
- Canonical response schemas (`DashboardAnalyticsResponseSchema`, `ReceiptDataSchema`, `ExpenseRecordSchema`, `CustomerAgingSchema`, `ProductItemSchema`) are defined in `@baxnaano/shared`.
- The client validates and parses all incoming payloads through these schemas.
- In development and test modes, the server validates outbound payloads against these schemas to catch contract drift immediately.
