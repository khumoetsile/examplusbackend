# CI/CD: GitHub → cPanel

The project is two GitHub repositories that deploy into the **same** cPanel Node.js app:

| Repo | Pipeline does | Lands in |
|---|---|---|
| `examplusbackend` | syntax check, rsync, `npm ci`, database migrations, restart | `APP_DIR/` (app.js, src/, database/…) |
| `examplusfrontend` | builds the Angular app and rsyncs it | `APP_DIR/public/` |

Pushing to `main` in either repo deploys that part. Pull requests only run the build/check job.
**Never overwritten:** `.env`, `storage/` (uploaded PDFs), `node_modules/`, `tmp/`. The backend deploy never touches `public/`.

## One-time setup

### 1. cPanel app (first deploy is manual, see README "Deploy on cPanel")
Create the Node.js app, the database, and `.env` on the server once. Note these values:
- **App directory**, e.g. `/home/CPANELUSER/exam-portal` (the *Application root* in Setup Node.js App).
- **Activate line** shown at the top of the Node.js App page, e.g. `source /home/CPANELUSER/nodevenv/exam-portal/22/bin/activate`.

### 2. SSH key for GitHub
On your computer (or the cPanel Terminal):
```bash
ssh-keygen -t ed25519 -f deploy_key -C "github-actions-deploy" -N ""
```
- cPanel → **Security → SSH Access → Import Key**: import `deploy_key.pub` as the public key, then **Manage → Authorize** it.
  (If SSH Access is missing, ask the host to enable SSH for the account.)
- Keep `deploy_key` (private) for the GitHub secret below. Do not commit either file.

### 3. Server host key
```bash
ssh-keyscan -p 22 your-server.example.com
```
Save the output; it goes in the `SSH_KNOWN_HOSTS` secret (this makes GitHub verify it is talking to your server).

### 4. GitHub secrets
**Add these in BOTH repos** (the frontend repo does not need `NODE_ACTIVATE`). Repo → **Settings → Secrets and variables → Actions → New repository secret**:

| Secret | Example |
|---|---|
| `SSH_HOST` | `your-server.example.com` |
| `SSH_PORT` | `22` (or the port your host uses) |
| `SSH_USER` | your cPanel username |
| `SSH_PRIVATE_KEY` | full contents of `deploy_key` |
| `SSH_KNOWN_HOSTS` | output of `ssh-keyscan` |
| `APP_DIR` | `/home/CPANELUSER/exam-portal` |
| `NODE_ACTIVATE` | `source /home/CPANELUSER/nodevenv/exam-portal/22/bin/activate` |

Optional **variable** (Variables tab): `SITE_URL` = `https://exams.elevateskills.online` to enable the smoke test.

### 5. Optional safeguards
- **Settings → Environments → production**: add yourself as a required reviewer to approve every deploy.
- **Settings → Branches**: protect `main` and require the *Build* check on pull requests.

## Day to day
```bash
git push origin main      # builds and deploys automatically
```
Re-run or trigger by hand from the **Actions** tab (*Run workflow*).

## Database changes
Fresh installs import `database/schema.sql`. For changes after launch, add a numbered file such as
`database/migrations/002_add_something.sql` (also update `schema.sql`). The pipeline runs new files once, in order,
and records them in the `schema_migrations` table. Check locally with `cd backend && npm run migrate`.

## Rolling back
Re-run the workflow on an earlier commit (Actions → pick the old successful run → *Re-run all jobs*), or `git revert` and push.
Migrations are not undone automatically, so write them to be backward compatible.

## Troubleshooting
- **Permission denied (publickey)**: key not authorised in cPanel SSH Access, or the private key secret is incomplete.
- **Host key verification failed**: regenerate `SSH_KNOWN_HOSTS` with the right host and port.
- **`npm: command not found` on the server**: `NODE_ACTIVATE` path is wrong; copy it from the Node.js App page.
- **Site shows old version**: confirm `tmp/restart.txt` was touched, or press *Restart* in Setup Node.js App.
- **Smoke test fails**: check the app's `stderr.log` in the app directory.
