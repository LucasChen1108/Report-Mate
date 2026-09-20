package templates

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	// pgx stdlib driver registers itself as the "pgx" database/sql driver.
	// It is imported here so a *sql.DB opened with it works out of the box;
	// the actual DB wiring (opening the pool) happens in cmd/server.
	_ "github.com/jackc/pgx/v5/stdlib"
)

// ErrNotFound is returned by Get and Update when no report_templates row
// matches the requested id. Callers (e.g. the HTTP handlers) map this to a
// 404 response.
var ErrNotFound = errors.New("template not found")

// TemplateSummary is the lightweight view of a template used for listing.
// Its JSON shape mirrors the frontend api/templates.ts TemplateSummary type.
type TemplateSummary struct {
	ID        string    `json:"id"`
	Name      string    `json:"name"`
	IsSeed    bool      `json:"isSeed"`
	UpdatedAt time.Time `json:"updatedAt"`
}

// TemplateRecord is the full view of a persisted template, including its
// schema. Its JSON shape mirrors the frontend api/templates.ts TemplateRecord
// type.
type TemplateRecord struct {
	ID        string         `json:"id"`
	Name      string         `json:"name"`
	Schema    TemplateSchema `json:"schema"`
	IsSeed    bool           `json:"isSeed"`
	CreatedAt time.Time      `json:"createdAt"`
	UpdatedAt time.Time      `json:"updatedAt"`
}

// Store owns report_templates persistence. Implementations map the schema to
// and from the jsonb column and surface ErrNotFound for unknown ids on Get and
// Update.
type Store interface {
	// List returns a summary of every template, most recently updated first.
	List(ctx context.Context) ([]TemplateSummary, error)
	// Get returns the full template for id, or ErrNotFound if none exists.
	Get(ctx context.Context, id string) (TemplateRecord, error)
	// Create inserts a new custom template (is_seed = false) and returns the
	// persisted record.
	Create(ctx context.Context, name string, schema TemplateSchema) (TemplateRecord, error)
	// Update replaces the name and schema of an existing template, refreshes
	// updated_at, and returns the persisted record; it returns ErrNotFound if
	// no template has the given id.
	Update(ctx context.Context, id, name string, schema TemplateSchema) (TemplateRecord, error)
}

// PostgresStore is a PostgreSQL-backed Store built on a *sql.DB. It is created
// with NewPostgresStore so the DB (typically opened with the pgx stdlib
// driver) can be wired in from cmd/server and swapped in tests.
type PostgresStore struct {
	db *sql.DB
}

// NewPostgresStore returns a PostgresStore backed by db. db is expected to be
// a *sql.DB opened against PostgreSQL (e.g. via the pgx stdlib driver).
func NewPostgresStore(db *sql.DB) *PostgresStore {
	return &PostgresStore{db: db}
}

// compile-time assertion that PostgresStore satisfies Store.
var _ Store = (*PostgresStore)(nil)

// List implements Store.
func (s *PostgresStore) List(ctx context.Context) ([]TemplateSummary, error) {
	const query = `
		SELECT id, name, is_seed, updated_at
		FROM report_templates
		ORDER BY updated_at DESC`

	rows, err := s.db.QueryContext(ctx, query)
	if err != nil {
		return nil, fmt.Errorf("templates: list: %w", err)
	}
	defer rows.Close()

	summaries := make([]TemplateSummary, 0)
	for rows.Next() {
		var summary TemplateSummary
		if err := rows.Scan(&summary.ID, &summary.Name, &summary.IsSeed, &summary.UpdatedAt); err != nil {
			return nil, fmt.Errorf("templates: list scan: %w", err)
		}
		summaries = append(summaries, summary)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("templates: list rows: %w", err)
	}
	return summaries, nil
}

// Get implements Store. It returns ErrNotFound when no row matches id.
func (s *PostgresStore) Get(ctx context.Context, id string) (TemplateRecord, error) {
	const query = `
		SELECT id, name, schema, is_seed, created_at, updated_at
		FROM report_templates
		WHERE id = $1`

	row := s.db.QueryRowContext(ctx, query, id)
	return scanRecord(row)
}

// Create implements Store. New templates are always custom (is_seed = false);
// created_at and updated_at default to now() at the database level.
func (s *PostgresStore) Create(ctx context.Context, name string, schema TemplateSchema) (TemplateRecord, error) {
	raw, err := json.Marshal(schema)
	if err != nil {
		return TemplateRecord{}, fmt.Errorf("templates: create marshal schema: %w", err)
	}

	const query = `
		INSERT INTO report_templates (name, schema)
		VALUES ($1, $2)
		RETURNING id, name, schema, is_seed, created_at, updated_at`

	row := s.db.QueryRowContext(ctx, query, name, raw)
	rec, err := scanRecord(row)
	if err != nil {
		if errors.Is(err, ErrNotFound) {
			// RETURNING on a successful INSERT always yields a row; treat a
			// missing row as an unexpected error rather than a not-found.
			return TemplateRecord{}, fmt.Errorf("templates: create returned no row")
		}
		return TemplateRecord{}, err
	}
	return rec, nil
}

// Update implements Store. It refreshes updated_at to now() and returns
// ErrNotFound when no row matches id.
func (s *PostgresStore) Update(ctx context.Context, id, name string, schema TemplateSchema) (TemplateRecord, error) {
	raw, err := json.Marshal(schema)
	if err != nil {
		return TemplateRecord{}, fmt.Errorf("templates: update marshal schema: %w", err)
	}

	const query = `
		UPDATE report_templates
		SET name = $2, schema = $3, updated_at = now()
		WHERE id = $1
		RETURNING id, name, schema, is_seed, created_at, updated_at`

	row := s.db.QueryRowContext(ctx, query, id, name, raw)
	return scanRecord(row)
}

// scanRecord scans a single report_templates row into a TemplateRecord,
// unmarshaling the jsonb schema column. A sql.ErrNoRows result is translated
// into ErrNotFound so callers can distinguish "unknown id" from other errors.
func scanRecord(row *sql.Row) (TemplateRecord, error) {
	var (
		rec       TemplateRecord
		rawSchema []byte
	)
	err := row.Scan(&rec.ID, &rec.Name, &rawSchema, &rec.IsSeed, &rec.CreatedAt, &rec.UpdatedAt)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return TemplateRecord{}, ErrNotFound
		}
		return TemplateRecord{}, fmt.Errorf("templates: scan record: %w", err)
	}
	if err := json.Unmarshal(rawSchema, &rec.Schema); err != nil {
		return TemplateRecord{}, fmt.Errorf("templates: unmarshal schema for %q: %w", rec.ID, err)
	}
	return rec, nil
}
