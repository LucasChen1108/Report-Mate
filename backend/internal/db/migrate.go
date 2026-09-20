package db

import (
	"context"
	"database/sql"
	"fmt"
	"io/fs"
	"log"
	"sort"
)

// createSchemaMigrations is applied before anything else. It is the only
// statement that must be safe to run against an already-migrated database.
const createSchemaMigrations = `
CREATE TABLE IF NOT EXISTS schema_migrations (
    version    TEXT PRIMARY KEY,
    applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
)`

// Migrate applies every *.sql file in source that has not been applied yet, in
// lexical filename order, and records each one in schema_migrations.
//
// There is no migration library here on purpose: the rules this project needs
// are small and fixed (forward-only, additive, ordered, never hand-edit an
// applied file), and a dependency would buy nothing but a CLI we would not run.
//
// Each migration runs inside its own transaction together with the row that
// records it, so a migration and the fact that it was applied either both
// commit or both roll back — the schema can never drift from schema_migrations.
// The first failure stops the run and is returned; later migrations are not
// attempted, because they were written assuming the earlier ones succeeded.
func Migrate(ctx context.Context, pool *sql.DB, source fs.FS) error {
	if _, err := pool.ExecContext(ctx, createSchemaMigrations); err != nil {
		return fmt.Errorf("db: migrate: create schema_migrations: %w", err)
	}

	applied, err := appliedVersions(ctx, pool)
	if err != nil {
		return err
	}

	names, err := fs.Glob(source, "*.sql")
	if err != nil {
		return fmt.Errorf("db: migrate: list migrations: %w", err)
	}
	// Lexical order is the apply order; the zero-padded 0NNN_ prefix is what
	// makes lexical and numeric order the same thing.
	sort.Strings(names)

	for _, name := range names {
		if _, done := applied[name]; done {
			continue
		}
		statements, err := fs.ReadFile(source, name)
		if err != nil {
			return fmt.Errorf("db: migrate: read %s: %w", name, err)
		}
		if err := applyOne(ctx, pool, name, string(statements)); err != nil {
			return err
		}
		log.Printf("db: migrate: applied %s", name)
	}
	return nil
}

// applyOne runs one migration and records it in the same transaction.
func applyOne(ctx context.Context, pool *sql.DB, name, statements string) error {
	tx, err := pool.BeginTx(ctx, nil)
	if err != nil {
		return fmt.Errorf("db: migrate: begin %s: %w", name, err)
	}
	// Rollback is a no-op once the transaction has committed.
	defer func() { _ = tx.Rollback() }()

	if _, err := tx.ExecContext(ctx, statements); err != nil {
		return fmt.Errorf("db: migrate: apply %s: %w", name, err)
	}
	if _, err := tx.ExecContext(ctx, `INSERT INTO schema_migrations (version) VALUES ($1)`, name); err != nil {
		return fmt.Errorf("db: migrate: record %s: %w", name, err)
	}
	if err := tx.Commit(); err != nil {
		return fmt.Errorf("db: migrate: commit %s: %w", name, err)
	}
	return nil
}

// appliedVersions reads the set of migration filenames already recorded as
// applied, so a restart re-applies nothing.
func appliedVersions(ctx context.Context, pool *sql.DB) (map[string]struct{}, error) {
	rows, err := pool.QueryContext(ctx, `SELECT version FROM schema_migrations`)
	if err != nil {
		return nil, fmt.Errorf("db: migrate: read schema_migrations: %w", err)
	}
	defer rows.Close()

	applied := make(map[string]struct{})
	for rows.Next() {
		var version string
		if err := rows.Scan(&version); err != nil {
			return nil, fmt.Errorf("db: migrate: scan schema_migrations: %w", err)
		}
		applied[version] = struct{}{}
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("db: migrate: iterate schema_migrations: %w", err)
	}
	return applied, nil
}
