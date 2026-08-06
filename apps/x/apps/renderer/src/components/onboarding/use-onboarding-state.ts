import { useState, useEffect, useCallback } from "react"
import { setGoogleCredentials } from "@/lib/google-credentials-store"
import { toast } from "sonner"
import { getProductProviderState, isProductProvider } from "@x/shared/dist/branding.js"
import type { IntegrationConnector } from "@/hooks/useConnectors"

export interface ProviderState {
  isConnected: boolean
  isLoading: boolean
  isConnecting: boolean
}

export type Step = 0 | 1 | 2 | 3

export type OnboardingPath = 'rowboat' | 'byok' | null

export type LlmProviderFlavor = "openai" | "anthropic" | "google" | "openrouter" | "aigateway" | "ollama" | "openai-compatible"

export interface LlmModelOption {
  id: string
  name?: string
  release_date?: string
}

export function useOnboardingState(open: boolean, onComplete: () => void) {
  const [currentStep, setCurrentStep] = useState<Step>(0)
  const [onboardingPath, setOnboardingPath] = useState<OnboardingPath>(null)

  // LLM setup state
  const [llmProvider, setLlmProvider] = useState<LlmProviderFlavor>("openai")
  const [modelsCatalog, setModelsCatalog] = useState<Record<string, LlmModelOption[]>>({})
  const [modelsLoading, setModelsLoading] = useState(false)
  const [modelsError, setModelsError] = useState<string | null>(null)
  const [providerConfigs, setProviderConfigs] = useState<Record<LlmProviderFlavor, { apiKey: string; baseURL: string; model: string; knowledgeGraphModel: string; meetingNotesModel: string; liveNoteAgentModel: string }>>({
    openai: { apiKey: "", baseURL: "", model: "", knowledgeGraphModel: "", meetingNotesModel: "", liveNoteAgentModel: "" },
    anthropic: { apiKey: "", baseURL: "", model: "", knowledgeGraphModel: "", meetingNotesModel: "", liveNoteAgentModel: "" },
    google: { apiKey: "", baseURL: "", model: "", knowledgeGraphModel: "", meetingNotesModel: "", liveNoteAgentModel: "" },
    openrouter: { apiKey: "", baseURL: "", model: "", knowledgeGraphModel: "", meetingNotesModel: "", liveNoteAgentModel: "" },
    aigateway: { apiKey: "", baseURL: "", model: "", knowledgeGraphModel: "", meetingNotesModel: "", liveNoteAgentModel: "" },
    ollama: { apiKey: "", baseURL: "http://localhost:11434", model: "", knowledgeGraphModel: "", meetingNotesModel: "", liveNoteAgentModel: "" },
    "openai-compatible": { apiKey: "", baseURL: "http://localhost:1234/v1", model: "", knowledgeGraphModel: "", meetingNotesModel: "", liveNoteAgentModel: "" },
  })
  const [testState, setTestState] = useState<{ status: "idle" | "testing" | "success" | "error"; error?: string }>({
    status: "idle",
  })
  const [showMoreProviders, setShowMoreProviders] = useState(false)

  // OAuth provider states
  const [providers, setProviders] = useState<string[]>([])
  const [providersLoading, setProvidersLoading] = useState(true)
  const [providerStates, setProviderStates] = useState<Record<string, ProviderState>>({})
  const [googleClientIdOpen, setGoogleClientIdOpen] = useState(false)
  const [integrations, setIntegrations] = useState<IntegrationConnector[]>([])
  const [integrationsLoading, setIntegrationsLoading] = useState(true)
  const [integrationConnecting, setIntegrationConnecting] = useState<Record<string, boolean>>({})
  const [integrationApiKeyOpen, setIntegrationApiKeyOpen] = useState(false)
  const [integrationApiKeyTarget, setIntegrationApiKeyTarget] = useState<IntegrationConnector | null>(null)
  const [integrationApiKeySubmitting, setIntegrationApiKeySubmitting] = useState(false)

  // Granola state
  const [granolaEnabled, setGranolaEnabled] = useState(false)
  const [granolaLoading, setGranolaLoading] = useState(true)

  // Slack state (agent-slack CLI)
  const [slackEnabled, setSlackEnabled] = useState(false)
  const [slackLoading, setSlackLoading] = useState(true)
  const [slackWorkspaces, setSlackWorkspaces] = useState<Array<{ url: string; name: string }>>([])
  const [slackAvailableWorkspaces, setSlackAvailableWorkspaces] = useState<Array<{ url: string; name: string }>>([])
  const [slackSelectedUrls, setSlackSelectedUrls] = useState<Set<string>>(new Set())
  const [slackPickerOpen, setSlackPickerOpen] = useState(false)
  const [slackDiscovering, setSlackDiscovering] = useState(false)
  const [slackDiscoverError, setSlackDiscoverError] = useState<string | null>(null)

  // Inline upsell callout dismissed
  const [upsellDismissed, setUpsellDismissed] = useState(false)

  const updateProviderConfig = useCallback(
    (provider: LlmProviderFlavor, updates: Partial<{ apiKey: string; baseURL: string; model: string; knowledgeGraphModel: string; meetingNotesModel: string; liveNoteAgentModel: string }>) => {
      setProviderConfigs(prev => ({
        ...prev,
        [provider]: { ...prev[provider], ...updates },
      }))
      setTestState({ status: "idle" })
    },
    []
  )

  const activeConfig = providerConfigs[llmProvider]
  const showApiKey = llmProvider === "openai" || llmProvider === "anthropic" || llmProvider === "google" || llmProvider === "openrouter" || llmProvider === "aigateway" || llmProvider === "openai-compatible"
  const requiresApiKey = llmProvider === "openai" || llmProvider === "anthropic" || llmProvider === "google" || llmProvider === "openrouter" || llmProvider === "aigateway"
  const requiresBaseURL = llmProvider === "ollama" || llmProvider === "openai-compatible"
  const showBaseURL = llmProvider === "ollama" || llmProvider === "openai-compatible" || llmProvider === "aigateway"
  const isLocalProvider = llmProvider === "ollama" || llmProvider === "openai-compatible"
  const canTest =
    activeConfig.model.trim().length > 0 &&
    (!requiresApiKey || activeConfig.apiKey.trim().length > 0) &&
    (!requiresBaseURL || activeConfig.baseURL.trim().length > 0)

  // Track connected providers for the completion step
  const connectedProviders = Object.entries(providerStates)
    .filter(([, state]) => state.isConnected)
    .map(([provider]) => provider)
  const googleConnected = providerStates.google?.isConnected ?? false

  // Load available providers on mount
  useEffect(() => {
    if (!open) return

    async function loadProviders() {
      try {
        setProvidersLoading(true)
        const result = await window.ipc.invoke('oauth:list-providers', null)
        setProviders(result.providers || [])
      } catch (error) {
        console.error('Failed to get available providers:', error)
        setProviders([])
      } finally {
        setProvidersLoading(false)
      }
    }
    loadProviders()
  }, [open])

  const refreshIntegrations = useCallback(async () => {
    try {
      setIntegrationsLoading(true)
      const result = await window.ipc.invoke("connectors:list", null)
      setIntegrations(result.connectors || [])
      if (result.error) {
        console.warn("Failed to list integrations:", result.error)
      }
    } catch (error) {
      console.error("Failed to list integrations:", error)
      setIntegrations([])
    } finally {
      setIntegrationsLoading(false)
    }
  }, [])

  useEffect(() => {
    if (open) {
      refreshIntegrations()
    }
  }, [open, refreshIntegrations])

  // Load LLM models catalog on open
  useEffect(() => {
    if (!open) return

    async function loadModels() {
      try {
        setModelsLoading(true)
        setModelsError(null)
        const result = await window.ipc.invoke("models:list", null)
        const catalog: Record<string, LlmModelOption[]> = {}
        for (const provider of result.providers || []) {
          catalog[provider.id] = provider.models || []
        }
        setModelsCatalog(catalog)
      } catch (error) {
        console.error("Failed to load models catalog:", error)
        setModelsError("Failed to load models list")
        setModelsCatalog({})
      } finally {
        setModelsLoading(false)
      }
    }

    loadModels()
  }, [open])

  // Preferred default models for each provider
  // Billed to the user's own key — default to the cheap capable tier.
  const preferredDefaults: Partial<Record<LlmProviderFlavor, string>> = {
    openai: "gpt-4.1-mini",
    anthropic: "claude-opus-4-6-20260202",
  }

  // Initialize default models from catalog
  useEffect(() => {
    if (Object.keys(modelsCatalog).length === 0) return
    setProviderConfigs(prev => {
      const next = { ...prev }
      const cloudProviders: LlmProviderFlavor[] = ["openai", "anthropic", "google"]
      for (const provider of cloudProviders) {
        const models = modelsCatalog[provider]
        if (models?.length && !next[provider].model) {
          const preferredModel = preferredDefaults[provider]
          const hasPreferred = preferredModel && models.some(m => m.id === preferredModel)
          next[provider] = { ...next[provider], model: hasPreferred ? preferredModel : (models[0]?.id || "") }
        }
      }
      return next
    })
  }, [modelsCatalog])

  // Load Granola config
  const refreshGranolaConfig = useCallback(async () => {
    try {
      setGranolaLoading(true)
      const result = await window.ipc.invoke('granola:getConfig', null)
      setGranolaEnabled(result.enabled)
    } catch (error) {
      console.error('Failed to load Granola config:', error)
      setGranolaEnabled(false)
    } finally {
      setGranolaLoading(false)
    }
  }, [])

  // Update Granola config
  const handleGranolaToggle = useCallback(async (enabled: boolean) => {
    try {
      setGranolaLoading(true)
      await window.ipc.invoke('granola:setConfig', { enabled })
      setGranolaEnabled(enabled)
      toast.success(enabled ? 'Granola sync enabled' : 'Granola sync disabled')
    } catch (error) {
      console.error('Failed to update Granola config:', error)
      toast.error('Failed to update Granola sync settings')
    } finally {
      setGranolaLoading(false)
    }
  }, [])

  // Load Slack config
  const refreshSlackConfig = useCallback(async () => {
    try {
      setSlackLoading(true)
      const result = await window.ipc.invoke('slack:getConfig', null)
      setSlackEnabled(result.enabled)
      setSlackWorkspaces(
        (result.workspaces || []).flatMap((workspace) =>
          workspace.url ? [{ url: workspace.url, name: workspace.name }] : [],
        ),
      )
    } catch (error) {
      console.error('Failed to load Slack config:', error)
      setSlackEnabled(false)
      setSlackWorkspaces([])
    } finally {
      setSlackLoading(false)
    }
  }, [])

  // Enable Slack: discover workspaces
  const handleSlackEnable = useCallback(async () => {
    setSlackDiscovering(true)
    setSlackDiscoverError(null)
    try {
      const result = await window.ipc.invoke('slack:listWorkspaces', null)
      if (result.error || result.workspaces.length === 0) {
        setSlackDiscoverError(result.error || 'No Slack workspaces found. Set up with: agent-slack auth import-desktop')
        setSlackAvailableWorkspaces([])
        setSlackPickerOpen(true)
      } else {
        setSlackAvailableWorkspaces(result.workspaces)
        setSlackSelectedUrls(new Set(result.workspaces.map((w: { url: string }) => w.url)))
        setSlackPickerOpen(true)
      }
    } catch (error) {
      console.error('Failed to discover Slack workspaces:', error)
      setSlackDiscoverError('Failed to discover Slack workspaces')
      setSlackPickerOpen(true)
    } finally {
      setSlackDiscovering(false)
    }
  }, [])

  // Save selected Slack workspaces
  const handleSlackSaveWorkspaces = useCallback(async () => {
    const selected = slackAvailableWorkspaces.filter(w => slackSelectedUrls.has(w.url))
    try {
      setSlackLoading(true)
      await window.ipc.invoke('slack:setConfig', { enabled: true, workspaces: selected })
      setSlackEnabled(true)
      setSlackWorkspaces(selected)
      setSlackPickerOpen(false)
      toast.success('Slack enabled')
    } catch (error) {
      console.error('Failed to save Slack config:', error)
      toast.error('Failed to save Slack settings')
    } finally {
      setSlackLoading(false)
    }
  }, [slackAvailableWorkspaces, slackSelectedUrls])

  // Disable Slack
  const handleSlackDisable = useCallback(async () => {
    try {
      setSlackLoading(true)
      await window.ipc.invoke('slack:setConfig', { enabled: false, workspaces: [] })
      setSlackEnabled(false)
      setSlackWorkspaces([])
      setSlackPickerOpen(false)
      toast.success('Slack disabled')
    } catch (error) {
      console.error('Failed to update Slack config:', error)
      toast.error('Failed to update Slack settings')
    } finally {
      setSlackLoading(false)
    }
  }, [])

  // New step flow:
  // Rowboat path: 0 (welcome) → 2 (connect) → 3 (done)
  // BYOK path: 0 (welcome) → 1 (llm setup) → 2 (connect) → 3 (done)
  const handleNext = useCallback(() => {
    if (currentStep === 0) {
      if (onboardingPath === 'byok') {
        setCurrentStep(1)
      } else {
        setCurrentStep(2)
      }
    } else if (currentStep === 1) {
      setCurrentStep(2)
    } else if (currentStep === 2) {
      setCurrentStep(3)
    }
  }, [currentStep, onboardingPath])

  const handleBack = useCallback(() => {
    if (currentStep === 1) {
      setCurrentStep(0)
      setOnboardingPath(null)
    } else if (currentStep === 2) {
      if (onboardingPath === 'rowboat') {
        setCurrentStep(0)
      } else {
        setCurrentStep(1)
      }
    }
  }, [currentStep, onboardingPath])

  const handleComplete = useCallback(() => {
    onComplete()
  }, [onComplete])

  const handleTestAndSaveLlmConfig = useCallback(async () => {
    if (!canTest) return
    setTestState({ status: "testing" })
    try {
      const apiKey = activeConfig.apiKey.trim() || undefined
      const baseURL = activeConfig.baseURL.trim() || undefined
      const model = activeConfig.model.trim()
      const knowledgeGraphModel = activeConfig.knowledgeGraphModel.trim() || undefined
      const meetingNotesModel = activeConfig.meetingNotesModel.trim() || undefined
      const liveNoteAgentModel = activeConfig.liveNoteAgentModel.trim() || undefined
      const providerConfig = {
        provider: {
          flavor: llmProvider,
          apiKey,
          baseURL,
        },
        model,
        knowledgeGraphModel,
        meetingNotesModel,
        liveNoteAgentModel,
      }
      const result = await window.ipc.invoke("models:test", providerConfig)
      if (result.success) {
        setTestState({ status: "success" })
        await window.ipc.invoke("models:saveConfig", providerConfig)
        window.dispatchEvent(new Event('models-config-changed'))
        handleNext()
      } else {
        setTestState({ status: "error", error: result.error })
        toast.error(result.error || "Connection test failed")
      }
    } catch (error) {
      console.error("Connection test failed:", error)
      setTestState({ status: "error", error: "Connection test failed" })
      toast.error("Connection test failed")
    }
  }, [activeConfig.apiKey, activeConfig.baseURL, activeConfig.model, activeConfig.knowledgeGraphModel, activeConfig.meetingNotesModel, activeConfig.liveNoteAgentModel, canTest, llmProvider, handleNext])

  // Check connection status for all providers
  const refreshAllStatuses = useCallback(async () => {
    refreshGranolaConfig()
    refreshSlackConfig()

    if (providers.length === 0) return

    const newStates: Record<string, ProviderState> = {}

    try {
      const result = await window.ipc.invoke('oauth:getState', null)
      const config = result.config || {}
      for (const provider of providers) {
        newStates[provider] = {
          isConnected: config[provider]?.connected ?? false,
          isLoading: false,
          isConnecting: false,
        }
      }
    } catch (error) {
      console.error('Failed to check connection status for providers:', error)
      for (const provider of providers) {
        newStates[provider] = {
          isConnected: false,
          isLoading: false,
          isConnecting: false,
        }
      }
    }

    setProviderStates(newStates)
  }, [providers, refreshGranolaConfig, refreshSlackConfig])

  // Refresh statuses when modal opens or providers list changes
  useEffect(() => {
    if (open && providers.length > 0) {
      refreshAllStatuses()
    }
  }, [open, providers, refreshAllStatuses])

  // Listen for OAuth completion events (state updates only — toasts handled by ConnectorsPopover)
  useEffect(() => {
    const cleanup = window.ipc.on('oauth:didConnect', (event) => {
      const { provider, success } = event
      setIntegrationConnecting(prev => ({ ...prev, [provider]: false }))
      refreshIntegrations()

      setProviderStates(prev => ({
        ...prev,
        [provider]: {
          isConnected: success,
          isLoading: false,
          isConnecting: false,
        }
      }))
    })

    return cleanup
  }, [refreshIntegrations])

  // Auto-advance from Solomon AI sign-in step when OAuth completes
  useEffect(() => {
    if (onboardingPath !== 'rowboat' || currentStep !== 0) return

    const cleanup = window.ipc.on('oauth:didConnect', async (event) => {
      if (isProductProvider(event.provider) && event.success) {
        setCurrentStep(2) // Go to Connect Accounts
      }
    })

    return cleanup
  }, [onboardingPath, currentStep])

  const startConnect = useCallback(async (provider: string, credentials?: { clientId: string; clientSecret: string }) => {
    setProviderStates(prev => ({
      ...prev,
      [provider]: { ...prev[provider], isConnecting: true }
    }))

    try {
      const result = await window.ipc.invoke('oauth:connect', { provider, clientId: credentials?.clientId, clientSecret: credentials?.clientSecret })

      if (!result.success) {
        toast.error(result.error || `Failed to connect to ${provider}`)
        setProviderStates(prev => ({
          ...prev,
          [provider]: { ...prev[provider], isConnecting: false }
        }))
      }
    } catch (error) {
      console.error('Failed to connect:', error)
      toast.error(`Failed to connect to ${provider}`)
      setProviderStates(prev => ({
        ...prev,
        [provider]: { ...prev[provider], isConnecting: false }
      }))
    }
  }, [])

  // Connect to a provider
  const handleConnect = useCallback(async (provider: string) => {
    if (provider === 'google') {
      // Signed-in users use the Solomon AI managed-credentials flow: opens
      // the webapp in the browser, no BYOK modal. Falls back to BYOK modal
      // for not-signed-in users. (Mirrors useConnectors.handleConnect.)
      const isSignedIntoSolomon = getProductProviderState(providerStates)?.isConnected ?? false
      if (isSignedIntoSolomon) {
        await startConnect('google')
        return
      }
      setGoogleClientIdOpen(true)
      return
    }

    await startConnect(provider)
  }, [startConnect, providerStates])

  const handleGoogleClientIdSubmit = useCallback((clientId: string, clientSecret: string) => {
    setGoogleCredentials(clientId, clientSecret)
    setGoogleClientIdOpen(false)
    startConnect('google', { clientId, clientSecret })
  }, [startConnect])

  const handleConnectIntegration = useCallback(async (integration: IntegrationConnector) => {
    if (integration.connected) return
    if (integration.authType === "api_key") {
      setIntegrationApiKeyTarget(integration)
      setIntegrationApiKeyOpen(true)
      return
    }

    try {
      setIntegrationConnecting(prev => ({ ...prev, [integration.name]: true }))
      const result = await window.ipc.invoke("connectors:connect", { connector: integration.name })
      if (!result.success) {
        toast.error(result.error || `Failed to connect ${integration.displayName}`)
        setIntegrationConnecting(prev => ({ ...prev, [integration.name]: false }))
      }
    } catch (error) {
      console.error("Failed to connect integration:", error)
      toast.error(`Failed to connect ${integration.displayName}`)
      setIntegrationConnecting(prev => ({ ...prev, [integration.name]: false }))
    }
  }, [])

  const handleIntegrationApiKeySubmit = useCallback(async (apiKey: string) => {
    if (!integrationApiKeyTarget) return
    try {
      setIntegrationApiKeySubmitting(true)
      const result = await window.ipc.invoke("connectors:saveApiKey", {
        connector: integrationApiKeyTarget.name,
        apiKey,
      })
      if (!result.success) {
        toast.error(result.error || `Failed to connect ${integrationApiKeyTarget.displayName}`)
        return
      }
      toast.success(`Connected to ${integrationApiKeyTarget.displayName}`)
      setIntegrationApiKeyOpen(false)
      setIntegrationApiKeyTarget(null)
      await refreshIntegrations()
    } catch (error) {
      console.error("Failed to save integration API key:", error)
      toast.error(`Failed to connect ${integrationApiKeyTarget.displayName}`)
    } finally {
      setIntegrationApiKeySubmitting(false)
    }
  }, [integrationApiKeyTarget, refreshIntegrations])

  // Switch to Solomon AI path from BYOK inline callout
  const handleSwitchToRowboat = useCallback(() => {
    setOnboardingPath('rowboat')
    setCurrentStep(0)
  }, [])

  return {
    // Step state
    currentStep,
    setCurrentStep,
    onboardingPath,
    setOnboardingPath,

    // LLM state
    llmProvider,
    setLlmProvider,
    modelsCatalog,
    modelsLoading,
    modelsError,
    providerConfigs,
    activeConfig,
    testState,
    setTestState,
    showApiKey,
    requiresApiKey,
    requiresBaseURL,
    showBaseURL,
    isLocalProvider,
    canTest,
    showMoreProviders,
    setShowMoreProviders,
    updateProviderConfig,
    handleTestAndSaveLlmConfig,

    // OAuth state
    providers,
    providersLoading,
    providerStates,
    gmailConnected: googleConnected,
    googleCalendarConnected: googleConnected,
    googleClientIdOpen,
    setGoogleClientIdOpen,
    connectedProviders,
    handleConnect,
    handleGoogleClientIdSubmit,
    startConnect,

    // Rowboat integrations
    integrations,
    integrationsLoading,
    integrationConnecting,
    integrationApiKeyOpen,
    setIntegrationApiKeyOpen,
    integrationApiKeyTarget,
    integrationApiKeySubmitting,
    handleConnectIntegration,
    handleIntegrationApiKeySubmit,
    refreshIntegrations,

    // Granola state
    granolaEnabled,
    granolaLoading,
    handleGranolaToggle,

    // Slack state
    slackEnabled,
    slackLoading,
    slackWorkspaces,
    slackAvailableWorkspaces,
    slackSelectedUrls,
    setSlackSelectedUrls,
    slackPickerOpen,
    slackDiscovering,
    slackDiscoverError,
    handleSlackEnable,
    handleSlackSaveWorkspaces,
    handleSlackDisable,

    // Upsell
    upsellDismissed,
    setUpsellDismissed,

    // Navigation
    handleNext,
    handleBack,
    handleComplete,
    handleSwitchToRowboat,
  }
}

export type OnboardingState = ReturnType<typeof useOnboardingState>
