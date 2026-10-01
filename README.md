# Elevate Skills – Past Exam Papers Portal

Two repos: this backend repo and the Angular frontend repo (`examplusfrontend`). Angular 22 (frontend) + Node.js/Express (backend) + MySQL (managed with phpMyAdmin), built for cPanel hosting.
The backend serves the compiled Angular app, so cPanel only runs **one** Node.js application.

```
backend/    Express API, admin API, DPO integration, protected file streaming, serves ./public
frontend/   Angular app (browse, checkout, My Papers, protected viewer, admin dashboard)
database/   schema.sql  (import through phpMyAdmin)
```

## Run locally
1. Create a MySQL DB `exam_portal` and import `database/schema.sql` (XAMPP phpMyAdmin works).
2. `backend/.env` (copy `.env.example`), then:
   ```
   cd backend && npm install && npm run seed && npm start      # http://localhost:3000
   ```
3. After frontend changes, rebuild with `npm run build:front` from `backend/` and restart the server.

Local admin login (from `.env`): `ADMIN_EMAIL` / `ADMIN_PASSWORD`. Change both before going live.

## Deploy on cPanel
1. **Build locally**: `cd backend && npm run build:front` – creates `backend/public` (the Angular app).
2. **Database**: cPanel → *MySQL Databases*: create a DB + user, add user to DB with all privileges.
   phpMyAdmin → select the DB → *Import* → `database/schema.sql`.
3. **Upload** the `backend/` folder (including `public/`, excluding `node_modules`, `.env`, `storage/papers/*`) to e.g. `~/exam-portal`
   (File Manager or zip + extract).
4. cPanel → **Setup Node.js App** → *Create Application*: Node version 18+ (20/22 preferred), mode *Production*,
   application root `exam-portal`, application URL = your (sub)domain (e.g. `exams.elevateskills.online`),
   startup file `app.js`.
5. In that screen add **environment variables** (or create `.env` in the app root) – see `.env.example`:
   `APP_URL` (https URL of the portal), `JWT_SECRET` (long random), `DB_HOST=localhost`, `DB_USER`, `DB_PASSWORD`, `DB_NAME`,
   `ADMIN_EMAIL`, `ADMIN_PASSWORD`, and the DPO values below.
6. Click **Run NPM Install**, then run `npm run seed` once (button "Run JS script" or the terminal shown in the app page) to create the admin.
   Restart the app.
7. Make sure `storage/papers` is writable (default permissions are fine). It sits **outside** the public folder; PDFs are only served
   through `/api/papers/:id/file` after an entitlement check.

## DPO payments
- Without `DPO_COMPANY_TOKEN` the portal uses a **mock gateway** (a page with "Simulate successful payment"). **Never leave this on in production** –
  set the DPO values below.
- Set `DPO_COMPANY_TOKEN` and `DPO_SERVICE_TYPE` (from your DPO merchant account). `DPO_API_URL`/`DPO_PAY_URL` default to the live DPO v6 endpoints.
- Flow: order created (`pending`) → DPO `createToken` → learner redirected to DPO → DPO redirects to `/api/payments/return` → the server calls
  DPO `verifyToken` and only then marks the order `paid` and grants access. Failed/cancelled orders stay unpaid. `dpo_token` and `dpo_trans_ref`
  are stored and visible in Admin → orders.
- Ask DPO to whitelist your redirect/back URLs (`APP_URL/api/payments/return`, `APP_URL/api/payments/cancel`) and confirm the currency (default BWP, editable in Admin → settings).
  Verify the exact field/response handling against DPO's current docs and test in their sandbox before launch (I could not test against live DPO here).

## Admin (`/admin`)
Sidebar sections: **Dashboard**, **Exam papers** (drag-and-drop upload of many PDFs, edit, replace file, preview, hide/delete),
**Qualifications & subjects**, **Prices & specials** (regular price per paper/subject/qualification bundle, per-item special price with start/end dates,
bulk "X% off" specials by qualification/subject/type, end all specials), **Voucher codes** (percent or fixed, minimum spend, total and per-learner limits,
single-product restriction, start/expiry), **Orders** (status, voucher, DPO reference), **Learners & access** (grant/revoke), **Settings** (currency), **Activity log**.
Items with no price (0) are not for sale, so new subjects/qualifications are created unpriced. Learners buy through a checkout page where they can enter a voucher;
a voucher that covers the full price grants access without going to DPO. Existing installs from the first schema: run `cd backend && npm run migrate`.

## Notes / limits
- The viewer renders PDFs to canvases with the learner's email as a watermark, blocks right-click/print/save shortcuts and offers no download.
  As the proposal says, this deters casual copying but cannot prevent screenshots or photographs.
- Passwords are bcrypt-hashed; login/register are rate limited; JWT lasts 7 days.
- DB driver is `mysql2` (the Node equivalent of PHP's mysqli) connecting to the same MySQL database phpMyAdmin manages.

## CI/CD
Pushing to `main` builds and deploys to cPanel over SSH. Setup guide: [docs/CICD.md](docs/CICD.md).
