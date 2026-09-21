package db

import (
	"context"
	"errors"
	"testing"
	"testing/fstest"
)

func TestSeedDevelopmentRejectsNonDevelopmentEnvironments(t *testing.T) {
	for _, environment := range []string{"", "production", "staging", "test"} {
		t.Run(environment, func(t *testing.T) {
			err := SeedDevelopment(
				context.Background(),
				nil,
				fstest.MapFS{},
				nil,
				environment,
			)
			if !errors.Is(err, ErrDevelopmentSeedForbidden) {
				t.Fatalf("SeedDevelopment() error = %v, want %v", err, ErrDevelopmentSeedForbidden)
			}
		})
	}
}
