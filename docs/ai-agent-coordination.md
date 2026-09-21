# AI Agent — coordination & who-does-what

The AI agent is our headline, most-judged feature ("Best Agents Use"). The full
spec is in `.kiro/specs/ai-agent/` (requirements → design → tasks) on branch
`feature/ai-agent`. The gateway connection is **already verified working** (see
`docs/llm-gateway.md`). This note covers the two data dependencies the agent
needs and a suggested split.

## Status
- Spec + verified gateway facts: DONE, committed on `feature/ai-agent`.
- Implementation: NOT started. 16 tasks in `.kiro/specs/ai-agent/tasks.md`.
- The agent RUNS without the two things below (it degrades to empty results),
  but it's far more impressive in the demo WITH them.

## Two prerequisites the agent needs (owners wanted)

The agent has two context tools that currently return empty because their data
doesn't exist yet. Both sit behind small Go interfaces
(`JobHistoryProvider`, `PartsCatalogProvider` in the design), so building the
real data does NOT require touching the agent code — just implement the
interface and inject it in `cmd/server`.

### Prereq A — Job history seed data  (suggested owner: Ngiam / dashboard-backend)
- `internal/jobs` is a stub and the `jobs` table has no seed data.
- Need: (1) a migration seeding realistic jobs (customer, address, scheduled_at,
  status), and (2) a reusable query func "get history for job/customer X"
  returning past jobs — its `doc.go` already promises this.
- The agent's `get_job_history` tool will call it via `JobHistoryProvider`.
- This also directly feeds the dashboard, so it's dual-purpose.

### Prereq B — Parts catalog  (suggested owner: whoever has slack)
- No `parts_catalog` table exists (`parts_used` is different — that's per-report).
- Need: a `parts_catalog` table (part, part_number) + a small seed of realistic
  parts + a query returning all entries.
- The agent's `get_parts_catalog` tool will call it via `PartsCatalogProvider`.

When each lands: implement the matching provider interface and swap it in for the
`EmptyJobHistory{}` / `EmptyPartsCatalog{}` default in `cmd/server`. No agent
change needed.

## Suggested split of the agent implementation itself (16 tasks)

Letao is taking the bulk tonight. If others free up, natural seams:

- **Backend core (Letao, tonight):** tasks 1–13 — config, parsing/run-log,
  providers, tools + fill_field validation, gateway client, runner loop,
  persist closure, endpoint, cmd/server wiring. This is the meat and it's
  self-contained.
- **Frontend panel (grab-able):** tasks 14–15 — `api/agent.ts` client + the
  "Fill with AI" panel in the Report Editor. Depends only on the endpoint's
  request/response shape (documented in the design), so it can start in parallel
  against that contract and integrate once the endpoint is up.
- **Property tests (grab-able):** the `*` sub-tasks — 13 correctness properties,
  each self-contained, inject a mock gateway (no live calls). Great for someone
  who wants to contribute without deep context.

## Setup for anyone joining
1. `git fetch && git checkout feature/ai-agent`
2. Backend runs with the gateway env vars in a local `.env` (git-ignored) —
   ask Letao for `LLM_GATEWAY_URL` / `LLM_GATEWAY_API_KEY` / `LLM_MODEL`, or copy
   from `.env.example` + the team API-key message. NEVER commit the key.
3. See `docs/llm-gateway.md` for the exact request shape and model aliases.
4. Cost discipline: every live gateway call spends the shared ~$100 pool. Tests
   mock the gateway — do not point tests at the live endpoint.
