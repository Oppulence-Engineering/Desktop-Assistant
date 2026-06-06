package perf

import (
	"sync"
	"time"
)

const schemaVersion = 2

const (
	perfTierCommit = "commit"
	perfTierFull   = "full"
	perfTierDeep   = "deep"
)

type config struct {
	RepoRoot       string
	ArtifactDir    string
	WorkDir        string
	Mode           string
	Tier           string
	APIURL         string
	DevstackURL    string
	CDPPort        int
	VitePort       int
	Prompt         string
	BudgetPath     string
	BaselinePath   string
	AgentSession   string
	UpdateBaseline bool
	// RefreshBaselineOnPass keeps the relative-regression check active AND, when
	// the run passes, rewrites the baseline to the current metrics — a rolling
	// baseline for CI (UpdateBaseline alone disables the check). See ENGINEERING
	// _QUALITY_GATES_PLAN.md §6 (Layer 5).
	RefreshBaselineOnPass bool
	SkipPackage           bool
	IncludeCloud   bool
	IdleSeconds    int
	SeedNotes      int
	MemoryRepeats  int
}

type budgetFile struct {
	SchemaVersion int    `json:"schemaVersion"`
	Description   string `json:"description"`
	Budgets       struct {
		StartupInteractiveMs         float64 `json:"startupInteractiveMs"`
		LaunchToCDPMs                float64 `json:"launchToCdpMs"`
		NavigationDOMContentLoadedMs float64 `json:"navigationDomContentLoadedMs"`
		NavigationLoadMs             float64 `json:"navigationLoadMs"`
		FirstMeaningfulPaintMs       float64 `json:"firstMeaningfulPaintMs"`
		SignedInShellMs              float64 `json:"signedInShellMs"`
		ChatInputUsableMs            float64 `json:"chatInputUsableMs"`
		IPCWorkflowMs                float64 `json:"ipcWorkflowMs"`
		IPCP50Ms                     float64 `json:"ipcP50Ms"`
		IPCP95Ms                     float64 `json:"ipcP95Ms"`
		IPCMaxMs                     float64 `json:"ipcMaxMs"`
		IPCWorkspaceWriteP95Ms       float64 `json:"ipcWorkspaceWriteP95Ms"`
		IPCWorkspaceTreeMs           float64 `json:"ipcWorkspaceTreeMs"`
		IPCSearchMs                  float64 `json:"ipcSearchMs"`
		IPCRunsListMs                float64 `json:"ipcRunsListMs"`
		IPCModelsListMs              float64 `json:"ipcModelsListMs"`
		ChatRoundTripMs              float64 `json:"chatRoundTripMs"`
		CloudWorkflowMs              float64 `json:"cloudWorkflowMs"`
		TotalWorkflowMs              float64 `json:"totalWorkflowMs"`
		ScriptDurationMs             float64 `json:"scriptDurationMs"`
		TaskDurationMs               float64 `json:"taskDurationMs"`
		LayoutDurationMs             float64 `json:"layoutDurationMs"`
		RecalcStyleDurationMs        float64 `json:"recalcStyleDurationMs"`
		DOMNodeCount                 float64 `json:"domNodeCount"`
		JSEventListenerCount         float64 `json:"jsEventListenerCount"`
		RendererResourceCount        float64 `json:"rendererResourceCount"`
		LongTaskCount                float64 `json:"longTaskCount"`
		LongTaskMaxMs                float64 `json:"longTaskMaxMs"`
		LongTaskTotalMs              float64 `json:"longTaskTotalMs"`
		PackagedAppSizeMB            float64 `json:"packagedAppSizeMb"`
		RendererAssetSizeMB          float64 `json:"rendererAssetSizeMb"`
		WarmLaunchToCDPMs            float64 `json:"warmLaunchToCdpMs"`
		WarmStartupInteractiveMs     float64 `json:"warmStartupInteractiveMs"`
		WarmChatInputUsableMs        float64 `json:"warmChatInputUsableMs"`
		WarmNavigationLoadMs         float64 `json:"warmNavigationLoadMs"`
		ScaleWorkspaceTreeMs         float64 `json:"scaleWorkspaceTreeMs"`
		ScaleSearchMs                float64 `json:"scaleSearchMs"`
		MemoryLoopRSSGrowthMB        float64 `json:"memoryLoopRssGrowthMb"`
		MemoryLoopRendererHeapMB     float64 `json:"memoryLoopRendererHeapGrowthMb"`
		PeakRSSMB                    float64 `json:"peakRssMb"`
		MeanCPUPercent               float64 `json:"meanCpuPercent"`
		PeakCPUPercent               float64 `json:"peakCpuPercent"`
		IdleCPUPercent               float64 `json:"idleCpuPercent"`
		PeakProcesses                float64 `json:"peakProcesses"`
		PeakThreads                  float64 `json:"peakThreads"`
		PeakOpenFiles                float64 `json:"peakOpenFiles"`
		RendererJSHeapUsedMB         float64 `json:"rendererJsHeapUsedMb"`
	} `json:"budgets"`
	Regression struct {
		MaxPercent            float64 `json:"maxPercent"`
		MinAbsoluteMs         float64 `json:"minAbsoluteMs"`
		MinAbsoluteMB         float64 `json:"minAbsoluteMb"`
		MinAbsoluteCPUPercent float64 `json:"minAbsoluteCpuPercent"`
	} `json:"regression"`
}

