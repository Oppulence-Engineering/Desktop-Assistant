package perf

import (
	"os"
	"path/filepath"
	"runtime"
	"sort"
	"strings"
)

type fileSizeEntry struct {
	Path string  `json:"path"`
	MB   float64 `json:"mb"`
}

func measurePackageSizes(cfg config) (map[string]float64, map[string]any, error) {
	bin, err := findPackagedBinary(cfg)
	if err != nil {
		return nil, nil, err
	}
	appRoot := packagedAppRoot(bin)
	appBytes, appLargest, err := dirSize(appRoot, cfg.RepoRoot, 10)
	if err != nil {
		return nil, nil, err
	}
	rendererDir := filepath.Join(cfg.RepoRoot, "apps", "x", "apps", "renderer", "dist")
	rendererBytes, rendererLargest, err := dirSize(rendererDir, cfg.RepoRoot, 10)
	if err != nil {
		return nil, nil, err
	}
	metrics := map[string]float64{
		"packagedAppSizeMb":   bytesFloatToMB(appBytes),
		"rendererAssetSizeMb": bytesFloatToMB(rendererBytes),
	}
	raw := map[string]any{
		"binary":          bin,
		"appRoot":         appRoot,
		"rendererDist":    rendererDir,
		"largestAppFiles": appLargest,
		"largestRenderer": rendererLargest,
	}
	return metrics, raw, nil
}

func packagedAppRoot(bin string) string {
	clean := filepath.Clean(bin)
	if runtime.GOOS == "darwin" {
		marker := ".app" + string(os.PathSeparator)
		if idx := strings.Index(clean, marker); idx >= 0 {
			return clean[:idx+len(".app")]
		}
		if strings.HasSuffix(clean, ".app") {
			return clean
		}
	}
	return filepath.Dir(clean)
}

func dirSize(root, relativeTo string, limit int) (int64, []fileSizeEntry, error) {
	var total int64
	var largest []fileSizeEntry
	err := filepath.WalkDir(root, func(path string, d os.DirEntry, err error) error {
		if err != nil || d.IsDir() {
			return err
		}
		info, err := d.Info()
		if err != nil {
			return err
		}
		total += info.Size()
		rel, err := filepath.Rel(relativeTo, path)
		if err != nil {
			rel = path
		}
		largest = append(largest, fileSizeEntry{Path: rel, MB: bytesFloatToMB(info.Size())})
		return nil
	})
	if err != nil {
		return 0, nil, err
	}
	sort.Slice(largest, func(i, j int) bool { return largest[i].MB > largest[j].MB })
	if len(largest) > limit {
		largest = largest[:limit]
	}
	return total, largest, nil
}

func bytesFloatToMB(bytes int64) float64 {
	return float64(bytes) / 1024 / 1024
}
