// Package migrations embeds the ordered SQL migration files that live beside
// this file so they travel inside the compiled binary — the server applies its
// own schema at startup with no files to ship and no migration tooling to
// install.
//
// This file exists here, rather than in a parent directory, because //go:embed
// cannot reach upwards out of its own package directory. Keeping it inside
// db/migrations/ leaves the SQL where every convention (and the README) says it
// lives. Only *.sql is embedded, so this file and the README are excluded.
//
// The runner that consumes this FS is internal/db.Migrate.
package migrations

import "embed"

// FS holds every 0NNN_*.sql migration in this directory. internal/db.Migrate
// applies them in lexical filename order, which is why the numeric prefix is
// zero-padded and fixed width.
//
//go:embed *.sql
var FS embed.FS
