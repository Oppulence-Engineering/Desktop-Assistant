package perf

import (
	"sort"
	"time"

	"github.com/shirou/gopsutil/v4/process"
)

func newMonitor(rootPID int32, interval time.Duration) *monitor {
	return &monitor{
		rootPID:  rootPID,
		start:    time.Now(),
		interval: interval,
		stop:     make(chan struct{}),
		done:     make(chan struct{}),
	}
}

func (m *monitor) startSampling() {
	go func() {
		defer close(m.done)
		ticker := time.NewTicker(m.interval)
		defer ticker.Stop()
		m.sample()
		for {
			select {
			case <-ticker.C:
				m.sample()
			case <-m.stop:
				m.sample()
				return
			}
		}
	}()
}

func (m *monitor) stopSampling() {
	select {
	case <-m.done:
		return
	default:
		close(m.stop)
		<-m.done
	}
}

func (m *monitor) markIdle() {
	now := time.Now()
	offsetMs := now.Sub(m.start).Milliseconds()
	m.mu.Lock()
	defer m.mu.Unlock()
	m.idleStartedAtMs = &offsetMs
}

func (m *monitor) snapshot() []processSample {
	m.mu.Lock()
	defer m.mu.Unlock()
	out := make([]processSample, len(m.samples))
	copy(out, m.samples)
	return out
}

func (m *monitor) idleStartMs() *int64 {
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.idleStartedAtMs == nil {
		return nil
	}
	value := *m.idleStartedAtMs
	return &value
}

func (m *monitor) sample() {
	procs := processTree(m.rootPID)
	now := time.Now()
	var totalRSS uint64
	var peakRSS uint64
	var threads int32
	var openFiles int32
	var cpuSeconds float64
	pids := make([]int32, 0, len(procs))
	for _, p := range procs {
		pids = append(pids, p.Pid)
		if mem, err := p.MemoryInfo(); err == nil && mem != nil {
			totalRSS += mem.RSS
			if mem.RSS > peakRSS {
				peakRSS = mem.RSS
			}
		}
		if n, err := p.NumThreads(); err == nil {
			threads += n
		}
		if files, err := p.OpenFiles(); err == nil {
			openFiles += int32(len(files))
		} else if openFiles == 0 {
			openFiles = -1
		}
		if times, err := p.Times(); err == nil && times != nil {
			cpuSeconds += times.User + times.System
		}
	}
	sort.Slice(pids, func(i, j int) bool { return pids[i] < pids[j] })

	cpuPercent := 0.0
	if m.hasPrev {
		wallSeconds := now.Sub(m.prevAt).Seconds()
		if wallSeconds > 0 {
			cpuPercent = ((cpuSeconds - m.prevCPU) / wallSeconds) * 100
			if cpuPercent < 0 {
				cpuPercent = 0
			}
		}
	}
	m.prevCPU = cpuSeconds
	m.prevAt = now
	m.hasPrev = true

	s := processSample{
		AtMs:                now.Sub(m.start).Milliseconds(),
		ProcessCount:        len(procs),
		TotalRSSBytes:       totalRSS,
		PeakProcessRSSBytes: peakRSS,
		ThreadCount:         threads,
		OpenFiles:           openFiles,
		CPUPercent:          cpuPercent,
		PIDs:                pids,
	}

	m.mu.Lock()
	defer m.mu.Unlock()
	m.samples = append(m.samples, s)
}

func processTree(rootPID int32) []*process.Process {
	root, err := process.NewProcess(rootPID)
	if err != nil {
		return nil
	}
	var out []*process.Process
	seen := map[int32]bool{}
	var walk func(*process.Process)
	walk = func(p *process.Process) {
		if p == nil || seen[p.Pid] {
			return
		}
		seen[p.Pid] = true
		out = append(out, p)
		children, err := p.Children()
		if err != nil {
			return
		}
		for _, child := range children {
			walk(child)
		}
	}
	walk(root)
	return out
}

func currentProcessTreeRSSMB(rootPID int32) float64 {
	var total uint64
	for _, p := range processTree(rootPID) {
		if mem, err := p.MemoryInfo(); err == nil && mem != nil {
			total += mem.RSS
		}
	}
	return bytesToMB(total)
}

func summarizeSamples(samples []processSample, idleStartedAtMs *int64) resourceSummary {
	summary := resourceSummary{
		SampleCount:             len(samples),
		ResourceSampleInterval:  time.Second.String(),
		ResourceSamplingStarted: time.Now().UTC().Format(time.RFC3339),
		OpenFilesSupported:      true,
	}
	var cpuSum float64
	var cpuCount int
	var idleCPUSum float64
	startMs := int64(-1)
	if idleStartedAtMs != nil {
		startMs = *idleStartedAtMs
	}
	for i, s := range samples {
		rssMB := bytesToMB(s.TotalRSSBytes)
		if rssMB > summary.PeakRSSMB {
			summary.PeakRSSMB = rssMB
		}
		procRSSMB := bytesToMB(s.PeakProcessRSSBytes)
		if procRSSMB > summary.PeakProcessRSSMB {
			summary.PeakProcessRSSMB = procRSSMB
		}
		if s.CPUPercent > summary.PeakCPUPercent {
			summary.PeakCPUPercent = s.CPUPercent
		}
		if s.ProcessCount > summary.PeakProcessCount {
			summary.PeakProcessCount = s.ProcessCount
		}
		if s.ThreadCount > summary.PeakThreadCount {
			summary.PeakThreadCount = s.ThreadCount
		}
		if s.OpenFiles < 0 {
			summary.OpenFilesSupported = false
		} else if s.OpenFiles > summary.PeakOpenFiles {
			summary.PeakOpenFiles = s.OpenFiles
		}
		if i > 0 {
			cpuSum += s.CPUPercent
			cpuCount++
		}
		if startMs >= 0 && s.AtMs >= startMs && i > 0 {
			idleCPUSum += s.CPUPercent
			summary.IdleSampleCount++
		}
	}
	if cpuCount > 0 {
		summary.MeanCPUPercent = cpuSum / float64(cpuCount)
	}
	if summary.IdleSampleCount > 0 {
		summary.IdleMeanCPUPercent = idleCPUSum / float64(summary.IdleSampleCount)
	}
	if len(samples) > 0 {
		last := samples[len(samples)-1]
		summary.LastTotalRSSMB = bytesToMB(last.TotalRSSBytes)
		summary.LastProcessCount = last.ProcessCount
		summary.LastCPUPercent = last.CPUPercent
	}
	return summary
}
