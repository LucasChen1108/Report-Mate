// Package jobs owns the jobs table and the reusable job-history query.
//
// The history query is deliberately NOT baked into a dashboard endpoint: it is
// the same function the AI agent's get_job_history tool calls through
// agent.JobHistoryProvider (see internal/agent), so the dashboard and the agent
// share one query rather than two drifting copies. This file implements that
// provider; cmd/server injects it in place of agent.EmptyJobHistory.
//
// The agent package defines the JobHistoryProvider interface and the
// JobHistoryEntry DTO, so it has no dependency on this package; this package
// implements the interface and therefore imports agent.
package jobs

import (
	"context"
	"database/sql"
	"fmt"

	"github.com/LucasChen1108/Report-Mate/backend/internal/agent"
)

// History reads a customer's past jobs for context. It implements
// agent.JobHistoryProvider.
type History struct {
	db *sql.DB
}

// NewHistory builds a History over the given database handle.
func NewHistory(db *sql.DB) *History {
	return &History{db: db}
}

// History returns the OTHER jobs for the customer of the given job — the
// "this customer's past jobs" context the agent uses.
//
// Semantics (confirmed with the product owner):
//   - jobID nil  -> no job to resolve a customer from, so an empty history and
//     a nil error (the agent degrades gracefully, same as the empty provider).
//   - jobID set  -> resolve it to its customer_name, then return every OTHER
//     job for that customer (the job itself is excluded), most recent first by
//     scheduled_at. A job id that does not exist resolves to no customer, so an
//     empty history and a nil error — an unknown id is not an error the agent
//     should surface, it is simply "no context".
//
// A genuine query error is returned so the tool can report it and continue
// without the context.
func (h *History) History(ctx context.Context, jobID *string) ([]agent.JobHistoryEntry, error) {
	if jobID == nil || *jobID == "" {
		return []agent.JobHistoryEntry{}, nil
	}

	// Resolve the job to its customer. A missing row is "no context", not an
	// error.
	var customer string
	err := h.db.QueryRowContext(ctx,
		`SELECT customer_name FROM jobs WHERE id = $1`, *jobID,
	).Scan(&customer)
	if err == sql.ErrNoRows {
		return []agent.JobHistoryEntry{}, nil
	}
	if err != nil {
		return nil, fmt.Errorf("jobs: resolve job customer: %w", err)
	}

	// Every other job for that customer, most recent first. scheduled_at can be
	// NULL (an unscheduled job), so read it through a NullTime and only surface
	// a zero time — the agent's entry carries a time.Time either way.
	rows, err := h.db.QueryContext(ctx,
		`SELECT id, customer_name, site_address, scheduled_at, status
		   FROM jobs
		  WHERE customer_name = $1 AND id <> $2
		  ORDER BY scheduled_at DESC NULLS LAST`,
		customer, *jobID,
	)
	if err != nil {
		return nil, fmt.Errorf("jobs: query customer history: %w", err)
	}
	defer rows.Close()

	entries := make([]agent.JobHistoryEntry, 0)
	for rows.Next() {
		var (
			e         agent.JobHistoryEntry
			scheduled sql.NullTime
		)
		if err := rows.Scan(&e.JobID, &e.Customer, &e.Address, &scheduled, &e.Status); err != nil {
			return nil, fmt.Errorf("jobs: scan history row: %w", err)
		}
		if scheduled.Valid {
			e.ScheduledAt = scheduled.Time
		}
		entries = append(entries, e)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("jobs: iterate history: %w", err)
	}
	return entries, nil
}

// Compile-time assurance that *History satisfies the agent's provider interface.
var _ agent.JobHistoryProvider = (*History)(nil)
