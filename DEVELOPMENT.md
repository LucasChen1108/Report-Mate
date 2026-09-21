# Running Report Mate locally

Everything you need to go from a fresh clone to a working app: a Postgres
database, the Go API, the React dev server, and both test suites.

If you only read one thing, read [Quick start](#quick-start). The rest explains
what those commands are doing and what to do when one of them fails.

---

## Prerequisites

| Tool | Version | Notes |
| --- | --- | --- |
| Go | 1.26+ | `backend/go.mod` declares `go 1.26.0` |
| Node | 20+ | built and tested on 22.x |
| npm | 10+ | ships with Node |
| PostgreSQL | 14+ | 16 is what CI and the seeds are exercised against |

Docker is optional but is the easiest way to get Postgres — see below.

---

## Quick start

Four terminals' worth of commands, in order. Run them from the repository root.

```bash
# 1. Postgres. Any 14+ server will do; this is the zero-setup option.
#    THIS IS A ONE-TIME COMMAND — `docker run` CREATES the container. On every
#    later day, use `docker start reportmate-db` instead (see below).
docker run -d --name reportmate-db \
  -e POSTGRES_USER=reportmate \
  -e POSTGRES_PASSWORD=reportmate \
  -e POSTGRES_DB=reportmate \
  -p 5544:5432 \
  postgres:16-alpine

# 2. Backend. Migrations run automatically on boot.
cd backend
export DATABASE_URL="postgres://reportmate:reportmate@127.0.0.1:5544/reportmate?sslmode=disable"
go run ./cmd/server

# 3. Frontend, in a second terminal.
cd frontend
npm install
npm run dev
```

Open <http://localhost:5173> and sign in as
`dispatch@reportmate.local` / `reportmate-dev`.

**Why 5544 and not 5432.** If you already run Postgres locally — Homebrew's
`postgresql@16`, say — it owns 5432, and pointing the app at it would mix
Report Mate's tables into whatever else lives there. A port of its own keeps
them apart.

5544 is only a suggestion. Check it is free before you use it, and pick
another if it is not — 5433 in particular is the conventional "second
Postgres" and is very often already taken:

```bash
lsof -nP -iTCP:5544 -sTCP:LISTEN     # silence means free
```

If you change it, change it in `DATABASE_URL` too. Both numbers have to agree.

### Starting it again tomorrow

`docker run` creates a container, so running it a second time fails with:

```
Conflict. The container name "/reportmate-db" is already in use
```

That is not a problem — it means the container already exists. Nothing is
broken and no data is lost. What you want depends on what `docker ps -a` says:

| State | Command |
| --- | --- |
| Already running | Nothing. It is ready. |
| Exited (e.g. after a reboot) | `docker start reportmate-db` |
| Not listed at all | The `docker run` above |

`docker start` is a no-op against an already-running container, so when in
doubt just run that:

```bash
docker start reportmate-db
docker exec reportmate-db pg_isready -U reportmate -d reportmate   # confirm
```

---

## Postgres, the other ways

### An existing local server (Homebrew, Postgres.app, apt)

Create a database of its own rather than reusing `postgres`:

```bash
createdb reportmate
export DATABASE_URL="postgres://$(whoami)@127.0.0.1:5432/reportmate?sslmode=disable"
```

Add `:password` after the username if your server asks for one.

### A managed/remote server

Use the connection string it gives you, and keep `sslmode=require`:

```bash
export DATABASE_URL="postgres://user:password@host:5432/reportmate?sslmode=require"
```

### Starting over

The schema is rebuilt from scratch on every boot against an empty database, so
the reset is just: drop the database, create it, restart the server.

```bash
docker exec reportmate-db psql -U reportmate -d postgres \
  -c 'DROP DATABASE reportmate WITH (FORCE)' -c 'CREATE DATABASE reportmate'
```

---

## Environment variables

Only `DATABASE_URL` is required. `.env.example` documents every variable
including the ones for the AI agent; this table covers what the server itself
reads (`backend/internal/config/config.go`).

| Variable | Required | Default | What it does |
| --- | --- | --- | --- |
| `DATABASE_URL` | **yes** | — | Postgres connection string. No default on purpose: silently pointing at localhost would be worse than refusing to start. |
| `PORT` | no | `8080` | Port the API listens on. The Vite dev proxy assumes 8080 — change both together. |
| `ENV` | no | `development` | `development` or `production`. |
| `JWT_SIGNING_KEY` | no in dev, **yes in prod** | a published dev key | HMAC secret session tokens are signed with. In development the server falls back to a key that is committed in this repository, so a fresh clone can log in with nothing configured. `ENV=production` **refuses to start** with that fallback — generate a real one with `openssl rand -base64 48`. |
| `EXPORT_DIR` | no | `./var/exports` | Where save-and-export writes its rendered HTML snapshot. Relative to the server's working directory, so running from `backend/` puts them in `backend/var/exports/`. `var/` is gitignored. |

The server never logs `DATABASE_URL` or `JWT_SIGNING_KEY`. Keep it that way —
both are credentials.

There is no `.env` loading in the Go process: export the variables in your
shell, or put them in a file and `source` it. To start from the sample:

```bash
cp .env.example .env     # then edit, then: set -a; source .env; set +a
```

`.env` is gitignored. Never commit one.

---

## Migrations

**They run automatically, on every boot, before any handler is constructed.**
There is no separate migrate command and you do not need one.

`backend/db/migrations/*.sql` is embedded into the binary (`embed.go`). On
startup the server creates a `schema_migrations` table if it is missing,
applies every file not already recorded there in lexical filename order, and
records each one. Each migration and its bookkeeping row commit in a single
transaction, so the schema can never drift out of step with the ledger. A
migration that fails aborts startup — the process refuses to serve against a
half-migrated database rather than failing later, in a worse place.

A successful first boot looks like this:

```
server: connected to postgres
db: migrate: applied 0001_users.sql
db: migrate: applied 0002_jobs.sql
...
db: migrate: applied 0010_seed_dev_credentials.sql
server: migrations up to date
server: listening on :8080 (env=development)
```

On later boots the `applied` lines are absent and only `migrations up to date`
appears.

To add one: create the next numbered file (`0011_thing.sql`) and restart.
**Never edit a migration that has already been applied anywhere** — it will not
re-run, and your database and everyone else's will quietly disagree.

---

## The two dev logins

Migrations `0009_seed_dev_users.sql` and `0010_seed_dev_credentials.sql` seed
two accounts. Both use the password `reportmate-dev`.

| Email | Password | Role | Use it to see |
| --- | --- | --- | --- |
| `dispatch@reportmate.local` | `reportmate-dev` | `dispatcher_admin` | Everything, including the Template Builder at `/templates` |
| `tech@reportmate.local` | `reportmate-dev` | `technician` | The technician's view — `/templates` shows an access-denied message, and the nav hides the link |

These rows must never reach a production database.

---

## Running the two halves

### Backend

```bash
cd backend
export DATABASE_URL="postgres://reportmate:reportmate@127.0.0.1:5544/reportmate?sslmode=disable"
go run ./cmd/server
```

Serves on `http://localhost:8080`. Ctrl-C shuts down gracefully, draining
in-flight requests for up to 15 seconds.

Quick check that it is alive and the seeds landed:

```bash
curl -s -X POST localhost:8080/api/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"dispatch@reportmate.local","password":"reportmate-dev"}'
```

A JSON body with a `token` and a `user` means the database, the migrations and
the seeds are all good.

### Frontend

```bash
cd frontend
npm install
npm run dev
```

Serves on `http://localhost:5173`. Vite proxies `/api` to
`http://localhost:8080` (`vite.config.ts`), so the frontend calls same-origin
paths and the backend needs no CORS configuration. **Start the backend first**
— the dev server will start without it, but every request 502s until it is up.

Point the frontend at a different API with `VITE_API_BASE_URL` in
`frontend/.env.local`; leave it unset for the proxy.

### Production build

```bash
cd frontend && npm run build     # type-checks, then bundles to dist/
```

---

## Running the tests

### Backend

```bash
cd backend
go build ./...
go vet ./...
gofmt -l .        # prints nothing when everything is formatted
go test ./...
```

`go test ./...` passes with **no database at all**. The dashboard's integration
tests skip themselves when `DASHBOARD_TEST_DATABASE_URL` is unset, and a skip
is silent in the default output — so a green run does **not** mean they ran.

To actually run them, point that variable at a scratch database:

```bash
DASHBOARD_TEST_DATABASE_URL="postgres://reportmate:reportmate@127.0.0.1:5544/reportmate?sslmode=disable" \
  go test ./internal/dashboard/ -count=1 -v
```

Confirm they ran by looking for these in the output — if you see `SKIP`
instead, the variable did not reach the test:

```
--- PASS: TestRollupsCountOnlyMyReportsAndKeepEmptyTemplates
--- PASS: TestOtherUsersReportsAreInvisible
--- PASS: TestReportTableColumnsCellsAndPayload
--- PASS: TestFiltersAndPaging
--- PASS: TestExportCSV
--- PASS: TestRequestGuards
```

These tests **write to and delete from** the database you point them at. They
clean up after themselves, but give them a scratch database — not one holding
anything you care about, and never a production one.

### Frontend

```bash
cd frontend
npm test          # vitest, no database and no running backend needed
```

`HTMLCanvasElement.prototype.getContext is not implemented` appears on stderr
during the report-editor tests. It is a jsdom limitation, not a failure — the
suite still reports all tests passing.

---

## Troubleshooting

**`config: DATABASE_URL is required`** — the variable is not exported in the
shell running `go run`. `export` it, don't just set it for one command in a
different terminal.

**`connection refused` on startup** — Postgres is not up, or is on another
port. `docker ps` should list `reportmate-db` with `0.0.0.0:5544->5432/tcp`.

**`database "reportmate" does not exist`** — the container creates it from
`POSTGRES_DB` on its *first* start only. If you changed that variable after the
fact, `docker rm -f reportmate-db` and run it again.

**Frontend loads but every request 401s** — you are signed out. The app sends
you to `/login`; if it did not, your token expired mid-session (they last 24
hours). Sign in again.

**Every API call 502s in the browser** — the backend is not running, or is not
on 8080. The Vite proxy has nowhere to forward to.

**Login fails with correct credentials** — the seed migrations did not run, or
ran against a different database than the one you are now pointed at. Check the
startup log for `applied 0010_seed_dev_credentials.sql`, and check
`DATABASE_URL`.

**A signed-in user gets bounced to `/login` after a restart** — tokens are
signed with `JWT_SIGNING_KEY`. If you set a real one, restarted without it, or
vice versa, existing tokens no longer validate. That is the intended behaviour;
sign in again.
