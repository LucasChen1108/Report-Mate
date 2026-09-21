package httpx

import (
	"errors"
	"strings"
	"time"
)

// DayLayout is the ONE format the API accepts for a created_at window bound.
//
// WHY ONLY THIS ONE. GET /api/reports used to also accept an RFC 3339 instant,
// which made the same parameter mean two different things depending on the
// format the caller happened to send: `?to=2026-09-21` meant "through the end
// of the 21st" while `?to=2026-09-21T00:00:00Z` meant "up to the start of the
// 21st" — a full day apart, with nothing in the request to signal it. The
// dashboard endpoint refused the second format for exactly that reason, and
// the two endpoints answered differently for identical-looking URLs.
//
// So: one format, one meaning. Every date filter in the product comes from an
// <input type="date"> (frontend/src/pages/Dashboard/ReportFilters.tsx), which
// emits YYYY-MM-DD and nothing else, so no caller loses anything. If a
// timestamp-precision filter is ever genuinely needed, it belongs in a
// separately named parameter whose semantics are unambiguous from its name.
const DayLayout = "2006-01-02"

// ErrNotADay is returned by ParseDayBound for a value that is not a
// YYYY-MM-DD calendar day. Callers map it to a 400 with DayBoundMessage.
var ErrNotADay = errors.New("httpx: value is not a YYYY-MM-DD date")

// ParseDayBound turns a calendar day from a query string into the timestamp to
// compare a created_at column against, in UTC.
//
// The interval both endpoints build is HALF-OPEN: created_at >= from AND
// created_at < to. That shape is what makes a date picker behave the way a
// user expects, and the two bounds are therefore parsed differently:
//
//	exclusiveEnd=false  ?from=2026-09-21 -> 2026-09-21T00:00:00Z
//	                    the 21st is included from its first instant
//	exclusiveEnd=true   ?to=2026-09-21   -> 2026-09-22T00:00:00Z
//	                    the WHOLE of the 21st is included
//
// The alternative — a plain `created_at <= to` against midnight — would cut
// the named day off at its first instant and silently drop every report filed
// during it, which reads to the user as data loss rather than a filter.
//
// An empty or whitespace-only value yields (nil, nil), meaning unbounded.
//
// TIMEZONE. The day is interpreted in UTC, for both endpoints, because
// created_at is stored in UTC and the server has no reliable knowledge of the
// caller's offset. This is a real, known limitation: a report filed at
// 02:00 +08 on the 21st is stored as 18:00Z on the 20th, so ?from=2026-09-21
// excludes it. Fixing it properly means the client sending its offset (or the
// bounds as instants it computed itself), not the server guessing — and until
// it does, being wrong the SAME way on every endpoint is what keeps the
// dashboard's count and the report list's count agreeing with each other.
func ParseDayBound(value string, exclusiveEnd bool) (*time.Time, error) {
	value = strings.TrimSpace(value)
	if value == "" {
		return nil, nil
	}

	day, err := time.ParseInLocation(DayLayout, value, time.UTC)
	if err != nil {
		return nil, ErrNotADay
	}
	if exclusiveEnd {
		// AddDate, not Add(24h): it is the next calendar day that is wanted,
		// and the two only coincide because this is UTC.
		day = day.AddDate(0, 0, 1)
	}
	return &day, nil
}

// DayBoundMessage is the 400 message for a malformed date bound, so both
// endpoints reject bad input with the same words as well as the same status.
func DayBoundMessage(name string) string {
	return name + " must be a date in YYYY-MM-DD format"
}
