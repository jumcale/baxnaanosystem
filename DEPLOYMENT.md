# Baxnaano Full-Stack Staging Deployment & Pre-Launch Testing Guide

This guide covers **Option 2: Full-Stack Staging (PWA + Express API + PostgreSQL)** on **Railway** or **Render** so you can test the entire Baxnaano Pharmacy & Veterinary Clinic Management System (offline-first PWA, multi-branch PostgreSQL sync, and role/user isolation) before official launch.

---

## Architecture Overview (Single-Container Full-Stack)

Your project has been configured so a **single deployment** hosts both the frontend PWA and the Express REST/Sync API:
- [`Dockerfile`](Dockerfile): Builds `@baxnaano/shared`, `@baxnaano/server`, and `@baxnaano/client` (`client/dist`), pushes the Prisma database schema (`npx prisma db push`), seeds the initial branches (`B1`, `B2`, `B3`) and staff accounts (`npm run prisma:seed -w server`), and starts the server.
- [`server/src/index.ts`](server/src/index.ts): Serves the `/api/*` endpoints and automatically serves the built React PWA from `client/dist` on the same HTTPS domain (eliminating cross-origin cookie/CORS issues).
- [`railway.json`](railway.json) & [`render.yaml`](render.yaml): Pre-configured deployment manifests for Railway and Render.

---

## Step 1: Push Your Project to GitHub

Both Railway and Render deploy directly from a GitHub repository.

