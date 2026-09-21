package httpx_test

import (
	"errors"
	"testing"
	"time"

	"github.com/LucasChen1108/Report-Mate/backend/internal/httpx"
)

// utc is the expected bound for a given calendar date, spelled out rather than
// computed, so a test failure says which instant was wrong rather than
// repeating the implementation's own arithmetic back at it.
func utc(year int, month time.Month, day int) time.Time {
	return time.Date(year, month, day, 0, 0, 0, 0, time.UTC)
}

func TestParseDayBound(t *testing.T) {
	tests := []struct {
		name         string
		value        string
		exclusiveEnd bool
		want         *time.Time // nil = unbounded
		wantErr      bool
	}{
		{
			name:  "empty is unbounded",
			value: "",
			want:  nil,
		},
		{
			name:  "whitespace only is unbounded",
			value: "   ",
			want:  nil,
		},
		{
			name:  "from is the first instant of the named day",
			value: "2026-09-21",
			want:  ptr(utc(2026, time.September, 21)),
		},
		{
			name:  "surrounding whitespace is tolerated",
			value: " 2026-09-21 ",
			want:  ptr(utc(2026, time.September, 21)),
		},
		{
			// THE POINT OF THE WHOLE FILE: a `to` of the 21st must include
			// everything filed on the 21st, which means an exclusive bound at
			// the start of the 22nd.
			name:         "to is the first instant of the FOLLOWING day",
			value:        "2026-09-21",
			exclusiveEnd: true,
			want:         ptr(utc(2026, time.September, 22)),
		},
		{
			name:         "to rolls over a month boundary",
			value:        "2026-09-30",
			exclusiveEnd: true,
			want:         ptr(utc(2026, time.October, 1)),
		},
		{
			name:         "to rolls over a year boundary",
			value:        "2026-12-31",
			exclusiveEnd: true,
			want:         ptr(utc(2027, time.January, 1)),
		},
		{
			name:         "to rolls over a leap day",
			value:        "2028-02-29",
			exclusiveEnd: true,
			want:         ptr(utc(2028, time.March, 1)),
		},
		{
			// An RFC 3339 instant was accepted by GET /api/reports and refused
			// by the dashboard. It is now refused by both — see ParseDayBound.
			name:    "an RFC 3339 instant is rejected",
			value:   "2026-09-21T00:00:00Z",
			wantErr: true,
		},
		{
			name:         "an RFC 3339 instant is rejected as an end bound too",
			value:        "2026-09-21T23:59:59+08:00",
			exclusiveEnd: true,
			wantErr:      true,
		},
		{
			name:    "a non-existent calendar day is rejected",
			value:   "2026-02-30",
			wantErr: true,
		},
		{
			name:    "a slashed date is rejected",
			value:   "21/09/2026",
			wantErr: true,
		},
		{
			name:    "garbage is rejected",
			value:   "yesterday",
			wantErr: true,
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			got, err := httpx.ParseDayBound(tc.value, tc.exclusiveEnd)

			if tc.wantErr {
				if err == nil {
					t.Fatalf("ParseDayBound(%q, %v) = %v, want an error", tc.value, tc.exclusiveEnd, got)
				}
				if !errors.Is(err, httpx.ErrNotADay) {
					t.Fatalf("error = %v, want ErrNotADay", err)
				}
				if got != nil {
					t.Fatalf("bound = %v on an error, want nil", got)
				}
				return
			}

			if err != nil {
				t.Fatalf("ParseDayBound(%q, %v): unexpected error %v", tc.value, tc.exclusiveEnd, err)
			}
			switch {
			case tc.want == nil && got != nil:
				t.Fatalf("bound = %v, want nil (unbounded)", got)
			case tc.want != nil && got == nil:
				t.Fatalf("bound = nil, want %v", tc.want)
			case tc.want != nil && !got.Equal(*tc.want):
				t.Fatalf("bound = %v, want %v", got, tc.want)
			}
		})
	}
}

// TestParseDayBoundWholeDayIsCovered states the half-open interval property
// directly: for a single-day filter (from == to == D), every instant of D
// falls inside [from, to) and the instants either side of it do not.
func TestParseDayBoundWholeDayIsCovered(t *testing.T) {
	from, err := httpx.ParseDayBound("2026-09-21", false)
	if err != nil {
		t.Fatalf("from: %v", err)
	}
	to, err := httpx.ParseDayBound("2026-09-21", true)
	if err != nil {
		t.Fatalf("to: %v", err)
	}

	inside := []time.Time{
		utc(2026, time.September, 21),                                // first instant
		time.Date(2026, time.September, 21, 12, 0, 0, 0, time.UTC),   // midday
		time.Date(2026, time.September, 21, 23, 59, 59, 0, time.UTC), // last second
	}
	for _, instant := range inside {
		if instant.Before(*from) || !instant.Before(*to) {
			t.Errorf("%v should fall inside [%v, %v)", instant, from, to)
		}
	}

	outside := []time.Time{
		time.Date(2026, time.September, 20, 23, 59, 59, 0, time.UTC),
		utc(2026, time.September, 22),
	}
	for _, instant := range outside {
		if !instant.Before(*from) && instant.Before(*to) {
			t.Errorf("%v should fall outside [%v, %v)", instant, from, to)
		}
	}
}

func ptr(t time.Time) *time.Time { return &t }
