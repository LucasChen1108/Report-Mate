# src/api/

The single, typed client for the Go backend. **Every** backend call goes through
here — no `fetch()` scattered through components.

## Why it's centralized

- One place holds the Go↔TS contract (request/response types), so a change to the
  API surfaces in one file, not fifty.
- Natural target for a Kiro hook that regenerates TS types when the Go API
  changes.
- Handles cross-cutting concerns once: attaching the auth token, base URL,
  error shape, retries.

## What belongs here

- Typed functions per backend resource: auth, jobs, templates, reports, agent
  requests.
- Shared TS types mirroring the backend's JSON shapes (especially the template
  schema shape).

## What does NOT belong here

- The LLM gateway. The frontend never calls the gateway or holds its API key —
  agent requests go to *our backend*, which proxies to the gateway server-side.
