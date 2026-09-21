package auth

import (
	"sync"
	"time"
)

type LoginLimiter interface {
	Allow(key string, now time.Time) bool
}

type loginWindow struct {
	started time.Time
	count   int
}

// MemoryLoginLimiter is a process-local fixed-window limiter. It intentionally
// stores only IP/email keys, never passwords, cookies, or other secrets.
type MemoryLoginLimiter struct {
	mu      sync.Mutex
	limit   int
	window  time.Duration
	attempt map[string]loginWindow
}

func NewMemoryLoginLimiter(limit int, window time.Duration) *MemoryLoginLimiter {
	return &MemoryLoginLimiter{limit: limit, window: window, attempt: make(map[string]loginWindow)}
}

func (l *MemoryLoginLimiter) Allow(key string, now time.Time) bool {
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
