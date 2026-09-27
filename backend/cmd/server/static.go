package main

import (
	"net/http"
	"os"
	"path/filepath"
	"strings"
)

// spaFileServer serves a built single-page app from dir with history-API
// fallback: a request for an existing file (index.html, /assets/app.js, a
// favicon) is served as-is, and any other path — a client-side route like
// /reports/123 the React router owns — falls back to index.html so a deep-link
// or a refresh loads the app instead of 404ing.
//
// It is mounted as the LAST, catch-all route in newApplicationHandler, so it
// only ever sees requests that did not match an /api or /auth pattern. API 404s
// therefore still come from the API mux, not from this handler returning
// index.html for a mistyped API path — those paths are matched (and rejected)
// upstream before control reaches here.
//
// dir is the frontend build directory (config.StaticDir, e.g. frontend/dist).
// The caller only mounts this when dir is non-empty, so production serves the
// app and dev/tests (empty StaticDir) keep the API-only behaviour with the Vite
// dev server proxying instead.
func spaFileServer(dir string) http.Handler {
	fileServer := http.FileServer(http.Dir(dir))
	indexPath := filepath.Join(dir, "index.html")

	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// Only GET/HEAD serve static content; anything else that reaches the
		// fallback is a route that does not exist for a non-idempotent method.
		if r.Method != http.MethodGet && r.Method != http.MethodHead {
			http.NotFound(w, r)
			return
		}

		// Resolve the request to a file under dir. filepath.Clean on the joined
		// path prevents "../" traversal from escaping the build directory.
		clean := filepath.Clean(r.URL.Path)
		candidate := filepath.Join(dir, clean)
		if !strings.HasPrefix(candidate, filepath.Clean(dir)) {
			http.NotFound(w, r)
			return
		}

		// If the concrete file exists, let the standard file server handle it
		// (correct content types, range requests, caching headers). Otherwise
		// fall back to index.html so the SPA router can take the route.
		if info, err := os.Stat(candidate); err == nil && !info.IsDir() {
			fileServer.ServeHTTP(w, r)
			return
		}
		http.ServeFile(w, r, indexPath)
	})
}
