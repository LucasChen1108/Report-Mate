// Command devseed explicitly installs disposable local development accounts.
// It refuses every environment except ENV=development.
package main

import (
	"context"
	"log"
	"time"

	"github.com/LucasChen1108/Report-Mate/backend/db/migrations"
	"github.com/LucasChen1108/Report-Mate/backend/internal/config"
	"github.com/LucasChen1108/Report-Mate/backend/internal/db"
)

func main() {
	if err := run(); err != nil {
		log.Fatalf("devseed: %v", err)
	}
	log.Print("devseed: development fixtures installed")
}

func run() error {
	cfg, err := config.Load()
	if err != nil {
		return err
	}

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	pool, err := db.Open(ctx, cfg.DatabaseURL)
	if err != nil {
		return err
	}
	defer pool.Close()

	if err := db.Migrate(ctx, pool, migrations.SchemaFS); err != nil {
		return err
	}
	return db.SeedDevelopment(
		ctx,
		pool,
		migrations.FS,
		migrations.DevelopmentSeedFiles(),
		cfg.Env,
	)
}
