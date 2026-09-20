package reports

import (
	"net/http/httptest"
	"net/url"
	"testing"
	"time"

	"github.com/LucasChen1108/Report-Mate/backend/internal/httpx"
)

// dateFilterCases is the shared table. The IDENTICAL table lives in
// internal/dashboard/dateparams_test.go, and both files assert the same
// thing: that their endpoint's from/to bounds are exactly what
// httpx.ParseDayBound returns. Two endpoints that each equal the same parser
// equal each other, which is the property that matters — GET /api/reports and
// GET /api/dashboard/templates/{id} take the same-looking parameters and must
// not answer differently for the same URL.
//
// Keep the two tables in step. A case added here and not there proves half of
// nothing.
var dateFilterCases = []struct {
	name    string
	from    string
	to      string
	wantErr bool
}{
	{name: "both unset"},
	{name: "from only", from: "2026-09-21"},
	{name: "to only", to: "2026-09-21"},
	{name: "both set", from: "2026-09-01", to: "2026-09-21"},
	{name: "single day window", from: "2026-09-21", to: "2026-09-21"},
	{name: "month boundary", from: "2026-09-30", to: "2026-09-30"},
	{name: "year boundary", from: "2026-12-31", to: "2026-12-31"},
	{name: "leap day", from: "2028-02-29", to: "2028-02-29"},
	// This endpoint USED to accept RFC 3339 while the dashboard refused it,
	// which is the divergence these two files exist to close. Both reject it
	// now; these two cases are the regression guard.
	{name: "rfc3339 from is rejected", from: "2026-09-21T00:00:00Z", wantErr: true},
	{name: "rfc3339 to is rejected", to: "2026-09-21T23:59:59+08:00", wantErr: true},
	{name: "impossible day is rejected", from: "2026-02-30", wantErr: true},
	{name: "garbage is rejected", to: "yesterday", wantErr: true},
}

// TestParseListFilterDatesMatchSharedParser pins GET /api/reports' from/to
// handling to httpx.ParseDayBound.
func TestParseListFilterDatesMatchSharedParser(t *testing.T) {
	for _, tc := range dateFilterCases {
		t.Run(tc.name, func(t *testing.T) {
			query := url.Values{}
			if tc.from != "" {
				query.Set("from", tc.from)
			}
			if tc.to != "" {
				query.Set("to", tc.to)
			}

			recorder := httptest.NewRecorder()
			request := httptest.NewRequest("GET", "/api/reports?"+query.Encode(), nil)

			filter, ok := parseListFilter(recorder, request)

			if tc.wantErr {
				if ok {
					t.Fatalf("parseListFilter(%v) succeeded, want a rejection", query)
				}
				// A rejected filter must be a 400, not a silently dropped
				// parameter: an ignored filter returns confidently wrong rows.
				if recorder.Code != 400 {
					t.Fatalf("status = %d, want 400", recorder.Code)
				}
				return
			}
			if !ok {
				t.Fatalf("parseListFilter(%v) rejected: %s", query, recorder.Body.String())
			}

			wantFrom, err := httpx.ParseDayBound(tc.from, false)
			if err != nil {
				t.Fatalf("shared parser rejected from=%q: %v", tc.from, err)
			}
			// `to` is an EXCLUSIVE end bound: the start of the following day,
			// so the named day is fully inside the window.
			wantTo, err := httpx.ParseDayBound(tc.to, true)
			if err != nil {
				t.Fatalf("shared parser rejected to=%q: %v", tc.to, err)
			}

			assertBound(t, "From", filter.From, wantFrom)
			assertBound(t, "To", filter.To, wantTo)
		})
	}
}

func assertBound(t *testing.T, name string, got, want *time.Time) {
	t.Helper()
	switch {
	case got == nil && want == nil:
	case got == nil:
		t.Errorf("%s = nil, want %v", name, want)
	case want == nil:
		t.Errorf("%s = %v, want nil", name, got)
	case !got.Equal(*want):
		t.Errorf("%s = %v, want %v", name, got, want)
	}
}
