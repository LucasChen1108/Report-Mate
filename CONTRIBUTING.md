# Contributing to Report Mate

This repo is currently **scaffolding** — folders and descriptive placeholders,
no implementation code yet. This guide is how the four of us build on top of it
without stepping on each other.

## Ground rules (from the steering docs)

- **Read `.kiro/steering/` first.** `product.md` (what/why), `tech.md` (stack +
  constraints), `structure.md` (layout + conventions). They're the source of
  truth; if a decision changes, update them.
- **One Go package per domain** under `backend/internal/` — don't create a flat
  `internal/api` dump.
- **Only `internal/agent` talks to the LLM gateway.** Nothing else calls it.
- **All frontend API calls go through `frontend/src/api/`** — no scattered
  `fetch()`.
- **The gateway API key is backend-only.** Never send it to the frontend, never
  log it, never commit it. Use `.env` (git-ignored); see `.env.example`.
- **Migrations are additive and ordered** — never hand-edit an applied one.

## Ownership (Week 1 — see `week1-task-breakdown.md`)

| Area | Owner |
| --- | --- |
| Auth, role selection, middleware | Aarav |
| Template builder + report rendering/export | Letao & Aaron |
| Central management (past jobs, history) | Ngiam |
| Gateway tool-call spike (currently unowned — pick someone) | TBD |

Letao & Aaron: **agree the template schema shape together on day 1** before
splitting — the renderer and the agent both build against it.

## Branch / PR flow

- Branch off `main`: `feature/<area>-<short-desc>` (e.g. `feature/auth-login`).
- Keep PRs scoped to one area. Open against `main`.
- Don't commit secrets, `node_modules/`, build output, or `.env` (all git-ignored).

## Local setup (intended, firms up as code lands)

```bash
# backend
cd backend && go mod tidy && go run ./cmd/server

# frontend
cd frontend && npm install && npm run dev
```

Copy `.env.example` → `.env` and fill in real values before running the backend.
