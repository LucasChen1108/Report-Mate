# pages/Login/

Login and role selection — the entry point everything else sits behind.

## What it does

- Login form wired to the real API (`POST /auth/login` via `src/api/`).
- Role selection: **technician** vs **dispatcher-admin** — at login or first use.
- On success, stores the session/JWT (via the api client) and routes the user to
  their landing screen (technician → report flow, dispatcher → dashboard).
- Handles and surfaces auth errors clearly (wrong credentials, expired session).

## Notes

- Mobile-first: large fields and buttons, high contrast, no tiny controls.
- Role determines which routes/pages are reachable — dispatcher-only areas
  (TemplateBuilder, Dashboard) are gated behind the dispatcher-admin role.

Owner: Aarav (auth / role selection / middleware).
