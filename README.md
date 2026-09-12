# Report Mate

Mobile-first web app that helps field technicians write service reports after customer visits — built around customizable report templates and an AI agent that fills them in.

Built for the **"Show Me Your Agents"** hackathon (NUS-ISS, Public Category), which is judged partly on agentic AI use (including a "Best Agents Use" special award). The AI agent is a first-class feature, not an add-on.

## The problem

Field technicians document work performed, replacement parts used, customer observations, and follow-up recommendations by hand — often after already driving to the next job. It's slow and produces incomplete, inconsistent reports.

## The core loop

1. A dispatcher/admin builds or customizes a report **template** from field blocks (text, number, select, checklist, photo).
2. A technician picks a template for a job.
3. They either fill it in **by hand**, or give an **AI agent** a rough account of what happened (typed or dictated) and it fills in the template's blanks — pulling in job history and the parts catalog, and flagging anything it can't confidently fill rather than guessing.
4. The technician **always reviews and can edit** the draft before submitting. The agent drafts; the human stays the author of record.
5. Dispatchers see a central history of past jobs and reports, and manage templates over time.

## Design principles

- **Human-in-the-loop always** — no report is submitted without a human review step.
- **Graceful degradation** — if the AI gateway is unavailable, the same template can be filled by hand. The product does not hard-depend on the AI being up.
- **Predictable over clever** — the agent fills defined fields and flags uncertainty; it does not improvise content outside the template's structure.
- **Mobile-first, field conditions** — big tap targets, usable one-handed, high contrast for outdoor sun, no tiny dropdowns.

## Tech stack

| Layer | Choice |
| --- | --- |
| Frontend | React + TypeScript, mobile-first (PWA if offline stretch goal is attempted) |
| Backend | Go, REST/JSON API |
| Database | AWS Lightsail-managed PostgreSQL (not RDS/Aurora — sandbox account is Lightsail-scoped) |
| Hosting | AWS Lightsail instance running the Go backend and serving the frontend build |
| AI gateway | Organizer-provided, Bedrock-backed, Ollama-compatible endpoint (self-hosted fallback available) |

## The AI agent

The agent is a hand-rolled tool-calling loop in the Go backend — **not** LangChain/LangGraph, and it does **not** rely on the gateway's native tool-calling (which has documented reliability issues). Instead it prompts the model, has it reply with a small JSON tool-call instruction, parses that itself, dispatches to the real function, and feeds the result back.

The gateway is only ever called from the backend — **the API key never reaches the frontend.**

Agent tools (MVP set):

- `get_template_schema(template_id)` — which fields exist, which are required
- `get_job_history(job_id)` — this customer's past jobs, for context
- `get_parts_catalog()` — match mentioned parts to real catalog entries
- `fill_field(field_id, value)` — write one field of the draft
- `flag_missing_field(field_id)` — mark a required field it couldn't fill
- `save_draft(report_id, content)` — persist the draft for review

## Data model (rough)

- `users` — id, name, role
- `jobs` — id, customer, address, scheduled_at, status
- `report_templates` — id, name, schema (jsonb: sections → fields → type/required)
- `service_reports` — id, job_id, technician_id, template_id, content (jsonb), filled_by [agent|manual|mixed], status, timestamps
- `parts_used` — report_id, part, qty
- `attachments` — report_id, storage_key, type

The template schema JSON is the single contract shared by the template builder, the report renderer, and the agent's `get_template_schema` tool.

## Repository layout

```
/
├── .kiro/steering/        # Kiro steering docs (product / tech / structure)
├── backend/               # Go REST API
│   ├── cmd/server/        # entrypoint, router wiring
│   ├── internal/          # auth, middleware, jobs, templates, reports, agent
│   └── db/migrations/     # ordered SQL migrations
├── frontend/              # React + TypeScript
│   └── src/               # pages, components, api client, styles
├── docs/                  # planning docs mirror
└── README.md
```

See [`.kiro/steering/structure.md`](.kiro/steering/structure.md) for the full layout and conventions. Each folder currently holds a placeholder describing what belongs there — code lands on top of it.

## Getting started

> The repo is scaffolding at this stage — folders and descriptive placeholders, no implementation yet. Setup steps below are the intended flow and will firm up as real code lands.

### Backend (Go)

```bash
cd backend
go mod tidy
go run ./cmd/server
```

### Frontend (React + TypeScript)

```bash
cd frontend
npm install
npm run dev
```

## MVP scope

- Auth + role selection (technician / dispatcher-admin)
- Template builder (drag-and-drop blocks, admin-facing)
- AI agent that fills a chosen template from technician input
- Manual fill path for any template
- Human review/edit before submit
- Report export (PDF)
- Central job & report history dashboard

## Stretch scope (only after MVP works end to end)

- Offline draft + sync-on-reconnect
- Voice input
- Template versioning

## Team

Four-person team for the hackathon's Public Category. See [`week1-task-breakdown.md`](week1-task-breakdown.md) for the current ownership split.

## License

[MIT](LICENSE)
