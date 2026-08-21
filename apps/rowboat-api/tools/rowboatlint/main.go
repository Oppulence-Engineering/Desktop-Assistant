// Command rowboatlint runs Rowboat-specific static analyzers.
package main

import (
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/tools/rowboatlint/analyzers/directhttp"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/tools/rowboatlint/analyzers/forbiddenlog"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/tools/rowboatlint/analyzers/temporal"
	"golang.org/x/tools/go/analysis/multichecker"
)

func main() {
	multichecker.Main(
		temporal.Analyzer,
		directhttp.Analyzer,
		forbiddenlog.Analyzer,
	)
}
