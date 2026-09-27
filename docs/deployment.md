# Report Mate — Deployment (AWS Lightsail)

The backend is a single Go binary that serves **both** the JSON API and the
built React app on one origin. That keeps the session cookie same-origin and
means there is one process to run. Target per steering: a Lightsail instance for
the binary + Lightsail-managed PostgreSQL. The shared ~$100 pool covers hosting
**and** LLM calls — keep the instance small.

## 1. Build the release (on your machine)

```bash
./scripts/build-release.sh
```

Produces `release/`:
- `reportmate-server`   Go binary, Linux amd64 (override with `GOARCH=arm64` for an ARM Lightsail plan)
- `web/`                the built frontend (VITE_AUTH_MODE=api baked in)
- `.env.production.example`  the env template

## 2. Provision Lightsail (spends from the shared pool — confirm with the team)

1. **Managed PostgreSQL**: create a Lightsail managed database (PostgreSQL).
   Note its endpoint, port, user, password, db name. This is the `DATABASE_URL`.
2. **Instance**: create a small Lightsail instance (Ubuntu). Open the firewall
   for HTTP/HTTPS (or the port you run behind a proxy).

## 3. Ship and configure

```bash
# from your machine
scp -r release/* ubuntu@INSTANCE_IP:/opt/reportmate/
```

On the instance:
```bash
cd /opt/reportmate
cp .env.production.example .env
# edit .env:
#   DATABASE_URL   -> the managed Postgres endpoint (sslmode=require)
#   JWT_SIGNING_KEY-> openssl rand -base64 48   (REQUIRED in production)
#   LLM_GATEWAY_API_KEY -> the team key
#   STATIC_DIR     -> /opt/reportmate/web
#   EXPORT_DIR     -> /opt/reportmate/exports   (mkdir -p it)
mkdir -p /opt/reportmate/exports
```

## 4. Run it (systemd, survives reboots)

`/etc/systemd/system/reportmate.service`:
```ini
[Unit]
Description=Report Mate
After=network.target

[Service]
WorkingDirectory=/opt/reportmate
EnvironmentFile=/opt/reportmate/.env
ExecStart=/opt/reportmate/reportmate-server
Restart=on-failure
User=ubuntu

[Install]
WantedBy=multi-user.target
```
```bash
sudo systemctl daemon-reload
sudo systemctl enable --now reportmate
sudo journalctl -u reportmate -f      # watch startup: migrations + "listening"
```

Migrations run automatically on boot (embedded). The server refuses to start if
`DATABASE_URL` is missing.

## 5. Seed the first admin account

The new auth flow registers accounts against an authorization code; there is no
auto-seeded dispatcher in production. Generate an admin code, then register
through the app's registration page. See `backend/db/migrations/README.md` /
`cmd/devseed` for the code-generation path, or create a code row directly in the
managed DB.

## 6. TLS / domain (recommended)

Put the instance behind HTTPS. Either terminate TLS at a reverse proxy (Caddy or
nginx) in front of `:8080`, or use a Lightsail load balancer with a certificate.
Production session cookies are already `Secure` (set automatically when
`ENV=production`), so they require HTTPS to be sent by the browser.

## Notes / gotchas
- `ENV=production` makes cookies `Secure` — the app must be served over HTTPS or
  logins won't stick.
- The LLM key is backend-only; it is never in the frontend bundle. If the
  gateway is unconfigured the agent degrades to 503 and manual fill still works.
- Photos/signatures are inline base64 today, so report bodies can be large
  (32 MB cap). Fine for the hackathon; revisit with object storage later.
