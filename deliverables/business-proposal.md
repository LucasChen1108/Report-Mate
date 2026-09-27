---
title: "Report Mate — Business Proposal"
subtitle: "Show Me Your Agents Hackathon (NUS-ISS, Public Category)"
author: "Team Simpsons — Arrav · Aaron · Ngiam · Letao"
date: "2026"
geometry: margin=1in
fontsize: 11pt
colorlinks: true
linkcolor: MidnightBlue
urlcolor: MidnightBlue
toc: true
toc-depth: 2
---

\newpage

# 1. Executive summary

Report Mate is a mobile-first application that helps field-service technicians
produce accurate, consistent customer visit reports in minutes instead of at the
end of a long day. Technicians describe what happened in plain language — typed
or dictated — and an AI agent fills the appropriate report template, drawing on
the customer's job history and a real parts catalog, and flagging anything it is
not sure about. A human always reviews and approves before the report is
submitted.

The result: faster reporting, more complete records, and a documentation process
that fits the reality of field work rather than fighting it. Report Mate keeps
the technician firmly in control while removing the tedious part of the job.

# 2. The problem

Field technicians — HVAC, electrical, facilities, appliance repair — document
work performed, parts used, customer observations, and follow-up
recommendations by hand. This happens under poor conditions: on a phone, in a
vehicle, in bright sun, and often after already driving to the next job.

The consequences are familiar to any service business:

- **Slow.** Paperwork eats billable time and stretches the working day.
- **Inconsistent.** Reports vary by technician; important details are missed.
- **Incomplete.** Parts and follow-ups are forgotten, which affects invoicing
  and repeat visits.
- **Hard to search later.** Inconsistent, hand-written records are difficult for
  dispatchers to review or audit.

# 3. The solution

Report Mate is built around a simple loop:

1. A dispatcher/admin builds a report **template** from field blocks (text,
   number, select, checklist, photo, signature) using a drag-and-drop builder.
2. A technician picks the right template for a job.
3. They either fill it in by hand, or hand an **AI agent** a rough account of
   the visit. The agent fills the blanks, matches mentioned parts to the real
   catalog, pulls in the customer's past visits, and flags anything it cannot
   confidently complete — rather than guessing.
4. The technician **reviews and edits** the draft. Nothing is submitted without
   a human check.
5. Dispatchers see a central history of jobs and reports and manage templates
   over time.

## 3.1 What makes it different

- **The AI asks instead of guessing.** In conversational mode the agent asks the
  technician a clarifying question (for example, a meter reading it needs) rather
  than inventing a value. This is what keeps reports trustworthy.
- **Human-in-the-loop by design.** The agent drafts; the technician is always
  the author of record. This matters for accountability, warranty, and
  compliance.
- **It still works when the AI does not.** If the AI service is unavailable, the
  same template can be completed by hand. The business is never blocked by an
  outage.
- **Voice input for the field.** Technicians can dictate the account hands-free,
  which suits the working environment.

# 4. Who it is for

- **Field technicians** — the primary users, who want to finish reports quickly
  and correctly without fighting a form on a small screen.
- **Dispatchers / service managers** — who need consistent, complete records,
  a central history of jobs, and control over report templates.
- **Service businesses** — HVAC, electrical, plumbing, facilities management,
  and appliance repair firms that run recurring customer visits.

# 5. Value proposition

| Stakeholder | Value delivered |
| --- | --- |
| Technician | Less paperwork, faster job turnaround, hands-free voice input |
| Dispatcher | Consistent, complete, searchable reports; template control |
| Business | Better invoicing accuracy, fewer missed follow-ups, auditable records |
| Customer | Clear, professional documentation of work performed |

The core benefit is **time returned to billable work** combined with **higher
quality records** — the two things a service business cares about most.

# 6. How it works (at a glance)

Report Mate is a web application that runs on any phone, tablet, or laptop
browser. Dispatchers configure templates once; technicians reuse them on every
job. The AI agent runs entirely on the secure backend — the technician simply
types or speaks, reviews the draft, and submits. Reports can be exported for
records and invoicing.

The AI is deliberately scoped: it fills the fields a template defines and flags
uncertainty. It does not free-write reports from nothing, which is what keeps
the output predictable and safe to sign off on.

# 7. Responsible and practical AI

Report Mate treats AI as an assistant, not an authority:

- **The human approves every report.** The agent cannot submit on its own.
- **The AI is transparent about uncertainty.** Fields it could not fill are
  flagged for human attention.
- **Data stays protected.** The AI service is only ever contacted from the
  secure backend; credentials are never exposed to the browser.
- **Cost is controlled.** Each AI conversation is bounded by turn and question
  limits so usage stays predictable.

# 8. Current status

Report Mate is a working product, not a mockup. The template builder, manual and
AI-assisted fill paths, human review, dashboard, and report export are
implemented, tested, and deployed to a live cloud environment. Both one-shot and
conversational AI drafting work end to end against a live AI gateway, including
real parts matching and job-history context, with voice dictation available in
the chat interface.

# 9. Roadmap

Near-term opportunities that build on the working foundation:

- **Offline drafting with sync on reconnect** — technicians frequently lose
  signal on site; drafting offline and syncing later removes a real pain point.
- **Template versioning** — track and roll back changes to report templates
  over time.
- **Deeper analytics** — surface trends across jobs, parts usage, and
  technicians for service managers.
- **Attachment storage at scale** — move photos and signatures to object storage
  for larger deployments.

# 10. Team

Report Mate was built by **Team Simpsons** for the NUS-ISS "Show Me Your Agents"
hackathon (Public Category): **Arrav, Aaron, Ngiam, and Letao** — covering the
AI agent, backend services, template and report experience, and deployment.
