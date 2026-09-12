# Week 1 Task Breakdown (by person)

Maps the team's actual Week 1 assignment (Aarav / Letao & Aaron / Ngiam) onto the architecture in `product-plan.md`. Week 1 = build phase Sept 7-13; today is Wed Sept 9, so this covers the remaining ~5 days. One gap flagged at the end that isn't covered by the current assignment.

## Aarav - Login, role selection, middleware

His auth/middleware layer is what everyone else builds behind - highest priority to land early, even ahead of polish.

"Middleware" made concrete (per the architecture doc, this was vague in the original plan): auth verification, role-based access control, request logging, and centralized error formatting - four distinct pieces, not one blob.

**Checklist:**
- [ ] Go backend scaffold running locally, and deployed to the Lightsail instance (this unblocks everyone else's deploys)
- [ ] `users` table + migration (id, name, email, role, password hash)
- [ ] `POST /auth/login` issuing a session/JWT
- [ ] Role selection (technician vs dispatcher-admin) at login or first use
- [ ] Auth middleware validating the session on protected routes
- [ ] RBAC middleware restricting dispatcher-only routes (template management, dashboard)
- [ ] Request logging + centralized error-response middleware
- [ ] Basic React login + role-select screen wired to the real API
- [ ] Sanity check: a protected route correctly rejects an unauthenticated/wrong-role request

## Letao & Aaron - Report rendering/export + template engine

Two features, but they share one contract: the template schema. **Agree on the schema format together on day 1** before splitting off, since rendering is built against whatever the template engine produces - building them in isolation risks a mismatch mid-week. Suggested split once the schema is agreed: one owns the template builder UI, the other owns rendering/export, both working off the same `report_templates.schema` shape.

Per the architecture doc: model a template as JSON - an ordered list of sections, each with typed fields (text, number, select, checklist, photo) and a `required` flag - and build the drag-and-drop builder on an existing library (e.g. dnd-kit) rather than a custom canvas from scratch. This is also the schema the AI agent will fill into next week, so it's worth getting right now rather than reworking later.

**Checklist:**
- [ ] Template schema format agreed and written down (sections -> fields -> type/required) - do this first, together
- [ ] `report_templates` table + migration (schema jsonb)
- [ ] Template builder UI: field-type palette, drag-to-add/reorder using dnd-kit
- [ ] Save / edit / list custom templates
- [ ] 2-3 seed templates built for demo and for everyone else to test against
- [ ] `service_reports` table + migration (content jsonb keyed to template fields)
- [ ] Report renderer: template schema + content -> an editable form (this is also the manual-fill path technicians use)
- [ ] Export to PDF
- [ ] End-to-end smoke test: build a custom template -> fill it manually -> export PDF

## Ngiam - Central management system (past jobs, history data summary)

Doubles as the data source the AI agent will read from next week (`get_job_history`) - worth keeping the query interface clean and reusable now rather than baked into a UI component, so it's a straightforward hook later rather than a rewrite.

**Checklist:**
- [ ] `jobs` table + migration (customer, address, scheduled_at, status, assigned technician)
- [ ] Realistic seed data - several jobs, some with history - needed for both the demo and next week's agent work
- [ ] Dashboard UI: past jobs list with filter/search
- [ ] History summary view: rollup by customer or by technician
- [ ] A clean internal function/endpoint for "get history for job/customer X" (not just a UI query) - this becomes the agent's tool next week
- [ ] Link jobs -> their reports once Letao/Aaron's `service_reports` table exists

## Gap: nobody currently owns the gateway spike

None of the four Week 1 items cover proving the AI agent's connection to the organizer's LLM gateway actually works. Per the architecture doc, this is the single biggest technical risk (the gateway's native tool-calling is documented as unreliable) and it's cheap to test - a few hours, not a person-week: send one trivial tool-call round-trip through the gateway and confirm it returns something usable. Doing this in Week 1, even as a side task by whoever has slack, means Week 2's agent work starts on solid ground instead of discovering the problem after the template/report plumbing is already built on top of it. Worth the team picking an owner for this explicitly rather than leaving it implicit.
