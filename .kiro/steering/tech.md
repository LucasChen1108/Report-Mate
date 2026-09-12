# Tech Steering: Report Mate

## Stack
- **Frontend:** React + TypeScript. Mobile-first, responsive. Worth building
  as an installable PWA for cheap offline caching if the offline stretch
  goal is attempted.
- **Backend:** Go, REST/JSON API. Owns auth, business logic (jobs, reports,
  templates, parts), report rendering/export, and the proxy layer to the
  LLM gateway.
- **Database:** AWS **Lightsail-managed PostgreSQL**. Not RDS or Aurora —
  our hackathon sandbox AWS account is scoped to Lightsail only.
- **Hosting:** an AWS Lightsail instance runs the Go backend and serves the
  frontend build. Keep it modestly sized — most of our shared credit needs
  to go to LLM calls, not compute.
- **Attachments:** Lightsail storage by default; confirm with organizers
  whether S3 is reachable from the sandbox account before assuming it.

## AI / agent layer
- The LLM gateway is provided by the hackathon organizers: **Bedrock-backed**,
  reached through an **Ollama-compatible** endpoint. There's also a
  self-hosted fallback pattern (same kind of gateway, run on our own
  Lightsail box) if the shared/public gateway is unreliable.
- **Call the gateway only from the Go backend, never from the frontend** —
  the API key is tied to our team's shared usage and must not reach the
  client.
- **Do not rely on the gateway's native tool-calling** — it has documented
  reliability problems. Build the agent as a manual loop: prompt the model,
  have it reply with a small JSON tool-call instruction, parse that
  ourselves, dispatch to the real function, feed the result back. Verify
  this against the current gateway build early — don't assume it works.
- Agent tools (MVP set):
  - `get_template_schema(template_id)` — which fields exist, which are required
  - `get_job_history(job_id)` — this customer's past jobs, for context
  - `get_parts_catalog()` — to match mentioned parts to real catalog entries
  - `fill_field(field_id, value)` — writes one field of the draft
  - `flag_missing_field(field_id)` — marks a required field it couldn't fill
  - `save_draft(report_id, content)` — persists the draft for review
- Log every tool call and result so a run can be replayed/debugged.

## Data model (rough)
- `users` — id, name, role
- `jobs` — id, customer, address, scheduled_at, status
- `report_templates` — id, name, schema (jsonb: sections → fields → type/required)
- `service_reports` — id, job_id, technician_id, template_id, content (jsonb),
  filled_by [agent|manual|mixed], status, timestamps
- `parts_used` — report_id, part, qty
- `attachments` — report_id, storage_key, type

## Security
- Auth: session/JWT. RBAC middleware on dispatcher-only routes.
- Gateway API key lives only in backend config/secrets, never logged, never
  sent to the client.
- The agent can only write into fields defined by the active template's
  schema — no route to arbitrary data changes.

## Template engine implementation note
Model a template as JSON (ordered sections → typed fields — text, number,
select, checklist, photo — each with a `required` flag). Build the
drag-and-drop builder UI on an existing library (e.g. dnd-kit) rather than a
custom canvas/undo-redo editor from scratch — keeps the feature fully in
scope without eating the whole timeline.

## Credits and budget
- **Kiro credits — $1000/person, build-time only.** Spent inside Kiro while
  coding (specs, hooks). Not connected to hosting or the LLM gateway.
- **~$100 team pool, shared** — covers Lightsail hosting AND every LLM/API
  call the agent makes (dev, testing, demo). This is the real constraint.
  Monitor usage from day one. Don't use it for training/fine-tuning
  (excluded by organizers). Avoid firing live LLM calls for routine manual
  testing — mock/cache instead.

## What NOT to suggest
- No LangChain/LangGraph for the agent loop — the gateway doesn't fully
  support it; a hand-rolled Go tool-calling loop is the plan.
- No RDS/Aurora/general EC2 — Lightsail only, per the sandbox account.
- No calling the LLM gateway directly from the frontend.
