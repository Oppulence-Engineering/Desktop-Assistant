// Package version holds build-time version metadata, stamped via -ldflags.
package version

import "fmt"

// These are overridden at build time:
//
//	go build -ldflags "-X .../internal/version.Version=$(git describe --tags) \
//	  -X .../internal/version.Commit=$(git rev-parse --short HEAD) \
//	  -X .../internal/version.Date=$(date -u +%Y-%m-%dT%H:%M:%SZ)"
var (
	Version = "dev"
	Commit  = "none"
	Date    = "unknown"
)

// String returns a human-readable version line.
func String() string {
	return fmt.Sprintf("%s (commit %s, built %s)", Version, Commit, Date)
}
