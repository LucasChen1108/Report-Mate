# FieldReport (working title) — Product Plan

Show Me Your Agents (NUS-ISS), Public Category. Drafted 2026-09-09, revised same day per team correction on template-builder scope. Supersedes the plan/architecture sections of `hackathon-plan.md` and folds in the corrections from `kiro-architecture-recommendations.md`. Team: 4 members.

## 1. Problem & product description

**Problem statement (organizer-set):** Field technicians must prepare service reports after completing customer visits — documenting work performed, replacement parts used, customer observations, and follow-up recommendations. This is usually done manually, often after the technician has already travelled to their next job. It costs time and produces incomplete or inconsistent reports.

**Product:** A mobile-first web app built around customizable report templates and an AI agent that fills them in. Admins/dispatchers build and customize report templates from drag-and-drop blocks (fields, sections, checklists — the "like LinkedIn" block editor). A technician picks the right template for a job, gives the agent a rough account of what happened (typed or dictated), and the agent fills in the template's blanks — pulling in job history and the parts catalog, and flagging anything required it can't fill. The technician can also fill any template by hand, and always reviews/edits the agent's draft before submitting. Dispatchers get a central view of past jobs and report history.

**Why the template builder comes first:** the agent's job is specifically to fill in *blanks defined by a template* — not to freeform-generate a report from nothing. Until a template's field structure exists, there's nothing well-defined for the agent to fill, and no way to demo "manual fill vs. agent-assisted fill" as two paths through the same template, which is the core of the product story. So the template engine is foundational, not a nice-to-have layered on after the agent — build it first (or in tight parallel with the agent's plumbing), then wire the agent to it.

**Why an agent, not just a form:** the hackathon explicitly judges "Best Agents Use." The differentiator is that the agent has tools (pull this customer's job history, check the parts catalog, flag a required field it couldn't fill) and acts on the technician's behalf inside a structure the team/admin controls — not a bare chatbot bolted onto a form.

**Primary users:** field technicians (mobile, one-handed, outdoors), dispatchers/admins (template building, review, history).

## 2. Scope

**MVP (must work for the demo):**
- Auth + role selection (technician / dispatcher-admin)
- **Template builder:** drag-and-drop block editor for dispatchers/admins to create and customize report templates (fields, sections, required/optional blanks) — see Architecture 4 for how to build this fast rather than from scratch
- Job store with history (seeded with realistic sample data) — doubles as the agent's context source
- AI agent that, given a chosen template, fills in its blanks from the technician's free-text/voice input, using tools to pull job history, check the parts catalog, and flag fields it couldn't confidently fill
- Manual fill path: technician can fill any template by hand without the agent
- Human-in-the-loop editing — technician always reviews/corrects the draft (agent- or self-filled) before submitting
- Report export (PDF)
- Mobile-first field UI: big tap targets, usable one-handed, high-contrast for outdoor sun, no tiny dropdowns
- Dispatcher dashboard: past jobs + report history + template management

**Stretch (only after the above works end to end):**
- Offline draft + sync-on-reconnect — the problem statement implies technicians write reports after leaving the site, i.e. possibly without signal, so this is a strong differentiator if time allows
- Voice input for hands-busy field use
- Template versioning / sharing templates across teams

## 3. Re-sequenced timeline

Actual hackathon dates: kickoff Sept 5, build phase Sept 7-25, final submission Sept 28, Demo Day Oct 10. Today is Sept 9 — phases below are dated against the real calendar, not a generic "Week 1/2/3."

**Phase 0 - now through Sept 12 (foundations, in parallel tracks):**
Kiro steering docs (product/tech/structure); repo scaffold (Go backend, React+TS frontend); Lightsail infra stood up per the starter kit's README; auth + role selection. Two things need to start immediately and in parallel because both are on the critical path: (a) the template data model and a first pass of the drag-and-drop builder UI, and (b) a spike proving one tool call round-trips through the organizer's gateway (see Architecture 4), using a trivial tool — this doesn't need real templates yet, just proves the plumbing works before anything real is built on it.

**Phase 1 - Sept 13-18 (template builder + agent, together):**
Finish the template builder to the point dispatchers can create/customize a real template. As soon as a template schema exists, wire the agent to it: given a template, fill its blanks from technician input using the tool set in 4. Also build the manual-fill path for the same templates. Goal: by Sept 18, both fill paths (manual and agent-assisted) work against at least one real, custom-built template.

**Phase 2 - Sept 19-22 (mobile UI + dashboard):**
Mobile-first field UI for the technician flow (pick template -> fill manually or via agent -> edit -> submit); dispatcher dashboard for job/report history and template management, reusing the same data the agent reads from.

**Phase 3 - Sept 23-25 (hardening):**
Security pass (API key never reaches the frontend - see 4; role-based access control); credit/cost check against the $100 pool; offline-draft stretch if ahead of schedule.

**Phase 4 - Sept 26-28 (submission):**
Demo script, deployment freeze, write-up, submission package. This uses the buffer between build-phase end (25th) and final submission (28th) - don't plan to still be building on the 28th.

## 4. Architecture

**Frontend:** React + TypeScript. Mobile-first responsive; worth evaluating as an installable PWA, since it's built for technicians on phones outdoors and a PWA shell gives cheap offline caching if the stretch goal is attempted.

