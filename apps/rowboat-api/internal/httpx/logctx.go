package httpx

import "context"

// logFields is a request-scoped, mutable holder for access-log fields that are
// only known after downstream middleware runs — chiefly the authenticated user
// id (RFC 010: "logs must carry request id and user id where allowed"). The
// access logger installs it at the top of the chain, auth fills it in, and the
// logger reads it when the request completes. Storing a *pointer* in the context
// lets downstream context derivations mutate the same holder the logger still
// observes, sidestepping the usual "downstream context isn't visible upstream"
// problem. It deliberately holds no metric labels — only log fields.
type logFields struct{ userID string }

type logFieldsKey struct{}

// WithLogFields returns a context carrying a fresh, mutable log-field holder.
func WithLogFields(ctx context.Context) context.Context {
	return context.WithValue(ctx, logFieldsKey{}, &logFields{})
}

// SetLogUserID records the authenticated user id for the access log. No-op when
// no holder is present (e.g. unit tests calling handlers without the chain).
func SetLogUserID(ctx context.Context, id string) {
	if lf, ok := ctx.Value(logFieldsKey{}).(*logFields); ok {
		lf.userID = id
	}
}

// LogUserID returns the recorded user id, or "" if none was set.
func LogUserID(ctx context.Context) string {
	if lf, ok := ctx.Value(logFieldsKey{}).(*logFields); ok {
		return lf.userID
	}
	return ""
}