type baselineFile struct {
	SchemaVersion int                `json:"schemaVersion"`
	UpdatedAt     string             `json:"updatedAt"`
	Commit        string             `json:"commit"`
	OS            string             `json:"os"`
	Arch          string             `json:"arch"`
	Mode          string             `json:"mode"`
	Metrics       map[string]float64 `json:"metrics"`
}

type report struct {
	SchemaVersion int                    `json:"schemaVersion"`
	StartedAt     string                 `json:"startedAt"`
	CompletedAt   string                 `json:"completedAt"`
	Repo          repoInfo               `json:"repo"`
	Config        map[string]any         `json:"config"`
	Timings       map[string]float64     `json:"timingsMs"`
	Measurements  map[string]float64     `json:"measurements,omitempty"`
	Resources     resourceSummary        `json:"resources"`
	Renderer      map[string]float64     `json:"rendererMetrics"`
	Workflow      map[string]any         `json:"workflow"`
	Artifacts     map[string]string      `json:"artifacts"`
	Warnings      []string               `json:"warnings,omitempty"`
	Failures      []string               `json:"failures,omitempty"`
	Comparable    map[string]float64     `json:"comparableMetrics"`
	Environment   map[string]string      `json:"environment"`
	Raw           map[string]interface{} `json:"raw,omitempty"`
}

type repoInfo struct {
	Branch string `json:"branch"`
	Commit string `json:"commit"`
	Dirty  bool   `json:"dirty"`
}

type processSample struct {
	AtMs                int64   `json:"atMs"`
	ProcessCount        int     `json:"processCount"`
	TotalRSSBytes       uint64  `json:"totalRssBytes"`
	PeakProcessRSSBytes uint64  `json:"peakProcessRssBytes"`
	ThreadCount         int32   `json:"threadCount"`
	OpenFiles           int32   `json:"openFiles"`
	CPUPercent          float64 `json:"cpuPercent"`
	PIDs                []int32 `json:"pids"`
}

type resourceSummary struct {
	SampleCount             int     `json:"sampleCount"`
	PeakRSSMB               float64 `json:"peakRssMb"`
	PeakProcessRSSMB        float64 `json:"peakProcessRssMb"`
	MeanCPUPercent          float64 `json:"meanCpuPercent"`
	PeakCPUPercent          float64 `json:"peakCpuPercent"`
	IdleMeanCPUPercent      float64 `json:"idleMeanCpuPercent"`
	PeakProcessCount        int     `json:"peakProcessCount"`
	PeakThreadCount         int32   `json:"peakThreadCount"`
	PeakOpenFiles           int32   `json:"peakOpenFiles"`
	OpenFilesSupported      bool    `json:"openFilesSupported"`
	LastTotalRSSMB          float64 `json:"lastTotalRssMb"`
	LastProcessCount        int     `json:"lastProcessCount"`
	LastCPUPercent          float64 `json:"lastCpuPercent"`
	IdleSampleCount         int     `json:"idleSampleCount"`
	ResourceSampleInterval  string  `json:"resourceSampleInterval"`
	ResourceSamplingStarted string  `json:"resourceSamplingStarted"`
}

type monitor struct {
	rootPID         int32
	start           time.Time
	interval        time.Duration
	stop            chan struct{}
	done            chan struct{}
	mu              sync.Mutex
	samples         []processSample
	prevCPU         float64
	prevAt          time.Time
	hasPrev         bool
	idleStartedAtMs *int64
}

type controlledExit struct {
	code int
}
