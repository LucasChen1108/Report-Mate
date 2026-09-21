// Package config loads process configuration from the environment.
//
// It is read once at startup by cmd/server and then passed around as a value,
// so nothing deeper in the tree reaches for os.Getenv on its own. Loading fails
// fast and loudly on anything missing rather than letting the server boot into
// a half-configured state and fail on the first request.
//
// Secrets (DATABASE_URL, which carries the password, and JWT_SIGNING_KEY,
// which forges tokens for anyone who learns it) are held here but never logged
// and never included in an error message.
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
	// EnvProduction is the ENV value that demands a real JWT_SIGNING_KEY.
	EnvProduction = "production"

	// devJWTSigningKey is the fallback signing key in development, so a fresh
	// checkout can log in with nothing but DATABASE_URL set. It is a published
	// constant in a public repository — anyone can mint a dispatcher-admin
	// token with it — which is exactly why Load refuses it in production.
	devJWTSigningKey = "reportmate-development-signing-key-do-not-use-in-production"

	// defaultExportDir is where rendered report exports are written. It is a
	// relative path so a checkout runs with no configuration; a deployment
	// points EXPORT_DIR at a real volume that outlives the process.
	defaultExportDir = "./var/exports"
)

// ErrMissingDatabaseURL is returned by Load when DATABASE_URL is unset or
// blank.
var ErrMissingDatabaseURL = errors.New("config: DATABASE_URL is required (e.g. postgres://user:password@host:5432/reportmate?sslmode=disable)")

// ErrMissingJWTSigningKey is returned by Load when ENV=production and
// JWT_SIGNING_KEY is unset, blank, or still the development fallback. Booting
// production with a key the whole internet can read is not a degraded mode; it
// is an open door, so it is a startup failure.
var ErrMissingJWTSigningKey = errors.New("config: JWT_SIGNING_KEY is required when ENV=production and must not be the development default")

// Config is the fully resolved process configuration.
type Config struct {
	// DatabaseURL is the PostgreSQL connection string. SECRET — never log it.
	DatabaseURL string
	// Port is the TCP port the HTTP server listens on.
	Port string
	// Env is the deployment environment: "development" (default) or
	// "production".
	Env string

	// JWTSigningKey is the HMAC secret the auth package signs and validates
	// session tokens with (env JWT_SIGNING_KEY). SECRET — never log it.
	// Guaranteed non-empty: Load either reads a real one or, outside
	// production, substitutes devJWTSigningKey.
	JWTSigningKey string

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
// absent — the one setting with no usable default — and
// ErrMissingJWTSigningKey when production is missing a real signing key.
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

	// The signing key resolves after Env, because whether a missing one is
	// fatal depends on it.
	cfg.JWTSigningKey = valueOr(os.Getenv("JWT_SIGNING_KEY"), devJWTSigningKey)
	if cfg.IsProduction() && cfg.JWTSigningKey == devJWTSigningKey {
		return Config{}, ErrMissingJWTSigningKey
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