**Backend:** Go, REST/JSON API. Owns:
- Auth (session/JWT) and role-based middleware - this is what "Middleware" in the original plan should concretely mean; worth stating explicitly so estimates aren't guessing at scope.
- Business logic for jobs, reports, templates, parts.
- The proxy layer to the LLM gateway (see below) - the backend calls the gateway server-side. **The API key must never reach the frontend/mobile client** - the organizer email is explicit that it's tied to the team's usage, and a client-side key is both a security hole and a way to blow the shared $100 pool.
- Report rendering/export.

**Template engine - build it fast, not from scratch.** A full custom canvas/block editor (undo/redo, drag-reorder, live preview) is a lot of surface area for the time available. Recommend: model a template as JSON schema (an ordered list of sections, each with typed fields - text, number, select, checklist, photo - and a `required` flag), store that schema in `report_templates.schema jsonb`, and build the drag-and-drop editor on top of an existing library (e.g. dnd-kit for reordering/dragging blocks) rather than writing drag-and-drop mechanics from scratch. This keeps the *feature* (customizable templates) fully in scope while keeping the *implementation* small enough to land in Phase 1. The same schema is what the agent below fills in - one source of truth for "what a blank is," used by both the manual-fill renderer and the agent.

**Data/hosting:** AWS Lightsail (per the organizer's sandbox account and the starter kit) - a Lightsail instance for the app, Lightsail-managed PostgreSQL for data. Not RDS/Aurora - the sandbox account is scoped to Lightsail. Rough schema: `users` (id, name, role), `jobs` (id, customer, address, scheduled_at, status), `report_templates` (id, name, schema jsonb - sections/fields/required flags), `service_reports` (id, job_id, technician_id, template_id, status, content jsonb keyed to the template's fields, filled_by [agent|manual|mixed], timestamps), `parts_used` (report_id, part, qty), `attachments` (report_id, storage_key, type). Confirm with organizers whether S3 is reachable from the sandbox account for attachments/exports; if not, Lightsail block storage is the fallback.

**AI/agent layer - how the two organizer messages fit together:** the organizer email describes a shared API URL + key ("the public gateway"); the starter kit repo shows how to *additionally* self-host your own instance of essentially the same Bedrock-backed, Ollama-compatible gateway on your own Lightsail box. Read together: hit the organizer's shared gateway by default, and treat the starter kit's self-hosting instructions as the fallback if the shared gateway is unreliable (its own scripts note the public gateway was on a stale build without working native tool-calling at time of writing - exactly why the fallback path exists).

Design the agent as: Go code in (or alongside) the backend implementing a tool-calling loop against the gateway, modeled on the starter kit's `weather_demo.py` (a dependency-free prompt -> JSON tool-request -> manual parse -> dispatch -> feed-back-to-model loop) - ported to Go rather than adding Python/LangChain as a second runtime. **Do not rely on the gateway's native tool-calling** - the starter kit's own debugging notes describe it fabricating tool results until a parser bug was fixed; plan for the manual JSON pattern and verify it against the current gateway build in the Phase 0 spike.

Tools to expose to the agent (MVP set): `get_template_schema(template_id)` (so the agent knows exactly which blanks exist and which are required), `get_job_history(job_id)`, `get_parts_catalog()`, `fill_field(field_id, value)` (called once per blank as the agent works through the template), `flag_missing_field(field_id)` (for anything it can't confidently fill from the input), `save_draft(report_id, content)`. Keep the tool list small and well-specified - each tool is also a natural Kiro spec.

**Graceful degradation:** the agent is an accelerator on top of the manual-fill path, not a replacement for it - if the gateway is down or slow, the technician fills the same template by hand. This is already in scope as a first-class path (2), which both derisks the demo and reads well to judges as "deployment-ready."

## 5. Credits and budget

- **Kiro - $1000/person x 4, build-time only.** Spend it on steering docs, spec-driven generation of the CRUD/plumbing items (auth, template CRUD, export, dashboard), and hooks (tests on save, shared type generation between Go and TS, mobile contrast/tap-target checks). This budget is generous for a 3-week hackathon; the constraint is using it well, not rationing it.
- **~$100 team pool, shared, for Lightsail hosting + all LLM/API calls.** This is the real constraint. Lightsail's own hosting cost is small and roughly fixed, so budget most of the pool for inference: monitor usage from day one (organizers said this explicitly), avoid firing live LLM calls for routine manual testing (mock/cache instead), and don't use it for training or fine-tuning (organizers explicitly excluded this).
- **Open question for organizers:** whether the $100 pool and the "$1000/person" figure mentioned at sponsorship are the same program or genuinely separate - worth a direct check rather than assuming.

## 6. Risks

- **Gateway tool-calling reliability** (see 4) - highest technical risk, cheapest to de-risk early with a Phase 0 spike rather than discovering it in week 3.
- **Template engine scope creep** - a full custom canvas/block editor can absorb far more than its allotted days; building it on an existing drag-and-drop library against a JSON-schema data model (4) is what keeps it in scope for Phase 0-1 rather than eating the whole timeline.
- **Template builder and agent are now coupled** - the agent literally can't be tested against real data until a real template schema exists. If the template builder slips, the agent slips with it. Worth having the template *schema format* locked (even ahead of the polished drag-and-drop UI) so the agent track isn't blocked on UI polish.
- **Credit exhaustion on the $100 pool** - shared across 4 people and both hosting and inference; needs a named owner checking the AWS console regularly, not an end-of-hackathon surprise.
