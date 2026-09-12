# docs/

Home for planning and design docs so they travel with the code.

## Where things live

- **Canonical steering** — `.kiro/steering/` (`product.md`, `tech.md`,
  `structure.md`). These are the source of truth Kiro reads on every request;
  keep them current.
- **Planning docs (repo root, for now)** — `product-plan.md`,
  `kiro-architecture-recommendations.md`, `week1-task-breakdown.md`.
- **This folder** — deeper design notes as they emerge: the template schema
  spec, the agent tool contracts, API endpoint reference, deployment runbook
  for the Lightsail setup.

## Suggested docs to add as the build progresses

- `template-schema.md` — the exact JSON shape of a template (sections → typed
  fields → required). This is the shared contract; write it down once agreed.
- `api.md` — backend endpoint reference (kept in sync with `frontend/src/api/`).
- `agent-tools.md` — each agent tool's name, args, and behavior.
- `deployment.md` — Lightsail provisioning + gateway wiring runbook.
