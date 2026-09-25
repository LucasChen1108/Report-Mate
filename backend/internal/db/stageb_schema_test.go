package db_test

import (
	"context"
	"database/sql"
	"errors"
	"os"
	"testing"

	"github.com/LucasChen1108/Report-Mate/backend/db/migrations"
	database "github.com/LucasChen1108/Report-Mate/backend/internal/db"
	"github.com/jackc/pgx/v5/pgconn"
	_ "github.com/jackc/pgx/v5/stdlib"
)

// This suite intentionally requires a scratch database. It applies the full
// production migration stream and rolls its fixture writes back.
func TestStageBSchemaEnforcesCrossKindEmailUniqueness(t *testing.T) {
	testURL := os.Getenv("STAGE_B_TEST_DATABASE_URL")
	if testURL == "" {
		t.Skip("STAGE_B_TEST_DATABASE_URL not set; skipping Stage B schema integration test")
	}

	pool, err := sql.Open("pgx", testURL)
	if err != nil {
		t.Fatalf("open test database: %v", err)
	}
	t.Cleanup(func() { _ = pool.Close() })

	ctx := context.Background()
	if err := database.Migrate(ctx, pool, migrations.SchemaFS); err != nil {
		t.Fatalf("apply production migration stream: %v", err)
	}

	tx, err := pool.BeginTx(ctx, nil)
	if err != nil {
		t.Fatalf("begin fixture transaction: %v", err)
	}
	t.Cleanup(func() { _ = tx.Rollback() })

	const companyID = "31000000-0000-4000-8000-000000000001"
	const firstUserID = "31000000-0000-4000-8000-000000000002"
	const secondUserID = "31000000-0000-4000-8000-000000000003"

	if _, err := tx.ExecContext(ctx, `
		INSERT INTO companies (id, name, normalized_name)
		VALUES ($1, 'Stage B Schema Test', 'stage b schema test')`, companyID); err != nil {
		t.Fatalf("insert company: %v", err)
	}
	for _, fixture := range []struct {
		id    string
		email string
	}{
		{id: firstUserID, email: "legacy-one@example.test"},
		{id: secondUserID, email: "legacy-two@example.test"},
	} {
		if _, err := tx.ExecContext(ctx, `
			INSERT INTO users (id, name, email, role, company_id)
			VALUES ($1, 'Schema Test User', $2, 'technician', $3)`,
			fixture.id, fixture.email, companyID); err != nil {
			t.Fatalf("insert user %s: %v", fixture.id, err)
		}
	}

	if _, err := tx.ExecContext(ctx, `
		INSERT INTO user_login_emails (normalized_email, user_id, email_kind)
		VALUES ('shared@example.test', $1, 'personal')`, firstUserID); err != nil {
		t.Fatalf("insert first login identity: %v", err)
	}

	_, err = tx.ExecContext(ctx, `
		INSERT INTO user_login_emails (normalized_email, user_id, email_kind)
		VALUES ('shared@example.test', $1, 'company')`, secondUserID)
	var pgErr *pgconn.PgError
	if !errors.As(err, &pgErr) || pgErr.Code != "23505" {
		t.Fatalf("duplicate cross-kind email error = %v, want PostgreSQL unique violation", err)
	}
}
