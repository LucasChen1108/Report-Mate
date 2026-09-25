package middleware

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestRecoveryReturnsCanonicalInternalError(t *testing.T) {
	handler := Recovery(http.HandlerFunc(func(http.ResponseWriter, *http.Request) {
		panic("sensitive implementation detail")
	}))
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, httptest.NewRequest(http.MethodGet, "/api/test", nil))
	if response.Code != http.StatusInternalServerError || !strings.Contains(response.Body.String(), `"code":"internal_error"`) {
		t.Fatalf("response = %d: %s", response.Code, response.Body.String())
	}
	if strings.Contains(response.Body.String(), "sensitive implementation detail") {
		t.Fatal("panic detail leaked to response")
	}
}

func TestRequestLoggerPreservesStatusAndBody(t *testing.T) {
	handler := RequestLogger(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusTeapot)
		_, _ = w.Write([]byte("short and stout"))
	}))
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, httptest.NewRequest(http.MethodGet, "/api/test?secret=value", nil))
	if response.Code != http.StatusTeapot || response.Body.String() != "short and stout" {
		t.Fatalf("response = %d: %s", response.Code, response.Body.String())
	}
}
