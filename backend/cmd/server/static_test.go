package main

import (
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// writeStaticFixture builds a tiny "frontend/dist" with an index.html and one
// asset, returning the directory.
func writeStaticFixture(t *testing.T) string {
	t.Helper()
	dir := t.TempDir()
	if err := os.WriteFile(filepath.Join(dir, "index.html"), []byte("<!doctype html><title>app</title>"), 0o600); err != nil {
		t.Fatalf("write index.html: %v", err)
	}
	if err := os.MkdirAll(filepath.Join(dir, "assets"), 0o755); err != nil {
		t.Fatalf("mkdir assets: %v", err)
	}
	if err := os.WriteFile(filepath.Join(dir, "assets", "app.js"), []byte("console.log('hi')"), 0o600); err != nil {
		t.Fatalf("write app.js: %v", err)
	}
	return dir
}

func TestSPAFileServerServesExistingFile(t *testing.T) {
	srv := spaFileServer(writeStaticFixture(t))

	rec := httptest.NewRecorder()
	srv.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/assets/app.js", nil))

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", rec.Code)
	}
	if !strings.Contains(rec.Body.String(), "console.log") {
		t.Fatalf("expected the asset body, got %q", rec.Body.String())
	}
}

func TestSPAFileServerFallsBackToIndexForClientRoute(t *testing.T) {
	srv := spaFileServer(writeStaticFixture(t))

	// A deep client-side route that has no file on disk must load the SPA
	// shell so a refresh/deep-link works instead of 404ing.
	rec := httptest.NewRecorder()
	srv.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/reports/123e4567", nil))

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", rec.Code)
	}
	if !strings.Contains(rec.Body.String(), "<title>app</title>") {
		t.Fatalf("expected index.html fallback, got %q", rec.Body.String())
	}
}

func TestSPAFileServerBlocksTraversal(t *testing.T) {
	dir := writeStaticFixture(t)
	// A secret beside (not under) the served dir must never be reachable.
	secret := filepath.Join(filepath.Dir(dir), "secret.txt")
	if err := os.WriteFile(secret, []byte("TOP SECRET"), 0o600); err != nil {
		t.Fatalf("write secret: %v", err)
	}
	srv := spaFileServer(dir)

	rec := httptest.NewRecorder()
	// Raw target with ../ ; ServeMux would clean it in production, but the
	// handler must independently refuse to escape its root.
	req := httptest.NewRequest(http.MethodGet, "/", nil)
	req.URL.Path = "/../secret.txt"
	srv.ServeHTTP(rec, req)

	if strings.Contains(rec.Body.String(), "TOP SECRET") {
		t.Fatalf("traversal leaked a file outside the static dir: %q", rec.Body.String())
	}
}
