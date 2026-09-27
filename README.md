# Report Mate

Mobile-first web app that helps field technicians write service reports after customer visits — built around customizable report templates and an **AI agent** that fills them in from a rough, spoken or typed account of the visit.

Built for the **"Show Me Your Agents"** hackathon (NUS-ISS, Public Category), judged partly on agentic AI use (including a "Best Agents Use" award). The AI agent is a first-class feature, not an add-on.

> **Team Simpsons:** Arrav · Aaron · Ngiam · Letao

---

## Try it live

A deployed instance is running here:

**http://54.255.231.237:8080**

You need an account to sign in (registration is code-gated so account type can't be self-granted). To create the first admin:

1. Open **http://54.255.231.237:8080/register**
2. Role: **Admin**, Company: `Report Mate Demo`
3. Ask the team for a current **Company Admin Code** (they're time-limited).
4. Fill in your name, phone, and **two different** email addresses (personal + company), pick a password, and submit.
5. Sign in at **http://54.255.231.237:8080/login**.

Once in as an admin you can build templates, create reports, and use the AI agent. See [How to test the AI agent](#how-to-test-the-ai-agent) below.

---

## The core loop

1. A dispatcher/admin builds or customizes a report **template** from field blocks (text, number, select, checklist, photo, signature) with a drag-and-drop builder.
2. A technician picks a template for a job.
3. They either fill it in **by hand**, or give the **AI agent** a rough account of what happened (typed or dictated) and it fills the template's blanks — pulling in job history and the parts catalog, and flagging anything it can't confidently fill rather than guessing.
4. The technician **always reviews and can edit** the draft before submitting. The agent drafts; the human stays the author of record.
5. Dispatchers see a central history of past jobs and reports, and manage templates over time.

## Design principles

- **Human-in-the-loop always** — no report is submitted without a human review step.
- **Graceful degradation** — if the AI gateway is unavailable, the same template can be filled by hand. The product does not hard-depend on the AI being up.
- **Predictable over clever** — the agent fills defined fields and flags uncertainty; it does not improvise content outside the template's structure.
- **Mobile-first, field conditions** — big tap targets, usable one-handed, high contrast for outdoor sun.

## How to test the AI agent

The agent is the headline feature. To exercise it end to end (on the live site or a local run):

1. Sign in and open (or create) a report using an HVAC template. You'll see the **"Draft with AI"** panel.
2. **One-shot fill.** Paste a rough account, e.g.:
   > *Service call at Acme Manufacturing. Rooftop unit not cooling. Found the run capacitor bulged and the contactor pitted. Replaced both, cooling restored. Customer on site.*

   Click **Send**. The agent fills the text/select/checklist fields, matches "run capacitor" and "contactor" to real parts-catalog entries, and **flags** the photo/signature fields (those are human-captured, never filled by the agent).
3. **Conversational fill.** Start a fresh report and give a vague account:
   > *Did an HVAC call today, sorted it out, all good now.*

   The agent **pauses and asks a clarifying question** (e.g. a meter reading). Answer it, and it continues filling. It can ask up to 4 questions across 6 turns.
4. **Voice input.** Click the microphone in the chat panel and dictate the account (Chrome recommended); the transcript appends to the message box.
5. **Human review.** The draft lands in the editable form. Flagged fields are highlighted. Edit anything, attach the photo/signature by hand, then **Save draft** / **Save and Export**.

> Every AI run spends from the team's shared credit pool. Fine for demos; don't leave it looping.

## Tech stack

| Layer | Choice |
| --- | --- |
| Frontend | React + TypeScript (Vite), mobile-first |
| Backend | Go, REST/JSON API |
| Database | PostgreSQL (AWS Lightsail-managed in production) |
| Hosting | AWS Lightsail instance (Singapore) — one binary serves the API and the app |
| AI gateway | Organizer-provided, Bedrock-backed, OpenAI/Ollama-compatible |

## The AI agent

The agent is a hand-rolled JSON tool-calling loop in the Go backend (`internal/agent`) — **not** LangChain/LangGraph, and it does **not** rely on the gateway's native tool-calling (documented reliability issues). It prompts the model, has it reply with a small JSON tool-call instruction, parses that itself, dispatches to the real function, and feeds the result back. The gateway is only ever called from the backend — **the API key never reaches the frontend.**

Agent tools:

- `get_template_schema` — which fields exist, which are required
- `get_job_history` — this customer's past jobs, for context
- `get_parts_catalog` — match mentioned parts to real catalog entries
- `fill_field` — write one field of the draft
- `flag_missing_field` — mark a required field it couldn't fill
- `ask_technician` — ask one clarifying question and pause (conversational mode)
- `save_draft` — persist the draft for review

Two endpoints share the runner: `POST /api/reports/{id}/agent-fill` (one-shot) and `POST /api/reports/{id}/agent-chat` (conversational).

## Running it locally

See **[DEVELOPMENT.md](DEVELOPMENT.md)** — Postgres, environment variables, migrations, seeding the dev logins, and both test suites.

## Repository layout

```
/
├── .kiro/steering/        # Kiro steering docs (product / tech / structure)
├── backend/               # Go REST API
│   ├── cmd/server/        # entrypoint, router wiring, static SPA serving
│   ├── cmd/devseed/       # explicit dev-account seeder (development only)
│   ├── internal/          # auth, accounts, middleware, jobs, parts,
│   │                      #   templates, reports, agent, dashboard, ...
│   └── db/migrations/     # ordered, embedded SQL migrations
├── frontend/              # React + TypeScript
│   └── src/               # pages, components, api client, styles
├── deliverables/          # hackathon PDFs (technical doc, business proposal)
├── docs/                  # planning + deployment docs
└── README.md
```

## MVP scope (delivered)

- Auth + role selection (technician / dispatcher-admin)
- Template builder (drag-and-drop blocks, admin-facing)
- AI agent that fills a chosen template from technician input (one-shot + conversational)
- Manual fill path for any template
- Human review/edit before submit
- Report export
- Central job & report history dashboard

## Stretch scope

- Offline draft + sync-on-reconnect
- Voice input *(shipped: dictation in the AI chat panel)*
- Template versioning

## Deployment

The app deploys as a single Go binary that serves both the API and the built frontend on one origin, on AWS Lightsail with managed PostgreSQL. See **[docs/deployment.md](docs/deployment.md)** for the full runbook and `scripts/build-release.sh` for the release bundle.

## License

[MIT](LICENSE)
