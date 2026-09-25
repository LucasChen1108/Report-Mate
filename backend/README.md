# backend/ — Go REST/JSON API

The Go backend owns everything the frontend and the AI agent depend on:
auth, business logic (jobs, reports, templates, parts), report rendering/export,
and the **only** connection to the LLM gateway.

## Layout

```
backend/
├── cmd/server/         # main.go — process entrypoint, config load, router wiring
├── internal/
│   ├── auth/           # login, opaque cookie sessions, identity loading
│   ├── middleware/     # auth check, RBAC, request logging, error formatting
│   ├── jobs/           # jobs + history (also the agent's context source)
│   ├── templates/      # report_templates CRUD + schema validation
│   ├── reports/        # service_reports, rendering, PDF export
│   └── agent/          # gateway client + tool-calling loop + agent tools
├── db/migrations/      # ordered SQL migrations for the tables in tech.md
└── go.mod
```

## Conventions

- One Go package per domain under `internal/` — avoid a single flat `internal/api` dump.
- The `agent` package is the **only** thing that talks to the LLM gateway. Nothing else calls it directly.
- The gateway API key lives only in backend config/secrets — never logged, never sent to the client.
- Migrations are additive and ordered (`0001_...`, `0002_...`). Don't hand-edit an already-applied migration.

## Running (intended)

```bash
go mod tidy
go run ./cmd/server
```

> Scaffold stage: packages currently hold `doc.go` files describing intended responsibilities. Implementation lands on top.
