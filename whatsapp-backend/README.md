# PG Builders — WhatsApp Automation Companion Server

This is a lightweight Node.js Express server that acts as a custom gateway between your **PG Builders** dashboard and your personal WhatsApp account.

Using **whatsapp-web.js** (an open-source client), it runs a headless browser to maintain your WhatsApp Web connection and auto-send rent invoice reminders to tenants.

---

## Prerequisite Setup

### 1. Database Migration
Make sure you have executed the database migration from [supabase-migration-v31.sql](../supabase-migration-v31.sql) in your **Supabase SQL Editor**.

### 2. Configure Environment Variables
Create a file named `.env` in this directory (`whatsapp-backend/.env`) and populate it with your Supabase credentials:

```env
PORT=3001
SUPABASE_URL=https://your-supabase-url.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your-supabase-service-role-key
```

> [!IMPORTANT]
> Use the **service_role** API key (not the anon key) in `SUPABASE_SERVICE_ROLE_KEY`. This is required to let the background scheduler read/write tables bypass RLS policies. Keep this key secure.

---

## How to Install & Run

### Method A: Centralized Cloud Deployment (Recommended for Production)
To make the system work for **all landlords (multi-tenant)** without requiring them to install anything on their computer or mobile:
1. Push this directory to **GitHub**.
2. Deploy to a cloud service that supports Docker and persistent volumes (e.g., **Railway**, **Render**, or a **VPS**).
3. We have included a `Dockerfile` which automatically installs Node.js and the Chromium/Chrome packages needed for Puppeteer.
4. Set up a **Persistent Volume Mount** at `/app/.wwebjs_auth` so session files remain saved across server restarts.
5. In the Owner Dashboard, change the **WhatsApp Server URL** settings to your public HTTPS URL (e.g., `https://wa-api.pgbuilderss.online`).
6. Landlords can now scan the QR code directly from their mobile or PC, and it links permanently.

### Method B: Local Running (For Development & Testing)
1. Open your terminal in the `whatsapp-backend` folder.
2. Run `npm install` to download dependencies:
   ```bash
   npm install
   ```
3. Start the server:
   ```bash
   npm start
   ```
The gateway server is now running on `http://localhost:3001`.

---

## How it works

1. **Dashboard Linking**: Once the server is running (locally or in the cloud), log into your Owner Dashboard, select the **WhatsApp Automation** tab, enter the server URL (e.g., `https://wa-api.pgbuilderss.online`), and click **Save Settings**. Scan the QR code using your phone's WhatsApp (Linked Devices).
2. **Auto Reminder cron job**: Every day at **9:00 AM**, the server automatically checks the database for unpaid rents, calculates the due date based on the tenant's join date, and sends reminders if they are exactly `X` days (offset) away from due.
3. **Session Persistence**: Linked session data is stored in the `.wwebjs_auth/<ownerId>` folder. As long as this folder is preserved (on a persistent disk volume in the cloud), sessions stay connected.

