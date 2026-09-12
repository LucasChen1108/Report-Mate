# Product Steering: Report Mate

## What we're building
Report Mate is a mobile-first app for field technicians writing service reports
after customer visits. It's built for the "Show Me Your Agents" hackathon
(NUS-ISS), which is judged partly on agentic AI use (including a "Best Agents
Use" special award) — the AI agent is a first-class feature, not an add-on.

## The problem
Technicians document work performed, parts used, observations, and follow-ups
by hand, often after already driving to the next job. It's slow and the
reports that come out are inconsistent.

## The core loop
1. A dispatcher/admin builds or customises a report **template** from field
   blocks (text, number, select, checklist, photo).
2. A technician picks a template for a job.
3. They either fill it in **by hand**, or give an **AI agent** a rough
   account of what happened (typed or dictated) and it fills in the
   template's blanks — pulling in job history and the parts catalog, and
   flagging anything it can't confidently fill rather than guessing.
4. The technician **always reviews and can edit** the draft — agent-filled,
   hand-filled, or a mix — before submitting. The agent drafts; the human
   stays the author of record.
5. Dispatchers see a central history of past jobs and reports, and manage
   templates over time.

## Why template-first
The agent's job is to fill in blanks *defined by a template* — it does not
freely generate a report from nothing. There is nothing well-defined for it
to fill until a template's schema exists, so template tooling is built
before or alongside the agent, not after it.

## Design principles
- **Human-in-the-loop always.** No report reaches "submitted" without a
  human review step, agent-assisted or not.
- **Graceful degradation.** If the AI agent/gateway is unavailable, the
  technician can complete the same template by hand — the product must not
  hard-depend on the AI being up.
- **Predictable over clever.** The agent fills defined fields and flags
  uncertainty; it does not improvise report content outside the template's
  structure.
- **Mobile-first, field conditions.** Big tap targets, usable one-handed,
  high contrast for outdoor sun, no tiny dropdowns.

## MVP scope
- Auth + role selection (technician / dispatcher-admin)
- Template builder (drag-and-drop blocks, admin-facing)
- AI agent that fills a chosen template from technician input
- Manual fill path for any template
- Human review/edit before submit
- Report export (PDF)
- Central job & report history dashboard

## Stretch scope (only after MVP works end to end)
- Offline draft + sync-on-reconnect (technicians may have no signal after
  leaving a site)
- Voice input
- Template versioning
