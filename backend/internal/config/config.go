// Package config loads process configuration from the environment.
//
// It is read once at startup by cmd/server and then passed around as a value,
// so nothing deeper in the tree reaches for os.Getenv on its own. Loading fails
// fast and loudly on anything missing rather than letting the server boot into
// a half-configured state and fail on the first request.
//
// DATABASE_URL carries a password and is held here but never logged or included
// in an error message.
package config

import (
	"errors"
	"os"
	"strings"
)

// Defaults for every optional setting. DATABASE_URL has no default on purpose —
// there is no sane guess for it, and silently pointing at localhost would be
// worse than refusing to start.
const (
	defaultPort = "8080"
	// EnvDevelopment is the default ENV value.
	EnvDevelopment = "development"
	// EnvProduction enables production-only security settings such as Secure
	// session cookies.
	EnvProduction = "production"

	// defaultExportDir is where rendered report exports are written. It is a
	// relative path so a checkout runs with no configuration; a deployment
	// points EXPORT_DIR at a real volume that outlives the process.
	defaultExportDir = "./var/exports"
)

// ErrMissingDatabaseURL is returned by Load when DATABASE_URL is unset or
// blank.
var ErrMissingDatabaseURL = errors.New("config: DATABASE_URL is required (e.g. postgres://user:password@host:5432/reportmate?sslmode=disable)")

// Config is the fully resolved process configuration.
type Config struct {
	// DatabaseURL is the PostgreSQL connection string. SECRET — never log it.
	DatabaseURL string
	// Port is the TCP port the HTTP server listens on.
	Port string
	// Env is the deployment environment: "development" (default) or
	// "production".
	Env string

	// ExportDir is the directory rendered report exports are written to
	// (env EXPORT_DIR). The reports package writes an HTML snapshot there on
	// save-and-export and records its path in attachments.storage_key.
	ExportDir string
}

// IsProduction reports whether the process is configured as production.
func (c Config) IsProduction() bool {
	return c.Env == EnvProduction
}

// Load reads the configuration from the environment, applying defaults for
// every optional setting. It returns ErrMissingDatabaseURL when DATABASE_URL is
// absent — the one setting with no usable default.
func Load() (Config, error) {
	databaseURL := strings.TrimSpace(os.Getenv("DATABASE_URL"))
	if databaseURL == "" {
		return Config{}, ErrMissingDatabaseURL
	}

	cfg := Config{
		DatabaseURL: databaseURL,
		Port:        valueOr(os.Getenv("PORT"), defaultPort),
		Env:         valueOr(os.Getenv("ENV"), EnvDevelopment),
		ExportDir:   valueOr(os.Getenv("EXPORT_DIR"), defaultExportDir),
	}

	return cfg, nil
}

// valueOr returns the trimmed value when it is non-empty, otherwise fallback.
func valueOr(value, fallback string) string {
	if trimmed := strings.TrimSpace(value); trimmed != "" {
		return trimmed
	}
	return fallback
}
