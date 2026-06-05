package main

import (
	"fmt"
	"os"

	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/openapidoc"
)

func main() {
	path := "api/openapi.json"
	if len(os.Args) > 1 {
		path = os.Args[1]
	}
	if err := openapidoc.EnrichFile(path); err != nil {
		fmt.Fprintf(os.Stderr, "openapi-enrich: %v\n", err)
		os.Exit(1)
	}
}
