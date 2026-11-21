# Baxnaano Full-Stack Production & Staging Deployment Guide

This guide covers deploying the **Baxnaano Pharmacy & Veterinary Clinic Management System** (Authoritative Online-Only Multi-Branch PWA + Express API + PostgreSQL) on **Render** or **Railway**.

---

## Architecture Overview (Single-Container Full-Stack)

A single hardened Docker container hosts both the React Vite PWA and the Express REST API:
- [`Dockerfile`](Dockerfile): Multi-stage build using `npm ci`, compiling `@baxnaano/shared`, `@baxnaano/server` (`server/dist/server.cjs`), and `@baxnaano/client` (`client/dist`), and running as non-root `USER node` with production-only dependencies.
- [`server/src/index.ts`](server/src/index.ts): Serves `/api/*` endpoints, `/health` health check, and the built React PWA from `client/dist` on the same HTTPS origin with Helmet CSP, strict CORS, and Gzip/Brotli compression.
- [`render.yaml`](render.yaml) & [`railway.json`](railway.json): Pre-configured deployment manifests both pointing to `/health`.

---

## Step 1: Required Environment Variables (Set in Render / Railway Dashboard)

Never commit `.env` files, JWT secrets, or database passwords to Git. Configure these environment variables directly in the Render or Railway service dashboard:

```env
NODE_ENV=production
PORT=4000
DATABASE_URL=<Managed PostgreSQL Internal/External SSL Connection String>
JWT_ACCESS_SECRET=<Generate a random 64-character hex string: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))">
JWT_REFRESH_SECRET=<Generate a distinct random 64-character hex string: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))">
CORS_ORIGIN=https://baxnaanosystem.onrender.com
```

> **Security Gate**: The server validates `JWT_ACCESS_SECRET` and `JWT_REFRESH_SECRET` at startup and refuses to boot if either secret is shorter than 32 characters, matches a known placeholder, or if both secrets are identical.

---

## Step 2: Database Schema & Initial User Provisioning

1. **Apply Schema Changes Explicitly**:
   Automatic migrations are disabled during container boot to prevent accidental data loss. Run migrations manually from a secure operator workstation before deploying breaking schema changes:
   ```bash
   npx prisma migrate deploy --schema=server/prisma/schema.prisma
   ```
2. **Initial Seeding (Local / First-Time Setup Only)**:
   - [`server/prisma/seed.ts`](server/prisma/seed.ts) refuses to run against remote databases unless explicitly executed locally.
   - It never uses default passwords: it generates cryptographically random 14-character temporary passwords via `crypto.randomBytes`, hashes them with `bcrypt` (cost factor 12), prints them once to stdout, and sets `mustChangePassword: true` (enforced server-side on every API route until the user sets a new permanent password).

| Username | Role | Branch | Access & Data Visibility |
| :--- | :--- | :--- | :--- |
| `admin` | `ADMIN` | All (`B1`, `B2`, `B3`) | Full access to all modules, user management, exchange rates, & consolidated multi-branch reports |
| `manager_b1` | `BRANCH_MANAGER` | `B1` (Arabsiyo Pharmacy) | Full branch operations & reporting for `B1` |
| `vet_b2` | `VET_OFFICER` | `B2` (Arabsiyo Vet) | Dashboard, Sales Point, Quotations, Inventory, Expenses, Credit, Settings — **strictly scoped to `B2` and own sales/quotations/expenses** |
| `vet_b3` | `VET_OFFICER` | `B3` (Gabiley Vet) | Dashboard, Sales Point, Quotations, Inventory, Expenses, Credit, Settings — **strictly scoped to `B3` and own sales/quotations/expenses** |

---

## Step 3: Post-Deployment Verification Checklist

1. **Unauthenticated Health Check**:
   - Open `https://baxnaanosystem.onrender.com/health`
   - Confirm it returns `{"status":"ok"}` with `200 OK` and exposes no internal metadata.
2. **Forced Password Reset Enforcement**:
   - Sign in with a newly created or reset user (`mustChangePassword: true`).
   - Confirm the server blocks all module API calls with `403 PASSWORD_CHANGE_REQUIRED` until `/api/auth/change-password` completes.
3. **Multi-Branch & Role Isolation Verification (`vet_b2` vs `vet_b3`)**:
   - Sign in as `vet_b2` (`B2`) and verify that passing `?branchId=B3` or `x-branch-id: B3` is rejected with `403 CROSS_BRANCH_ACCESS_DENIED`.
   - Verify that only `admin` can view all branches (`ALL`), manage users, or modify the USD/SLSH exchange rate.
4. **Online-Only Storage Hygiene**:
   - Open Chrome DevTools -> Application -> Local Storage / Session Storage / IndexedDB.
   - Confirm **zero** JWT tokens, user profiles, or financial records are stored in `localStorage`, `sessionStorage`, or IndexedDB, and the Service Worker never caches `/api/*` responses.
