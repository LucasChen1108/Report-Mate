// Package main is the Report Mate backend process entrypoint.
//
// It composes the application and does nothing else. The startup order below is
// deliberate — each step depends on the one before it:
//
//	config -> database pool -> migrations -> stores/handlers -> middleware ->
//	routes -> listen, then graceful shutdown on SIGINT/SIGTERM.
//
// Migrations run before any handler is constructed so the process either has
// the schema its stores assume or refuses to start; a server that boots against
// a half-migrated database fails later, in production, in a much worse way.
//
// KEEP BUSINESS LOGIC OUT OF THIS FILE. Everything here is wiring: if a change
// needs to know what a report or a template *is*, it belongs in that domain
// package instead.
package main

import (
	"context"
	"errors"
	"fmt"
	"log"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/LucasChen1108/Report-Mate/backend/db/migrations"
	"github.com/LucasChen1108/Report-Mate/backend/internal/agent"
	"github.com/LucasChen1108/Report-Mate/backend/internal/auth"
	"github.com/LucasChen1108/Report-Mate/backend/internal/config"
	"github.com/LucasChen1108/Report-Mate/backend/internal/dashboard"
	"github.com/LucasChen1108/Report-Mate/backend/internal/db"
	"github.com/LucasChen1108/Report-Mate/backend/internal/jobs"
	"github.com/LucasChen1108/Report-Mate/backend/internal/parts"
	"github.com/LucasChen1108/Report-Mate/backend/internal/reports"
	"github.com/LucasChen1108/Report-Mate/backend/internal/templates"
)

const (
	// maxReportBodyBytes caps report write bodies at 32 MB.
	//
	// That is enormous for a JSON API, and it is intentional: photos and
	// signatures are currently stored as inline base64 data URLs inside the
	// report content, so a multi-photo report legitimately runs to tens of
	// megabytes. This is a known, accepted tradeoff for the hackathon build —
	// when attachments move to real object storage the bodies shrink to
	// kilobytes and this limit should come down with them.
	maxReportBodyBytes = 32 << 20

	// Server timeouts. WriteTimeout is generous because report export renders
	// a document; ReadHeaderTimeout is tight because headers are never large.
	readHeaderTimeout = 10 * time.Second
	readTimeout       = 60 * time.Second
	writeTimeout      = 120 * time.Second
	idleTimeout       = 120 * time.Second

	// shutdownGrace is how long in-flight requests get to finish after a
	// SIGINT/SIGTERM before the process exits anyway.
	shutdownGrace = 15 * time.Second
)

func main() {
	if err := run(); err != nil {
		// log.Fatal rather than a panic: a configuration or database failure
		// at startup is an operator problem, not a bug worth a stack trace.
		log.Fatalf("server: %v", err)
	}
}

