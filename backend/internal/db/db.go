// Package db owns the PostgreSQL connection and the schema migration runner.
//
// It deliberately holds no domain knowledge: it hands cmd/server a live
// *sql.DB and applies the embedded migrations. Every domain package
// (templates, reports, dashboard, ...) receives that *sql.DB and builds its own
// store on top.
package db

import (
	"context"
	"database/sql"
	"fmt"
	"time"

	// The pgx stdlib driver registers itself as the "pgx" database/sql driver.
	// The whole backend speaks database/sql rather than pgx's native API so
	// stores stay swappable in tests; pgx is just the wire implementation.
	_ "github.com/jackc/pgx/v5/stdlib"
)

// Connection pool bounds. A hackathon-sized Lightsail Postgres has a modest
// max_connections, and the box also runs the Go server, so the pool is kept
// small on purpose rather than left at database/sql's unlimited default.
const (
	maxOpenConns    = 10
	maxIdleConns    = 5
	connMaxLifetime = 30 * time.Minute
	connMaxIdleTime = 5 * time.Minute
)

// Open dials PostgreSQL with databaseURL, configures the pool, and verifies the
// connection with a ping before returning — so a bad URL or an unreachable
// database fails at startup with a clear error rather than on the first
// request. The caller owns the returned *sql.DB and must Close it.
//
// databaseURL is a secret (it carries the password) and is never logged here or
// included in a returned error.
func Open(ctx context.Context, databaseURL string) (*sql.DB, error) {
	pool, err := sql.Open("pgx", databaseURL)
	if err != nil {
		// sql.Open only parses; wrap without echoing the URL itself.
		return nil, fmt.Errorf("db: open: %w", err)
	}

	pool.SetMaxOpenConns(maxOpenConns)
	pool.SetMaxIdleConns(maxIdleConns)
	pool.SetConnMaxLifetime(connMaxLifetime)
	pool.SetConnMaxIdleTime(connMaxIdleTime)

	if err := pool.PingContext(ctx); err != nil {
		pool.Close()
		return nil, fmt.Errorf("db: ping: %w", err)
	}
	return pool, nil
}
