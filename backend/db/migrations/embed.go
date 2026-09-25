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

import (
	"embed"
	"io/fs"
)

// FS holds every 0NNN_*.sql migration in this directory. internal/db.Migrate
// applies them in lexical filename order, which is why the numeric prefix is
// zero-padded and fixed width.
//
//go:embed *.sql
var FS embed.FS

var developmentSeedFiles = map[string]struct{}{
	"0009_seed_dev_users.sql":       {},
	"0010_seed_dev_credentials.sql": {},
}

// SchemaFS is the production-safe migration stream. Historical development
// seed migrations remain embedded because they may already be recorded in
// existing databases, but they are never returned to the normal migrator.
// Development data is installed only through the explicit cmd/devseed command.
var SchemaFS fs.FS = filteredFS{source: FS, excluded: developmentSeedFiles}

// DevelopmentSeedFiles returns the historical development seed files in the
// order in which the explicit development seeder must apply them.
func DevelopmentSeedFiles() []string {
	return []string{
		"0009_seed_dev_users.sql",
		"0010_seed_dev_credentials.sql",
	}
}

type filteredFS struct {
	source   fs.ReadDirFS
	excluded map[string]struct{}
}

func (f filteredFS) Open(name string) (fs.File, error) {
	if _, excluded := f.excluded[name]; excluded {
		return nil, &fs.PathError{Op: "open", Path: name, Err: fs.ErrNotExist}
	}
	return f.source.Open(name)
}

func (f filteredFS) ReadDir(name string) ([]fs.DirEntry, error) {
	entries, err := f.source.ReadDir(name)
	if err != nil {
		return nil, err
	}

	filtered := make([]fs.DirEntry, 0, len(entries))
	for _, entry := range entries {
		if _, excluded := f.excluded[entry.Name()]; excluded {
			continue
		}
		filtered = append(filtered, entry)
	}
	return filtered, nil
}
