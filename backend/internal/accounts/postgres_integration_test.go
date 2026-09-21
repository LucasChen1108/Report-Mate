package accounts

import (
	"bytes"
	"context"
	"database/sql"
	"errors"
	"fmt"
	"os"
	"sync"
	"testing"
	"time"

	"github.com/LucasChen1108/Report-Mate/backend/db/migrations"
	database "github.com/LucasChen1108/Report-Mate/backend/internal/db"
	"github.com/LucasChen1108/Report-Mate/backend/internal/security"
	_ "github.com/jackc/pgx/v5/stdlib"
)

func TestPostgresStoreRegistrationSessionsAndOwnership(t *testing.T) {
	testURL := os.Getenv("STAGE_B_TEST_DATABASE_URL")
	if testURL == "" {
		t.Skip("STAGE_B_TEST_DATABASE_URL not set; skipping account store integration tests")
	}

	pool, err := sql.Open("pgx", testURL)
	if err != nil {
		t.Fatalf("open test database: %v", err)
	}
	t.Cleanup(func() { _ = pool.Close() })
	ctx := context.Background()
	if err := database.Migrate(ctx, pool, migrations.SchemaFS); err != nil {
		t.Fatalf("migrate test database: %v", err)
	}

	store := NewPostgresStore(pool)
	now := time.Now().UTC().Truncate(time.Second)
	companyID := mustID(t)
	otherCompanyID := mustID(t)
	companySuffix := companyID[:8]
	otherSuffix := otherCompanyID[:8]

	cleanupCompanyIDs := []string{companyID, otherCompanyID}
	t.Cleanup(func() {
		for _, id := range cleanupCompanyIDs {
			_, _ = pool.ExecContext(context.Background(), `DELETE FROM worker_join_codes WHERE company_id = $1`, id)
			_, _ = pool.ExecContext(context.Background(), `DELETE FROM company_admin_codes WHERE company_id = $1`, id)
			_, _ = pool.ExecContext(context.Background(), `DELETE FROM users WHERE company_id = $1`, id)
			_, _ = pool.ExecContext(context.Background(), `DELETE FROM companies WHERE id = $1`, id)
		}
	})

	createCompany := func(id, suffix string) {
		t.Helper()
		name := "Stage B Store Test " + suffix
		if err := store.CreateCompany(ctx, Company{ID: id, Name: name}); err != nil {
			t.Fatalf("create company: %v", err)
		}
	}
	createCompany(companyID, companySuffix)
	createCompany(otherCompanyID, otherSuffix)

	registerAdmin := func(companyID, suffix string) (Account, []byte) {
		t.Helper()
		codeRaw, err := security.GenerateAuthorizationCode("ADMIN")
		if err != nil {
			t.Fatalf("generate admin code: %v", err)
		}
		codeHash := security.HashSecret(codeRaw)
		if err := store.CreateCompanyAdminCode(ctx, NewCompanyAdminCode{
			ID: mustID(t), CompanyID: companyID, CodeHash: codeHash,
			MaxUses: 1, ExpiresAt: now.Add(time.Hour),
		}); err != nil {
			t.Fatalf("create admin code: %v", err)
		}

		passwordHash, err := security.HashPassword("StrongPassword9")
		if err != nil {
			t.Fatalf("hash password: %v", err)
		}
		tokenRaw, err := security.GenerateOpaqueToken()
		if err != nil {
			t.Fatalf("generate session token: %v", err)
		}
		input := NewAccount{
			ID: mustID(t), FullName: "Admin " + suffix,
			Company: "Stage B Store Test " + suffix, Phone: "+65 6123 4567",
			PersonalEmail: fmt.Sprintf("admin.personal.%s@example.test", suffix),
			CompanyEmail:  fmt.Sprintf("admin.%s@company.test", suffix),
			PasswordHash:  passwordHash,
		}
		account, err := store.RegisterAdmin(ctx, input, codeHash, NewSession{
			ID: mustID(t), TokenHash: security.HashSecret(tokenRaw), ExpiresAt: now.Add(time.Hour),
		}, now)
		if err != nil {
			t.Fatalf("register admin: %v", err)
		}
		return account, security.HashSecret(tokenRaw)
	}

	admin, adminTokenHash := registerAdmin(companyID, companySuffix)
	otherAdmin, _ := registerAdmin(otherCompanyID, otherSuffix)

	for _, email := range []string{admin.PersonalEmail, admin.CompanyEmail} {
		found, err := store.FindByEmail(ctx, email)
		if err != nil || found.ID != admin.ID {
			t.Fatalf("FindByEmail(%q) = (%s, %v), want %s", email, found.ID, err, admin.ID)
		}
	}
	credentials, err := store.FindCredentialsByEmail(ctx, admin.CompanyEmail)
	if err != nil || credentials.Account.ID != admin.ID || credentials.PasswordHash == "" {
		t.Fatalf("FindCredentialsByEmail() = (%s, hash=%t, %v)", credentials.Account.ID, credentials.PasswordHash != "", err)
	}
	principal, err := store.FindSession(ctx, adminTokenHash, now)
	if err != nil || principal.Account.ID != admin.ID {
		t.Fatalf("FindSession() account = %s, error = %v", principal.Account.ID, err)
	}

	joinRaw, err := security.GenerateAuthorizationCode("WORKER")
	if err != nil {
		t.Fatalf("generate worker code: %v", err)
	}
	joinHash := security.HashSecret(joinRaw)
	joinCodeID := mustID(t)
	if _, err := store.CreateWorkerJoinCode(ctx, admin.ID, NewWorkerJoinCode{
		ID: joinCodeID, CodeHash: joinHash, ExpiresAt: now.Add(time.Hour),
	}, now); err != nil {
		t.Fatalf("create worker join code: %v", err)
	}

	passwordHash, err := security.HashPassword("WorkerPassword9")
	if err != nil {
		t.Fatalf("hash worker password: %v", err)
	}
	type registrationResult struct {
		account Account
		err     error
	}
	results := make(chan registrationResult, 2)
	start := make(chan struct{})
	var wait sync.WaitGroup
	type workerAttempt struct {
		input   NewAccount
		session NewSession
	}
	attempts := make([]workerAttempt, 0, 2)
	for index := 1; index <= 2; index++ {
		token, err := security.GenerateOpaqueToken()
		if err != nil {
			t.Fatalf("generate worker session token: %v", err)
		}
		attempts = append(attempts, workerAttempt{
			input: NewAccount{
				ID: mustID(t), FullName: fmt.Sprintf("Worker %d", index),
				Company: admin.CompanyName, Phone: "+65 6987 6543",
				PersonalEmail: fmt.Sprintf("worker.%d.%s@example.test", index, companySuffix),
				CompanyEmail:  fmt.Sprintf("worker.%d.%s@company.test", index, companySuffix),
				PasswordHash:  passwordHash,
			},
			session: NewSession{
				ID: mustID(t), TokenHash: security.HashSecret(token), ExpiresAt: now.Add(time.Hour),
			},
		})
	}
	for _, attempt := range attempts {
		attempt := attempt
		wait.Add(1)
		go func() {
			defer wait.Done()
			<-start
			account, registerErr := store.RegisterWorker(
				ctx, attempt.input, joinHash, attempt.session, now,
			)
			results <- registrationResult{account: account, err: registerErr}
		}()
	}
	close(start)
	wait.Wait()
	close(results)

	var winner Account
	successes, usedFailures := 0, 0
	for result := range results {
		switch {
		case result.err == nil:
			successes++
			winner = result.account
		case errors.Is(result.err, ErrUsedCode):
			usedFailures++
		default:
			t.Fatalf("unexpected concurrent registration error: %v", result.err)
		}
	}
	if successes != 1 || usedFailures != 1 {
		t.Fatalf("concurrent results: successes=%d used=%d, want 1 and 1", successes, usedFailures)
	}
	if winner.ManagerAdminID == nil || *winner.ManagerAdminID != admin.ID {
		t.Fatalf("worker manager = %v, want %s", winner.ManagerAdminID, admin.ID)
	}

	workers, err := store.ListWorkers(ctx, admin.ID)
	if err != nil || len(workers) != 1 || workers[0].ID != winner.ID {
		t.Fatalf("admin workers = %#v, error = %v", workers, err)
	}
	otherWorkers, err := store.ListWorkers(ctx, otherAdmin.ID)
	if err != nil || len(otherWorkers) != 0 {
		t.Fatalf("other admin workers = %#v, error = %v", otherWorkers, err)
	}
	if _, err := store.RevokeWorkerJoinCode(ctx, otherAdmin.ID, joinCodeID, now); !errors.Is(err, ErrNotFound) {
		t.Fatalf("cross-admin revoke error = %v, want ErrNotFound", err)
	}

	var persistedTokenHash []byte
	if err := pool.QueryRowContext(ctx, `SELECT token_hash FROM sessions WHERE user_id = $1`, admin.ID).
		Scan(&persistedTokenHash); err != nil {
		t.Fatalf("read persisted token hash: %v", err)
	}
	if !bytes.Equal(persistedTokenHash, adminTokenHash) || bytes.Contains(persistedTokenHash, []byte("reportmate")) {
		t.Fatal("session persistence did not contain exactly the expected fixed-width hash")
	}
}

func mustID(t *testing.T) string {
	t.Helper()
	id, err := security.NewUUID()
	if err != nil {
		t.Fatalf("generate UUID: %v", err)
	}
	return id
}
