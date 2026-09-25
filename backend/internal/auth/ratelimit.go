package auth

import (
	"sync"
	"time"
)

type AttemptLimiter interface {
	Allow(key string, now time.Time) bool
}

type loginWindow struct {
	started time.Time
	count   int
}

// MemoryAttemptLimiter is a process-local fixed-window limiter shared by
// authentication and code-validation entry points. It intentionally stores
// only IP/email keys, never passwords, codes, cookies, or other secrets.
type MemoryAttemptLimiter struct {
	mu      sync.Mutex
	limit   int
	window  time.Duration
	attempt map[string]loginWindow
}

func NewMemoryAttemptLimiter(limit int, window time.Duration) *MemoryAttemptLimiter {
	return &MemoryAttemptLimiter{limit: limit, window: window, attempt: make(map[string]loginWindow)}
}

func (l *MemoryAttemptLimiter) Allow(key string, now time.Time) bool {
	l.mu.Lock()
	defer l.mu.Unlock()

	entry, ok := l.attempt[key]
	if !ok || !now.Before(entry.started.Add(l.window)) {
		l.attempt[key] = loginWindow{started: now, count: 1}
		return true
	}
	if entry.count >= l.limit {
		return false
	}
	entry.count++
	l.attempt[key] = entry
	return true
}
