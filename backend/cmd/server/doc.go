// Package main is the backend process entrypoint.
//
// Responsibilities (to implement):
//   - Load configuration and secrets (DB connection string, LLM gateway URL +
//     API key, JWT signing key) from environment / config — never hardcode the
//     gateway key, and never expose it to the frontend.
//   - Open the PostgreSQL connection pool and run/verify migrations from
//     ../../db/migrations.
//   - Construct the domain services (auth, jobs, templates, reports, agent).
//   - Wire the HTTP router: mount routes, attach middleware (auth, RBAC,
//     logging, error formatting) in the correct order.
//   - Start the HTTP server and handle graceful shutdown.
//
// This file is the single place where all packages are composed together;
// keep business logic out of here.
package main