1. Create a new **Private Repository** on [GitHub](https://github.com/new) named `baxnaano-system`.
2. In your project terminal (`c:\Users\jimca\OneDrive\Desktop\Baxnaano`), run:

```powershell
git init
git add .
git commit -m "Prepare Baxnaano full-stack staging deployment"
git branch -M main
git remote add origin https://github.com/<YOUR_GITHUB_USERNAME>/baxnaano-system.git
git push -u origin main
```

---

## Step 2A: Deploy on Railway (Recommended — Fastest Setup)

1. **Sign In**: Go to [https://railway.app](https://railway.app) and sign in with your GitHub account.
2. **Create Project**:
   - Click **New Project** -> **Deploy from GitHub repo** -> select `baxnaano-system`.
3. **Add PostgreSQL Database**:
   - Inside your Railway project canvas, click **+ New** -> **Database** -> **Add PostgreSQL**.
4. **Configure Environment Variables on the App Service**:
   - Click on your `baxnaano-system` service card -> go to the **Variables** tab -> click **+ New Variable** (or **RAW Editor**) and add:
     ```env
     DATABASE_URL=${{Postgres.DATABASE_URL}}
     NODE_ENV=production
     PORT=4000
     JWT_ACCESS_SECRET=baxnaano_staging_access_secret_2026_secure_key
     JWT_REFRESH_SECRET=baxnaano_staging_refresh_secret_2026_secure_key
     ```
5. **Generate Public HTTPS Domain**:
   - Go to the **Settings** tab of your `baxnaano-system` service -> under **Networking / Public Networking**, click **Generate Domain** (e.g., `https://baxnaano-staging.up.railway.app`).
6. **Verify Deployment**:
   - Railway will automatically use [`railway.json`](railway.json) and [`Dockerfile`](Dockerfile) to build the app, initialize PostgreSQL tables, seed the default users, and check `/api/health`.

---

## Step 2B: Deploy on Render (1-Click Blueprint Alternative)

If you prefer **Render.com**, the repository includes [`render.yaml`](render.yaml) which provisions both the Docker web service and PostgreSQL database automatically:

1. **Sign In**: Go to [https://dashboard.render.com](https://dashboard.render.com) and sign in with GitHub.
2. **Create Blueprint Instance**:
   - Click **New +** -> **Blueprint**.
   - Connect your `baxnaano-system` GitHub repository.
   - Render will detect [`render.yaml`](render.yaml), which defines:
     - `baxnaano-db` (Managed PostgreSQL database)
     - `baxnaano-staging` (Docker web service with auto-generated `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`, and wired `DATABASE_URL`).
3. **Apply & Deploy**:
   - Click **Apply**. Render will create the database, build the Docker image, push the Prisma schema, seed initial accounts, and give you an HTTPS URL (`https://baxnaano-staging.onrender.com`).

---

## Step 3: Staging User Accounts for Testing

When the container starts for the first time, [`server/prisma/seed.ts`](server/prisma/seed.ts) automatically creates the 3 branches (`B1`, `B2`, `B3`) and the following accounts (all using password `Password123!`):

| Username | Password | Role | Branch | Access & Data Visibility |
| :--- | :--- | :--- | :--- | :--- |
| `admin` | `Password123!` | `ADMIN` | All (`B1`, `B2`, `B3`) | Full access to all modules & consolidated multi-branch data |
| `manager_b1` | `Password123!` | `BRANCH_MANAGER` | `B1` (Arabsiyo Pharmacy) | Full branch access for `B1` |
| `manager_b2` | `Password123!` | `BRANCH_MANAGER` | `B2` (Arabsiyo Vet) | Full branch access for `B2` |
| `vet_b2` | `Password123!` | `VET_DOCTOR` | `B2` (Arabsiyo Vet) | Dashboard, Sales Point, Quotations, Inventory, Expenses, Credit, Settings — **only sees `vet_b2`'s own activities** |
| `vet_b3` | `Password123!` | `VET_DOCTOR` | `B3` (Gabiley Vet) | Dashboard, Sales Point, Quotations, Inventory, Expenses, Credit, Settings — **only sees `vet_b3`'s own activities** |
| `cashier_b3` | `Password123!` | `CASHIER` | `B3` (Gabiley Vet) | POS & Quotations for `B3` |

---

## Step 4: Pre-Launch Staging Test Checklist

Before launching officially, run through these 6 verification tests on your live staging URL:

### 1. API & Database Health Check
- Open `https://<YOUR_STAGING_URL>/api/health` in your browser.
- Confirm it returns:
  ```json
  { "status": "ok", "service": "baxnaano-api" }
  ```

### 2. Multi-Language & UI Layout Verification
- Open `https://<YOUR_STAGING_URL>` on both a desktop browser and a mobile phone.
- Verify the **Baxnaano BVC** logo appears in the header, browser tab, and login card.
- Verify **English (`EN`)** loads by default and toggling to **Somali (`SO`)** translates all menus without wrapping or overlapping the `BAXNAANO` header title.

### 3. `vet_b2` vs `vet_b3` Strict Activity Isolation Test
1. Sign in as `vet_b2` (`Password123!`).
2. Confirm the sidebar displays only: **Dashboard, Sales Point, Quotations, Expenses, Inventory, Credit, Settings**.
3. Create 1 Product in **Inventory**, record 1 **Sale** (or Credit sale), 1 **Quotation**, and 1 **Expense**.
4. Sign out and sign in as `vet_b3` (`Password123!`).
5. Verify that `vet_b3` **cannot see** any of `vet_b2`'s sales, quotations, inventory items, expenses, or credit records, and vice versa.
6. Sign in as `admin` (`Password123!`) and verify that `admin` can view all branches (`B1`, `B2`, `B3`) and compare performance on the Executive Dashboard.

### 4. Offline-First & Auto-Sync Test
1. While logged in on the staging URL, turn off Wi-Fi / Mobile Data (or toggle **Offline** in Chrome DevTools -> Network).
2. Confirm the sidebar badge changes to **Offline**.
3. Complete a Sale in **Sales Point** and record an **Expense**.
4. Turn Wi-Fi / Mobile Data back on.
5. Click the sync counter button (or wait a few seconds) and confirm the pending sync count returns to `0` (`Online`).

### 5. Exchange Rate & Receipt Printing Test
1. Go to **Settings**, enter a new USD -> SLSH Exchange Rate (e.g., `10200`), and click **Save Settings**.
2. Navigate to **Sales Point** and confirm the SLSH totals immediately reflect the new exchange rate.
3. Complete a sale and click **Print Receipt** in the receipt modal to verify thermal printer / PDF formatting with the Baxnaano logo.

### 6. PWA Installation Test (Desktop & Mobile)
- **Desktop (Chrome / Edge)**: Click the **Install Baxnaano** icon in the address bar and verify it opens as a standalone desktop app window.
- **Android (Chrome)**: Tap **Add to Home Screen / Install App** and verify it launches full-screen with the Baxnaano BVC icon.
- **iOS (Safari)**: Tap **Share -> Add to Home Screen** and verify standalone launch.

