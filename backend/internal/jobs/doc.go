// Package jobs owns the job store and history.
//
// Responsibilities (to implement):
//   - CRUD over the jobs table (id, customer, address, scheduled_at, status,
//     assigned technician).
//   - History summary: rollups by customer or by technician for the dispatcher
//     dashboard.
//   - A clean, reusable "get history for job/customer X" function — NOT baked
//     into a UI query. This same function becomes the agent's get_job_history
//     tool (see internal/agent), so keep the query interface reusable rather
//     than coupling it to a dashboard endpoint.
//   - Link jobs to their reports once service_reports exists.
//
// This package doubles as the agent's context source; treat it as a
// data-access layer usable by both the dashboard and the agent.
package jobs
