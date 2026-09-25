package db

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"io/fs"
)

// ErrDevelopmentSeedForbidden is returned when development fixtures are
// requested outside the explicitly named development environment.
var ErrDevelopmentSeedForbidden = errors.New("db: development seeds require ENV=development")

// SeedDevelopment applies the named fixture files in one transaction. It does
// not add them to schema_migrations: fixtures are opt-in data, not schema, and
// may be reapplied when a developer deliberately resets the demo accounts.
func SeedDevelopment(
	ctx context.Context,
	pool *sql.DB,
	source fs.FS,
	files []string,
	environment string,
) error {
	if environment != "development" {
		return ErrDevelopmentSeedForbidden
	}

	tx, err := pool.BeginTx(ctx, nil)
	if err != nil {
		return fmt.Errorf("db: seed development: begin: %w", err)
	}
	defer func() { _ = tx.Rollback() }()

	for _, name := range files {
		statements, err := fs.ReadFile(source, name)
		if err != nil {
			return fmt.Errorf("db: seed development: read %s: %w", name, err)
		}
		if _, err := tx.ExecContext(ctx, string(statements)); err != nil {
			return fmt.Errorf("db: seed development: apply %s: %w", name, err)
		}
	}

	if err := tx.Commit(); err != nil {
		return fmt.Errorf("db: seed development: commit: %w", err)
	}
	return nil
}
