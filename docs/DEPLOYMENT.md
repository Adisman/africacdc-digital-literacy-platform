# Deployment guide

## 1. Demo / evaluation site (GitHub Pages)

The `pages.yml` workflow publishes `public/` as a static site. It runs in **demo mode** (synthetic, browser-local data). In the repository: *Settings → Pages → Source: GitHub Actions*, then push to `main`.

## 2. Production (Africa CDC data centre)

Requirements: a Linux host with Docker (or Node ≥ 22.5), a DNS name, ports 80/443, and a persistent volume.

```bash
git clone <repo> && cd <repo>
cp .env.example .env            # fill SESSION_SECRET, DB_ENCRYPTION_KEY (openssl rand -hex 32), ADMIN_EMAIL, ADMIN_PASSWORD, DOMAIN, BASE_URL
docker compose up -d --build    # app + Caddy (automatic HTTPS, TLS 1.3, HSTS)
```

First sign-in: use `ADMIN_EMAIL` / `ADMIN_PASSWORD`, enrol an authenticator app, store the recovery codes, choose a new password. Then in **Member States** provision each country, set its status (`provisioned → pilot → live`) and create its first administrator; Member State administrators create facilities, users (or CSV-import) and cohorts.

Without Docker: `NODE_ENV=production SESSION_SECRET=… DB_ENCRYPTION_KEY=… ADMIN_EMAIL=… ADMIN_PASSWORD=… TRUST_PROXY=1 node server/index.js` behind your own TLS proxy.

The server refuses to start in production without both secrets and refuses `DEMO_DATA=1` in production.

## 3. Backup and restore

- Backup: `DATA_DIR=/data node scripts/backup.js` (online, consistent) or *Audit & system → Create backup*. Schedule it with cron and copy off-host.
- Keep `DB_ENCRYPTION_KEY` / `SESSION_SECRET` backed up **separately**: without the key, personal data in a backup is unreadable.
- Restore: stop the app, replace `dlp.sqlite` in the data volume with the backup, start the app.

## 4. Scale and limits

Single-process Node + SQLite comfortably serves a pilot (three Member States, thousands of learners). It has **not been load-tested** at continental scale. For tens of thousands of concurrent learners, plan to swap the storage adapter (`server/store-sqlite.js` implements a small interface) for PostgreSQL and run several app instances behind the proxy.

## 5. Configuration reference

`PORT, HOST, DATA_DIR, SESSION_SECRET, DB_ENCRYPTION_KEY, ADMIN_EMAIL, ADMIN_PASSWORD, BASE_URL, TRUST_PROXY, MFA_REQUIRED_ROLES, DEMO_DATA, ALLOW_LOCAL_KEYS (development only), QUIET`.

## 6. Upgrades

Pull, rebuild (`docker compose up -d --build`). Course content in `content/` is regenerated with `node scripts/build-content.js`; user-authored courses live in the database and are unaffected.
