package middleware

import (
	"log"
	"net/http"
	"time"

	"github.com/LucasChen1108/Report-Mate/backend/internal/httpx"
)

// Recovery is the outermost application middleware. It converts an unexpected
// panic into the same safe JSON vocabulary as ordinary handler failures and
// records no panic value, request headers, cookies, or bodies.
func Recovery(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		defer func() {
			if recovered := recover(); recovered != nil {
				// The panic value may itself contain request or database data, so
				// record the event without interpolating that value.
				log.Printf("http: recovered panic serving %s %s", r.Method, r.URL.Path)
				httpx.WriteError(w, http.StatusInternalServerError, "internal_error", "Something went wrong. Please try again.")
			}
		}()
		next.ServeHTTP(w, r)
	})
}

// RequestLogger records only method, URL path, response status, and duration.
// Query strings, headers, cookies, authorization values, and bodies are
// intentionally excluded because auth and report requests contain secrets or
// customer data.
func RequestLogger(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		started := time.Now()
		response := &statusWriter{ResponseWriter: w, status: http.StatusOK}
		next.ServeHTTP(response, r)
		log.Printf("http: %s %s status=%d duration=%s", r.Method, r.URL.Path, response.status, time.Since(started).Round(time.Millisecond))
	})
}

type statusWriter struct {
	http.ResponseWriter
	status int
	wrote  bool
}

func (w *statusWriter) WriteHeader(status int) {
	if w.wrote {
		return
	}
	w.status = status
	w.wrote = true
	w.ResponseWriter.WriteHeader(status)
}

func (w *statusWriter) Write(body []byte) (int, error) {
	if !w.wrote {
		w.WriteHeader(http.StatusOK)
	}
	return w.ResponseWriter.Write(body)
}

func (w *statusWriter) Unwrap() http.ResponseWriter { return w.ResponseWriter }
