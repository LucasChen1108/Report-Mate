// Package parts owns the parts catalog: the shared master list of real parts the
// AI agent matches a technician's free-text mentions against.
//
// It is the concrete implementation of agent.PartsCatalogProvider. The agent
// package defines the interface and the entry DTO (so it has no dependency on
// this package); this package implements the interface and is injected into the
// agent handler in cmd/server, replacing agent.EmptyPartsCatalog. This is the
// same seam pattern the design describes: real data lands here without the
// runner or the tools changing.
//
// This is distinct from reports.PartRow / the parts_used table, which records
// the parts a technician actually consumed on one report. The catalog is the
// list of parts that exist to be chosen from.
package parts

import (
	"context"
	"database/sql"
	"fmt"

	"github.com/LucasChen1108/Report-Mate/backend/internal/agent"
)

// Catalog reads the parts_catalog table. It implements
// agent.PartsCatalogProvider, so the agent's get_parts_catalog tool calls
// Catalog(ctx) to fetch the full list to match against.
type Catalog struct {
	db *sql.DB
}

// NewCatalog builds a Catalog over the given database handle.
func NewCatalog(db *sql.DB) *Catalog {
	return &Catalog{db: db}
}

// Catalog returns every catalogued part, ordered by part name so the list the
// agent sees is stable across calls. A read error is returned so the tool can
// report it (and the run continues without the context); an empty table is a
// non-error empty slice.
func (c *Catalog) Catalog(ctx context.Context) ([]agent.PartsCatalogEntry, error) {
	rows, err := c.db.QueryContext(ctx,
		`SELECT part, part_number FROM parts_catalog ORDER BY part`)
	if err != nil {
		return nil, fmt.Errorf("parts: query catalog: %w", err)
	}
	defer rows.Close()

	entries := make([]agent.PartsCatalogEntry, 0)
	for rows.Next() {
		var e agent.PartsCatalogEntry
		if err := rows.Scan(&e.Part, &e.PartNumber); err != nil {
			return nil, fmt.Errorf("parts: scan catalog row: %w", err)
		}
		entries = append(entries, e)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("parts: iterate catalog: %w", err)
	}
	return entries, nil
}

// Compile-time assurance that *Catalog satisfies the agent's provider interface.
var _ agent.PartsCatalogProvider = (*Catalog)(nil)
