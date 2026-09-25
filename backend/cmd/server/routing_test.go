package main

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/LucasChen1108/Report-Mate/backend/internal/dashboard"
	"github.com/LucasChen1108/Report-Mate/backend/internal/reports"
	"github.com/LucasChen1108/Report-Mate/backend/internal/templates"
)

func TestEveryDomainRouteIsMountedBehindAuthentication(t *testing.T) {
	root := http.NewServeMux()
	denied := func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusUnauthorized)
			_, _ = w.Write([]byte(`{"code":"session_expired","message":"Sign in again."}`))
		})
	}
	mountTemplates(root, templates.NewHandler(nil), denied)
	mountDashboard(root, dashboard.NewHandler(nil), denied)
	mountReports(root, reports.NewHandler(nil), denied)

	routes := []struct{ method, path string }{
		{http.MethodGet, "/api/templates"},
		{http.MethodGet, "/api/templates/11111111-1111-4111-8111-111111111111"},
		{http.MethodPost, "/api/templates"},
		{http.MethodPut, "/api/templates/11111111-1111-4111-8111-111111111111"},
		{http.MethodGet, "/api/dashboard/templates"},
		{http.MethodGet, "/api/dashboard/templates/11111111-1111-4111-8111-111111111111"},
		{http.MethodGet, "/api/dashboard/templates/11111111-1111-4111-8111-111111111111/export.csv"},
		{http.MethodPost, "/api/reports"},
		{http.MethodGet, "/api/reports"},
		{http.MethodGet, "/api/reports/11111111-1111-4111-8111-111111111111"},
		{http.MethodPut, "/api/reports/11111111-1111-4111-8111-111111111111"},
		{http.MethodPost, "/api/reports/11111111-1111-4111-8111-111111111111/save-and-export"},
		{http.MethodGet, "/api/reports/11111111-1111-4111-8111-111111111111/export"},
	}
	for _, route := range routes {
		t.Run(route.method+" "+route.path, func(t *testing.T) {
			response := httptest.NewRecorder()
			root.ServeHTTP(response, httptest.NewRequest(route.method, route.path, nil))
			if response.Code != http.StatusUnauthorized || !strings.Contains(response.Body.String(), `"code":"session_expired"`) {
				t.Fatalf("response = %d: %s", response.Code, response.Body.String())
			}
		})
	}
}
