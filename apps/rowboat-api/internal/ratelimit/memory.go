package ratelimit

import (
	"context"
	"sync"
	"time"
)

// memoryLimiter is a process-local fixed-window counter. Suitable for single
// replica / dev; production uses Redis so limits are shared across replicas.
type memoryLimiter struct {
	mu      sync.Mutex
	buckets map[string]*memWindow
}

type memWindow struct {
	count   int
	resetAt time.Time
}

func newMemoryLimiter(ctx context.Context) *memoryLimiter {
	m := &memoryLimiter{buckets: make(map[string]*memWindow)}
	go m.reap(ctx)
	return m
}

func (m *memoryLimiter) Allow(_ context.Context, key string, limit int, window time.Duration) (bool, time.Duration, error) {
	now := time.Now()
	m.mu.Lock()
	defer m.mu.Unlock()

	b := m.buckets[key]
	if b == nil || now.After(b.resetAt) {
		b = &memWindow{count: 0, resetAt: now.Add(window)}
		m.buckets[key] = b
	}
	b.count++
	if b.count > limit {
		return false, time.Until(b.resetAt), nil
	}
	return true, 0, nil
}

// reap periodically drops expired buckets so the map doesn't grow unbounded.
func (m *memoryLimiter) reap(ctx context.Context) {
	t := time.NewTicker(5 * time.Minute)
	defer t.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-t.C:
			now := time.Now()
			m.mu.Lock()
			for k, b := range m.buckets {
				if now.After(b.resetAt) {
					delete(m.buckets, k)
				}
			}
			m.mu.Unlock()
		}
	}
}
