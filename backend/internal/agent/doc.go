// Package agent is the ONLY package that talks to the LLM gateway.
//
// The gateway is organizer-provided: Bedrock-backed, reached through an
// Ollama-compatible endpoint. A self-hosted gateway on our own Lightsail box
// is the fallback if the shared one is unreliable.
//
// Design (to implement):
//   - A hand-rolled tool-calling loop, modeled on the starter kit's
//     weather_demo.py: prompt the model → it replies with a small JSON
//     tool-call instruction → we parse that ourselves → dispatch to the real
//     function → feed the result back → repeat until done.
//   - DO NOT rely on the gateway's native tool-calling — it has documented
//     reliability problems (fabricated tool results). Use the manual JSON
//     pattern and verify against the current gateway build early.
//   - DO NOT introduce LangChain/LangGraph or a second (Python) runtime — this
//     loop is plain Go.
//   - The gateway API key is read from backend config only, never logged,
//     never returned to the client.
//   - Log every tool call and result so a run can be replayed/debugged.
//
// Agent tools (MVP set) — each dispatches to a real backend function:
//   - get_template_schema(template_id): which fields exist, which are required
//     (from internal/templates)
//   - get_job_history(job_id): this customer's past jobs (from internal/jobs)
//   - get_parts_catalog(): match mentioned parts to real catalog entries
//   - fill_field(field_id, value): write one field of the draft
//   - flag_missing_field(field_id): mark a required field it couldn't fill
//   - save_draft(report_id, content): persist the draft for review
//
// The agent can only write into fields defined by the active template's schema
// — no route to arbitrary data changes. It drafts; the technician always
// reviews before submit.
package agent