// run performs startup, serves until a shutdown signal arrives, and returns the
// first error that prevented any of it. It exists so every resource opened here
// gets a defer that actually runs — which os.Exit inside main would skip.
func run() error {
	cfg, err := config.Load()
	if err != nil {
		return err
	}

	// Startup gets its own cancellable context so a hung database dial cannot
	// wedge the process forever.
	startupCtx, cancelStartup := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancelStartup()

	pool, err := db.Open(startupCtx, cfg.DatabaseURL)
	if err != nil {
		return err
	}
	defer pool.Close()
	log.Printf("server: connected to postgres")

	if err := db.Migrate(startupCtx, pool, migrations.FS); err != nil {
		return err
	}
	log.Printf("server: migrations up to date")

	// Stores and handlers. Each domain package owns its own persistence; this
	// file only hands each one the pool.
	templatesHandler := templates.NewHandler(templates.NewPostgresStore(pool))
	dashboardHandler := dashboard.NewHandler(pool)
	reportsHandler := reports.NewHandler(pool)

	// The agent handler builds its own gateway client from config, or leaves it
	// nil when the gateway is unconfigured (cfg.AgentConfigured() is false), in
	// which case the agent-fill endpoint answers 503 and the manual fill path
	// keeps working. The chatClient interface is unexported by the agent
	// package, so this file hands the raw URL/key/model to
	// NewHandlerFromConfig and lets that package own the nil decision.
	//
	// The two context providers now back the get_job_history and
	// get_parts_catalog tools with real data (the jobs seed and the
	// parts_catalog table), replacing the earlier Empty* defaults. Both satisfy
	// the agent's provider interfaces and are read-only over the pool.
	agentHandler := agent.NewHandlerFromConfig(
		pool,
		cfg.LLMGatewayURL,
		cfg.LLMGatewayAPIKey,
		cfg.LLMModel,
		jobs.NewHistory(pool),
		parts.NewCatalog(pool),
		cfg.ConversationTurnCap,
		cfg.ConversationQuestionCap,
	)

	mux := http.NewServeMux()
	templatesHandler.RegisterRoutes(mux)
	dashboardHandler.RegisterRoutes(mux)
	mountReports(mux, reportsHandler, agentHandler)

	identity := auth.Install(mux, pool, cfg.JWTSigningKey)

	// The identity middleware wraps the whole mux so every route — including
	// the RBAC-gated template writes, which read the role back out of the
	// request context — sees a populated identity.
	srv := &http.Server{
		Addr:              ":" + cfg.Port,
		Handler:           identity(mux),
		ReadHeaderTimeout: readHeaderTimeout,
		ReadTimeout:       readTimeout,
		WriteTimeout:      writeTimeout,
		IdleTimeout:       idleTimeout,
	}

	return serve(srv, cfg)
}

// mountReports registers the reports and agent routes behind a request-body
// size limit.
//
// The routes are registered on their own mux, which the root mux then delegates
// the whole /api/reports subtree to. ServeMux does not rewrite the path on the
// way through, so the inner mux still matches its full "POST /api/reports"
// style patterns — this just buys one place to wrap every report route at once,
// without the reports package having to know about the limit.
//
// The agent handler registers "POST /api/reports/{id}/agent-fill" on the SAME
// inner mux so agent-fill inherits both the 32 MB body limit (applied here) and
// the identity middleware (applied to the whole top-level mux in run()) — the
// agent writes photo-bearing report content through the same path, and its
// ownership guard reads the identity out of the request context.
func mountReports(root *http.ServeMux, handler *reports.Handler, agentHandler *agent.Handler) {
	reportsMux := http.NewServeMux()
	handler.RegisterRoutes(reportsMux)
	agentHandler.RegisterRoutes(reportsMux)

	limited := limitRequestBody(reportsMux, maxReportBodyBytes)
	// Both patterns are needed: "/api/reports" matches the collection exactly,
	// "/api/reports/" the subtree beneath it.
	root.Handle("/api/reports", limited)
	root.Handle("/api/reports/", limited)
}

// limitRequestBody caps the request body at max bytes for the methods that
// carry one. A request over the limit fails at read time inside the handler,
// which surfaces it as a decode error rather than a truncated body silently
// being parsed as valid.
func limitRequestBody(next http.Handler, max int64) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.Method {
		case http.MethodPost, http.MethodPut, http.MethodPatch:
			r.Body = http.MaxBytesReader(w, r.Body, max)
		}
		next.ServeHTTP(w, r)
	})
}

// serve starts the listener and blocks until SIGINT or SIGTERM, then drains
// in-flight requests within shutdownGrace before returning.
func serve(srv *http.Server, cfg config.Config) error {
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	errs := make(chan error, 1)
	go func() {
		log.Printf("server: listening on %s (env=%s)", srv.Addr, cfg.Env)
		if err := srv.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			errs <- fmt.Errorf("server: listen: %w", err)
			return
		}
		errs <- nil
	}()

	select {
	case err := <-errs:
		return err
	case <-ctx.Done():
		log.Printf("server: shutdown signal received, draining for up to %s", shutdownGrace)
	}

	shutdownCtx, cancel := context.WithTimeout(context.Background(), shutdownGrace)
	defer cancel()
	if err := srv.Shutdown(shutdownCtx); err != nil {
		return fmt.Errorf("server: shutdown: %w", err)
	}
	log.Printf("server: stopped cleanly")
	return nil
}
