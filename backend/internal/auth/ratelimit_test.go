package auth

import (
	"testing"
	"time"
)

func TestMemoryLoginLimiterResetsAfterWindow(t *testing.T) {
	limiter := NewMemoryAttemptLimiter(2, time.Minute)
	now := time.Date(2026, 9, 21, 12, 0, 0, 0, time.UTC)
	if !limiter.Allow("client|account", now) || !limiter.Allow("client|account", now) {
		t.Fatal("allowed attempts were rejected")
	}
	if limiter.Allow("client|account", now) {
		t.Fatal("attempt above limit was allowed")
	}
	if !limiter.Allow("client|account", now.Add(time.Minute)) {
		t.Fatal("window did not reset")
	}
}
