package agent

import (
	"context"
	"time"
)

// Context provider seams for the two data-dependent agent tools
// (get_job_history and get_parts_catalog).
//
// These seams exist because their backing data does not exist yet:
//   - internal/jobs is still a stub — the jobs table has no seed data
//     (Req 5.3), so there is no real job history to return today.
//   - no parts_catalog table exists yet (parts_used is a different,
//     per-report table), so there is no real catalog to return today
//     (Req 5.5).
//
// The agent must degrade gracefully in the meantime: the default
// implementations below return an empty slice and a nil error, so a run
// continues rather than failing. When the real data lands, the concrete
// implementations (e.g. internal/jobs gaining a "get history for job X"
// function, or a parts_catalog query) satisfy these same interfaces and are
// injected in cmd/server — the runner and the tools do not change.

// JobHistoryEntry is one past job for the customer, shaped for the prompt.
type JobHistoryEntry struct {
	JobID       string    `json:"jobId"`
	Customer    string    `json:"customer"`
	Address     string    `json:"address"`
	ScheduledAt time.Time `json:"scheduledAt"`
	Status      string    `json:"status"`
}

// PartsCatalogEntry is one catalog part the agent can match mentioned parts
// against.
type PartsCatalogEntry struct {
	Part       string `json:"part"`
	PartNumber string `json:"partNumber"`
}

// JobHistoryProvider supplies a customer's past jobs for the get_job_history
// tool. internal/jobs implements this once the jobs table has data; until
// then EmptyJobHistory is injected (Req 5.2, 5.3).
type JobHistoryProvider interface {
	History(ctx context.Context, jobID *string) ([]JobHistoryEntry, error)
}

// PartsCatalogProvider supplies the parts catalog for the get_parts_catalog
// tool. No parts_catalog table exists yet, so EmptyPartsCatalog is injected
// until one does (Req 5.4, 5.5).
type PartsCatalogProvider interface {
	Catalog(ctx context.Context) ([]PartsCatalogEntry, error)
}

// EmptyJobHistory is the default JobHistoryProvider used today. It returns an
// empty history and a nil error so the run continues (Req 5.3).
type EmptyJobHistory struct{}

// History returns an empty slice and nil error, letting the agent degrade
// gracefully while no job history data exists.
func (EmptyJobHistory) History(ctx context.Context, jobID *string) ([]JobHistoryEntry, error) {
	return []JobHistoryEntry{}, nil
}

// EmptyPartsCatalog is the default PartsCatalogProvider used today. It returns
// an empty catalog and a nil error so the run continues (Req 5.5).
type EmptyPartsCatalog struct{}

// Catalog returns an empty slice and nil error, letting the agent degrade
// gracefully while no parts catalog exists.
func (EmptyPartsCatalog) Catalog(ctx context.Context) ([]PartsCatalogEntry, error) {
	return []PartsCatalogEntry{}, nil
}
