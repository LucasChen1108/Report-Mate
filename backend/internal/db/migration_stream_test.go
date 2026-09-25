package db_test

import (
	"io/fs"
	"slices"
	"testing"

	"github.com/LucasChen1108/Report-Mate/backend/db/migrations"
)

func TestSchemaFSExcludesDevelopmentSeeds(t *testing.T) {
	names, err := fs.Glob(migrations.SchemaFS, "*.sql")
	if err != nil {
		t.Fatalf("glob schema migrations: %v", err)
	}

	for _, seed := range migrations.DevelopmentSeedFiles() {
		if slices.Contains(names, seed) {
			t.Fatalf("production schema stream contains development seed %q", seed)
		}
		if _, err := fs.ReadFile(migrations.SchemaFS, seed); err == nil {
			t.Fatalf("production schema stream can read development seed %q", seed)
		}
	}

	for _, required := range []string{
		"0001_users.sql",
		"0011_disable_legacy_dev_credentials.sql",
		"0012_stage_b_accounts.sql",
	} {
		if !slices.Contains(names, required) {
			t.Errorf("production schema stream is missing %q", required)
		}
	}
}

func TestDevelopmentSeedFilesAreEmbedded(t *testing.T) {
	for _, name := range migrations.DevelopmentSeedFiles() {
		if _, err := fs.ReadFile(migrations.FS, name); err != nil {
			t.Errorf("read embedded development seed %q: %v", name, err)
		}
	}
}
