package perf

import (
	"encoding/json"
	"fmt"
	"os"
	"strconv"
	"strings"
	"time"
)

func parseJSONOrRaw(raw string) any {
	trimmed := strings.TrimSpace(raw)
	var value any
	if err := json.Unmarshal([]byte(trimmed), &value); err == nil {
		return value
	}
	return trimmed
}

func int32sCSV(values []int32) string {
	parts := make([]string, len(values))
	for i, value := range values {
		parts[i] = strconv.Itoa(int(value))
	}
	return strings.Join(parts, " ")
}

func bytesToMB(bytes uint64) float64 {
	return float64(bytes) / 1024 / 1024
}

func elapsedMs(start time.Time) float64 {
	return float64(time.Since(start).Microseconds()) / 1000
}

func fatal(err error) {
	fmt.Fprintln(os.Stderr, err)
	panic(controlledExit{code: 1})
}

func fatalWithReport(err error, reportPath string) {
	fmt.Fprintf(os.Stderr, "%v\nreport: %s\n", err, reportPath)
	panic(controlledExit{code: 1})
}
