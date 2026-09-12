# Structure Steering: Report Mate

No repo exists yet — this is the proposed layout to create the project
with. Adjust once real code lands, but start here rather than improvising
per-feature.

```
/
├── .kiro/
│   └── steering/              # this folder
├── backend/                   # Go
│   ├── cmd/
│   │   └── server/            # main.go — entrypoint, router wiring
│   ├── internal/
│   │   ├── auth/              # login, sessions/JWT, role selection
│   │   ├── middleware/        # auth check, RBAC, logging, error formatting
│   │   ├── jobs/               # jobs + history
│   │   ├── templates/          # report_templates CRUD + schema validation
│   │   ├── reports/             # service_reports, rendering, PDF export
│   │   └── agent/               # gateway client + tool-calling loop + tools
│   ├── db/
│   │   └── migrations/          # SQL migrations for the tables in tech.md
│   └── go.mod
├── frontend/                  # React + TypeScript
│   ├── src/
│   │   ├── pages/
│   │   │   ├── Login/
│   │   │   ├── TemplateBuilder/
│   │   │   ├── ReportEditor/    # manual + agent-assisted fill, shared UI
│   │   │   └── Dashboard/       # dispatcher job/report history
│   │   ├── components/
│   │   ├── api/                 # typed client for the Go backend
│   │   └── styles/               # mobile-first, high-contrast theme
│   └── package.json
├── docs/                       # mirror of the planning docs (optional)
└── README.md
```

## Conventions
- One Go package per domain under `internal/` (`auth`, `jobs`, `templates`,
  `reports`, `agent`) — avoid a single flat `internal/api` dump.
- The `agent` package is the only thing that talks to the LLM gateway.
  Nothing else calls it directly.
- Frontend API calls go through `src/api/`, not fetch() calls scattered
  through components — keeps the Go↔TS contract in one place, and is a
  natural target for a Kiro hook that regenerates types when the API
  changes.
- Migrations are additive and ordered (`0001_users.sql`, `0002_jobs.sql`,
  ...) — don't hand-edit an already-applied migration.
- Template schema (the JSON shape in `report_templates.schema`) is the one
  contract shared by the template builder, the report renderer, and the
  agent's `get_template_schema` tool — changes to its shape should be rare
  and deliberate, not ad hoc.
