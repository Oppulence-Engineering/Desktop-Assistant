package perf

import (
	"encoding/csv"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strconv"
)

func writeSamplesCSV(path string, samples []processSample) error {
	file, err := os.Create(path)
	if err != nil {
		return err
	}
	defer file.Close()
	w := csv.NewWriter(file)
	defer w.Flush()
	if err := w.Write([]string{"at_ms", "process_count", "total_rss_mb", "peak_process_rss_mb", "thread_count", "open_files", "cpu_percent", "pids"}); err != nil {
		return err
	}
	for _, s := range samples {
		if err := w.Write([]string{
			strconv.FormatInt(s.AtMs, 10),
			strconv.Itoa(s.ProcessCount),
			fmt.Sprintf("%.2f", bytesToMB(s.TotalRSSBytes)),
			fmt.Sprintf("%.2f", bytesToMB(s.PeakProcessRSSBytes)),
			strconv.Itoa(int(s.ThreadCount)),
			strconv.Itoa(int(s.OpenFiles)),
			fmt.Sprintf("%.2f", s.CPUPercent),
			int32sCSV(s.PIDs),
		}); err != nil {
			return err
		}
	}
	return nil
}

func writeJSON(path string, value any) error {
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return err
	}
	data, err := json.MarshalIndent(value, "", "  ")
	if err != nil {
		return err
	}
	data = append(data, '\n')
	return os.WriteFile(path, data, 0o644)
}

func updateLatestSymlink(cfg config) {
	base := filepath.Dir(cfg.ArtifactDir)
	latest := filepath.Join(base, "latest")
	if filepath.Base(cfg.ArtifactDir) == "latest" {
		return
	}
	_ = os.Remove(latest)
	_ = os.Symlink(cfg.ArtifactDir, latest)
}
