package dashboard

import (
	"net/url"
	"testing"
	"time"

	"github.com/LucasChen1108/Report-Mate/backend/internal/httpx"
)

// dateFilterCases is the shared table. The IDENTICAL table lives in
// internal/reports/listfilter_test.go, and both files assert the same thing:
// that their endpoint's from/to bounds are exactly what httpx.ParseDayBound
// returns. Two endpoints that each equal the same parser equal each other,
// which is the property that matters — GET /api/dashboard/templates/{id} and
// GET /api/reports take the same-looking parameters and must not answer
// differently for the same URL.
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
	// Previously accepted by /api/reports and refused here. Now refused by
	// both — this case is the regression guard for that reconciliation.
	{name: "rfc3339 from is rejected", from: "2026-09-21T00:00:00Z", wantErr: true},
	{name: "rfc3339 to is rejected", to: "2026-09-21T23:59:59+08:00", wantErr: true},
	{name: "impossible day is rejected", from: "2026-02-30", wantErr: true},
	{name: "garbage is rejected", to: "yesterday", wantErr: true},
}

// TestParseTableParamsDatesMatchSharedParser pins the dashboard endpoint's
// from/to handling to httpx.ParseDayBound.
func TestParseTableParamsDatesMatchSharedParser(t *testing.T) {
	for _, tc := range dateFilterCases {
		t.Run(tc.name, func(t *testing.T) {
			query := url.Values{}
			if tc.from != "" {
				query.Set("from", tc.from)
			}
			if tc.to != "" {
				query.Set("to", tc.to)
			}

			params, err := parseTableParams(query)

			if tc.wantErr {
				if err == nil {
					t.Fatalf("parseTableParams(%v) succeeded, want a rejection", query)
				}
				return
			}
			if err != nil {
				t.Fatalf("parseTableParams(%v): %v", query, err)
			}

			wantFrom, parseErr := httpx.ParseDayBound(tc.from, false)
			if parseErr != nil {
				t.Fatalf("shared parser rejected from=%q: %v", tc.from, parseErr)
			}
			// `to` is an EXCLUSIVE end bound: the start of the following day,
			// so the named day is fully inside the window.
			wantTo, parseErr := httpx.ParseDayBound(tc.to, true)
			if parseErr != nil {
				t.Fatalf("shared parser rejected to=%q: %v", tc.to, parseErr)
			}

			assertBound(t, "from", params.from, wantFrom)
			assertBound(t, "to", params.to, wantTo)
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
