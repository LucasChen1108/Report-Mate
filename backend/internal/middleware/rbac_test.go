package middleware

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestRequireRoleDistinguishesAuthenticationFromAuthorization(t *testing.T) {
	next := http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusNoContent)
	})
	guard := RequireRole("dispatcher_admin")(next)

	tests := []struct {
		name     string
		ctx      context.Context
		status   int
		wantCode string
	}{
		{name: "missing identity", ctx: context.Background(), status: http.StatusUnauthorized, wantCode: "unauthenticated"},
		{name: "legacy role without principal", ctx: WithRole(context.Background(), "dispatcher_admin"), status: http.StatusUnauthorized, wantCode: "unauthenticated"},
		{name: "wrong role", ctx: WithPrincipal(context.Background(), Principal{UserID: "user-1", Role: "technician"}), status: http.StatusForbidden, wantCode: "forbidden"},
		{name: "required role", ctx: WithPrincipal(context.Background(), Principal{UserID: "user-1", Role: "dispatcher_admin"}), status: http.StatusNoContent},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			request := httptest.NewRequest(http.MethodPost, "/api/templates", nil).WithContext(tc.ctx)
			response := httptest.NewRecorder()
			guard.ServeHTTP(response, request)
			if response.Code != tc.status {
				t.Fatalf("status = %d, want %d: %s", response.Code, tc.status, response.Body.String())
			}
			if tc.wantCode != "" && !strings.Contains(response.Body.String(), `"code":"`+tc.wantCode+`"`) {
				t.Errorf("body = %s", response.Body.String())
			}
		})
	}
}
