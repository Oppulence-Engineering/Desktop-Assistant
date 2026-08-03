"use client";

import { useState, useEffect, useCallback } from "react";
import { CheckCircle2, Key, Loader2, Plus, X } from "@/lib/icons";
import { Button } from "@oppulence/ui/components/button";
import { Input } from "@oppulence/ui/components/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@oppulence/ui/components/select";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { PRODUCT_NAME, PRODUCT_PROVIDER_ID } from "@x/shared/dist/branding.js";

type LlmProviderFlavor =
  | "openai"
  | "anthropic"
  | "google"
  | "openrouter"
  | "aigateway"
  | "ollama"
  | "openai-compatible";

interface LlmModelOption {
  id: string;
  name?: string;
  release_date?: string;
}

const primaryProviders: Array<{
  id: LlmProviderFlavor;
  name: string;
  description: string;
}> = [
  { id: "openai", name: "OpenAI", description: "GPT models" },
  { id: "anthropic", name: "Anthropic", description: "Claude models" },
  { id: "google", name: "Gemini", description: "Google AI Studio" },
  { id: "ollama", name: "Ollama (Local)", description: "Run models locally" },
];

const moreProviders: Array<{
  id: LlmProviderFlavor;
  name: string;
  description: string;
}> = [
  {
    id: "openrouter",
    name: "OpenRouter",
    description: "Multiple models, one key",
  },
  {
    id: "aigateway",
    name: "AI Gateway (Vercel)",
    description: "Vercel's AI Gateway",
  },
  {
    id: "openai-compatible",
    name: "OpenAI-Compatible",
    description: "Custom OpenAI-compatible API",
  },
];

const preferredDefaults: Partial<Record<LlmProviderFlavor, string>> = {
  openai: "gpt-5.2",
  anthropic: "claude-opus-4-6-20260202",
};

const defaultBaseURLs: Partial<Record<LlmProviderFlavor, string>> = {
  ollama: "http://localhost:11434",
  "openai-compatible": "http://localhost:1234/v1",
};

type ProviderModelConfig = {
  apiKey: string;
  baseURL: string;
  models: string[];
  knowledgeGraphModel: string;
  meetingNotesModel: string;
  liveNoteAgentModel: string;
  autoPermissionDecisionModel: string;
};

export function ModelSettings({ dialogOpen }: { dialogOpen: boolean }) {
  const [provider, setProvider] = useState<LlmProviderFlavor>("openai");
  const [defaultProvider, setDefaultProvider] = useState<LlmProviderFlavor | null>(null);
  const [providerConfigs, setProviderConfigs] = useState<
    Record<LlmProviderFlavor, ProviderModelConfig>
  >({
    openai: {
      apiKey: "",
      baseURL: "",
      models: [""],
      knowledgeGraphModel: "",
      meetingNotesModel: "",
      liveNoteAgentModel: "",
      autoPermissionDecisionModel: "",
    },
    anthropic: {
      apiKey: "",
      baseURL: "",
      models: [""],
      knowledgeGraphModel: "",
      meetingNotesModel: "",
      liveNoteAgentModel: "",
      autoPermissionDecisionModel: "",
    },
    google: {
      apiKey: "",
      baseURL: "",
      models: [""],
      knowledgeGraphModel: "",
      meetingNotesModel: "",
      liveNoteAgentModel: "",
      autoPermissionDecisionModel: "",
    },
    openrouter: {
      apiKey: "",
      baseURL: "",
      models: [""],
      knowledgeGraphModel: "",
      meetingNotesModel: "",
      liveNoteAgentModel: "",
      autoPermissionDecisionModel: "",
    },
    aigateway: {
      apiKey: "",
      baseURL: "",
      models: [""],
      knowledgeGraphModel: "",
      meetingNotesModel: "",
      liveNoteAgentModel: "",
      autoPermissionDecisionModel: "",
    },
    ollama: {
      apiKey: "",
      baseURL: "http://localhost:11434",
      models: [""],
      knowledgeGraphModel: "",
      meetingNotesModel: "",
      liveNoteAgentModel: "",
      autoPermissionDecisionModel: "",
    },
    "openai-compatible": {
      apiKey: "",
      baseURL: "http://localhost:1234/v1",
      models: [""],
      knowledgeGraphModel: "",
      meetingNotesModel: "",
      liveNoteAgentModel: "",
      autoPermissionDecisionModel: "",
    },
  });
  const [modelsCatalog, setModelsCatalog] = useState<Record<string, LlmModelOption[]>>({});
  const [modelsLoading, setModelsLoading] = useState(false);
  const [modelsError, setModelsError] = useState<string | null>(null);
  const [testState, setTestState] = useState<{
    status: "idle" | "testing" | "success" | "error";
    error?: string;
  }>({ status: "idle" });
  const [configLoading, setConfigLoading] = useState(true);
  const [showMoreProviders, setShowMoreProviders] = useState(false);

  const activeConfig = providerConfigs[provider];
  const showApiKey =
    provider === "openai" ||
    provider === "anthropic" ||
    provider === "google" ||
    provider === "openrouter" ||
    provider === "aigateway" ||
    provider === "openai-compatible";
  const requiresApiKey =
    provider === "openai" ||
    provider === "anthropic" ||
    provider === "google" ||
    provider === "openrouter" ||
    provider === "aigateway";
  const showBaseURL =
    provider === "ollama" || provider === "openai-compatible" || provider === "aigateway";
  const requiresBaseURL = provider === "ollama" || provider === "openai-compatible";
  const isLocalProvider = provider === "ollama" || provider === "openai-compatible";
  const modelsForProvider = modelsCatalog[provider] || [];
  const showModelInput = isLocalProvider || modelsForProvider.length === 0;
  const isMoreProvider = moreProviders.some((p) => p.id === provider);

  const primaryModel = activeConfig.models[0] || "";
  const canTest =
    primaryModel.trim().length > 0 &&
    (!requiresApiKey || activeConfig.apiKey.trim().length > 0) &&
    (!requiresBaseURL || activeConfig.baseURL.trim().length > 0);

  const updateConfig = useCallback(
    (prov: LlmProviderFlavor, updates: Partial<ProviderModelConfig>) => {
      setProviderConfigs((prev) => ({
        ...prev,
        [prov]: { ...prev[prov], ...updates },
      }));
      setTestState({ status: "idle" });
    },
    [],
  );

  const updateModelAt = useCallback((prov: LlmProviderFlavor, index: number, value: string) => {
    setProviderConfigs((prev) => {
      const models = [...prev[prov].models];
      models[index] = value;
      return { ...prev, [prov]: { ...prev[prov], models } };
    });
    setTestState({ status: "idle" });
  }, []);

  const addModel = useCallback((prov: LlmProviderFlavor) => {
    setProviderConfigs((prev) => ({
      ...prev,
      [prov]: { ...prev[prov], models: [...prev[prov].models, ""] },
    }));
  }, []);

  const removeModel = useCallback((prov: LlmProviderFlavor, index: number) => {
    setProviderConfigs((prev) => {
      const models = prev[prov].models.filter((_, i) => i !== index);
      return {
        ...prev,
        [prov]: { ...prev[prov], models: models.length > 0 ? models : [""] },
      };
    });
    setTestState({ status: "idle" });
  }, []);

  // Load current config from file
  useEffect(() => {
    if (!dialogOpen) return;

    async function loadCurrentConfig() {
      try {
        setConfigLoading(true);
        const result = await window.ipc.invoke("workspace:readFile", {
          path: "config/models.json",
        });
        const parsed = JSON.parse(result.data);
        if (parsed?.provider?.flavor && parsed?.model) {
          const flavor = parsed.provider.flavor as LlmProviderFlavor;
          setProvider(flavor);
          setDefaultProvider(flavor);
          setProviderConfigs((prev) => {
            const next = { ...prev };
            // Hydrate all saved providers from the providers map
            if (parsed.providers) {
              for (const [key, entry] of Object.entries(parsed.providers)) {
                if (key in next) {
                  const e = entry as any;
                  const savedModels: string[] =
                    Array.isArray(e.models) && e.models.length > 0
                      ? e.models
                      : e.model
                        ? [e.model]
                        : [""];
                  next[key as LlmProviderFlavor] = {
                    apiKey: e.apiKey || "",
                    baseURL: e.baseURL || defaultBaseURLs[key as LlmProviderFlavor] || "",
                    models: savedModels,
                    knowledgeGraphModel: e.knowledgeGraphModel || "",
                    meetingNotesModel: e.meetingNotesModel || "",
                    liveNoteAgentModel: e.liveNoteAgentModel || "",
                    autoPermissionDecisionModel: e.autoPermissionDecisionModel || "",
                  };
                }
              }
            }
            // Active provider takes precedence from top-level config,
            // but only if it exists in the providers map (wasn't deleted)
            if (parsed.providers?.[flavor]) {
              const existingModels = next[flavor].models;
              const activeModels =
                existingModels[0] === parsed.model
                  ? existingModels
                  : [
                      parsed.model,
                      ...existingModels.filter((m: string) => m && m !== parsed.model),
                    ];
              next[flavor] = {
                apiKey: parsed.provider.apiKey || "",
                baseURL: parsed.provider.baseURL || defaultBaseURLs[flavor] || "",
                models: activeModels.length > 0 ? activeModels : [""],
                knowledgeGraphModel: parsed.knowledgeGraphModel || "",
                meetingNotesModel: parsed.meetingNotesModel || "",
                liveNoteAgentModel: parsed.liveNoteAgentModel || "",
                autoPermissionDecisionModel: parsed.autoPermissionDecisionModel || "",
              };
            }
            return next;
          });
        }
      } catch {
        // No existing config or parse error - use defaults
      } finally {
        setConfigLoading(false);
      }
    }

    loadCurrentConfig();
  }, [dialogOpen]);

  // Load models catalog
  useEffect(() => {
    if (!dialogOpen) return;

    async function loadModels() {
      try {
        setModelsLoading(true);
        setModelsError(null);
        const result = await window.ipc.invoke("models:list", null);
        const catalog: Record<string, LlmModelOption[]> = {};
        for (const p of result.providers || []) {
          catalog[p.id] = p.models || [];
        }
        setModelsCatalog(catalog);
      } catch {
        setModelsError("Failed to load models list");
        setModelsCatalog({});
      } finally {
        setModelsLoading(false);
      }
    }

    loadModels();
  }, [dialogOpen]);

  // Set default models from catalog when catalog loads
  useEffect(() => {
    if (Object.keys(modelsCatalog).length === 0) return;
    setProviderConfigs((prev) => {
      const next = { ...prev };
      const cloudProviders: LlmProviderFlavor[] = ["openai", "anthropic", "google"];
      for (const prov of cloudProviders) {
        const catalog = modelsCatalog[prov];
        if (catalog?.length && !next[prov].models[0]) {
          const preferred = preferredDefaults[prov];
          const hasPreferred = preferred && catalog.some((m) => m.id === preferred);
          const defaultModel = hasPreferred ? preferred! : catalog[0]?.id || "";
          next[prov] = { ...next[prov], models: [defaultModel] };
        }
      }
      return next;
    });
  }, [modelsCatalog]);

  const handleTestAndSave = useCallback(async () => {
    if (!canTest) return;
    setTestState({ status: "testing" });
    try {
      const allModels = activeConfig.models.map((m) => m.trim()).filter(Boolean);
      const providerConfig = {
        provider: {
          flavor: provider,
          apiKey: activeConfig.apiKey.trim() || undefined,
          baseURL: activeConfig.baseURL.trim() || undefined,
        },
        model: allModels[0] || "",
        models: allModels,
        knowledgeGraphModel: activeConfig.knowledgeGraphModel.trim() || undefined,
        meetingNotesModel: activeConfig.meetingNotesModel.trim() || undefined,
        liveNoteAgentModel: activeConfig.liveNoteAgentModel.trim() || undefined,
        autoPermissionDecisionModel: activeConfig.autoPermissionDecisionModel.trim() || undefined,
      };
      const result = await window.ipc.invoke("models:test", providerConfig);
      if (result.success) {
        await window.ipc.invoke("models:saveConfig", providerConfig);
        setDefaultProvider(provider);
        setTestState({ status: "success" });
        window.dispatchEvent(new Event("models-config-changed"));
        toast.success("Model configuration saved");
      } else {
        setTestState({ status: "error", error: result.error });
        toast.error(result.error || "Connection test failed");
      }
    } catch {
      setTestState({ status: "error", error: "Connection test failed" });
      toast.error("Connection test failed");
    }
  }, [canTest, provider, activeConfig]);

  const handleSetDefault = useCallback(
    async (prov: LlmProviderFlavor) => {
      const config = providerConfigs[prov];
      const allModels = config.models.map((m) => m.trim()).filter(Boolean);
      if (!allModels[0]) return;
      try {
        await window.ipc.invoke("models:saveConfig", {
          provider: {
            flavor: prov,
            apiKey: config.apiKey.trim() || undefined,
            baseURL: config.baseURL.trim() || undefined,
          },
          model: allModels[0],
          models: allModels,
          knowledgeGraphModel: config.knowledgeGraphModel.trim() || undefined,
          meetingNotesModel: config.meetingNotesModel.trim() || undefined,
          liveNoteAgentModel: config.liveNoteAgentModel.trim() || undefined,
          autoPermissionDecisionModel: config.autoPermissionDecisionModel.trim() || undefined,
        });
        setDefaultProvider(prov);
        window.dispatchEvent(new Event("models-config-changed"));
        toast.success("Default provider updated");
      } catch {
        toast.error("Failed to set default provider");
      }
    },
    [providerConfigs],
  );

  const handleDeleteProvider = useCallback(
    async (prov: LlmProviderFlavor) => {
      try {
        const result = await window.ipc.invoke("workspace:readFile", {
          path: "config/models.json",
        });
        const parsed = JSON.parse(result.data);
        if (parsed?.providers?.[prov]) {
          delete parsed.providers[prov];
        }
        // If the deleted provider is the current top-level active one,
        // switch top-level config to the current default provider
        if (parsed?.provider?.flavor === prov && defaultProvider && defaultProvider !== prov) {
          const defConfig = providerConfigs[defaultProvider];
          const defModels = defConfig.models.map((m) => m.trim()).filter(Boolean);
          parsed.provider = {
            flavor: defaultProvider,
            apiKey: defConfig.apiKey.trim() || undefined,
            baseURL: defConfig.baseURL.trim() || undefined,
          };
          parsed.model = defModels[0] || "";
          parsed.models = defModels;
          parsed.knowledgeGraphModel = defConfig.knowledgeGraphModel.trim() || undefined;
          parsed.meetingNotesModel = defConfig.meetingNotesModel.trim() || undefined;
          parsed.liveNoteAgentModel = defConfig.liveNoteAgentModel.trim() || undefined;
          parsed.autoPermissionDecisionModel =
            defConfig.autoPermissionDecisionModel.trim() || undefined;
        }
        await window.ipc.invoke("workspace:writeFile", {
          path: "config/models.json",
          data: JSON.stringify(parsed, null, 2),
        });
        setProviderConfigs((prev) => ({
          ...prev,
          [prov]: {
            apiKey: "",
            baseURL: defaultBaseURLs[prov] || "",
            models: [""],
            knowledgeGraphModel: "",
            meetingNotesModel: "",
            liveNoteAgentModel: "",
            autoPermissionDecisionModel: "",
          },
        }));
        setTestState({ status: "idle" });
        window.dispatchEvent(new Event("models-config-changed"));
        toast.success("Provider configuration removed");
      } catch {
        toast.error("Failed to remove provider");
      }
    },
    [defaultProvider, providerConfigs],
  );

  const renderProviderCard = (p: { id: LlmProviderFlavor; name: string; description: string }) => {
    const isDefault = defaultProvider === p.id;
    const isSelected = provider === p.id;
    const hasModel = providerConfigs[p.id].models[0]?.trim().length > 0;
    return (
      <button
        key={p.id}
        onClick={() => {
          setProvider(p.id);
          setTestState({ status: "idle" });
        }}
        className={cn(
          "rounded-none border px-3.5 py-3 text-left transition-all relative",
          isSelected
            ? "border-foreground bg-accent/50 shadow-[0_1px_2px_rgb(16_24_40_/_0.05)]"
            : "border-border hover:border-foreground/20 hover:bg-accent/40",
        )}
      >
        <div className="flex items-center gap-1.5">
          <span className="text-sm font-medium">{p.name}</span>
          {isDefault && (
            <span className="rounded-full border border-border bg-muted px-1.5 py-0.5 text-[10px] font-medium leading-none text-muted-foreground">
              Default
            </span>
          )}
        </div>
        <div className="text-xs text-muted-foreground mt-0.5">{p.description}</div>
        {!isDefault && hasModel && isSelected && (
          <div className="mt-1.5 flex items-center gap-3">
            <span
              role="button"
              onClick={(e) => {
                e.stopPropagation();
                handleSetDefault(p.id);
              }}
              className="inline-flex text-[11px] text-muted-foreground hover:text-primary transition-colors cursor-pointer"
            >
              Set as default
            </span>
            <span
              role="button"
              onClick={(e) => {
                e.stopPropagation();
                handleDeleteProvider(p.id);
              }}
              className="inline-flex text-[11px] text-muted-foreground hover:text-destructive transition-colors cursor-pointer"
            >
              Remove
            </span>
          </div>
        )}
      </button>
    );
  };

  if (configLoading) {
    return (
      <div className="h-full flex items-center justify-center text-muted-foreground text-sm">
        <Loader2 className="size-4 animate-spin mr-2" />
        Loading...
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Provider selection */}
      <div className="space-y-2">
        <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
          Provider
        </span>
        <div className="grid gap-2 grid-cols-2">{primaryProviders.map(renderProviderCard)}</div>
        {showMoreProviders || isMoreProvider ? (
          <div className="grid gap-2 grid-cols-2 mt-2">{moreProviders.map(renderProviderCard)}</div>
        ) : (
          <button
            onClick={() => setShowMoreProviders(true)}
            className="text-xs text-muted-foreground hover:text-foreground transition-colors mt-1"
          >
            More providers...
          </button>
        )}
      </div>

      {/* Model selection - side by side */}
      <div className="grid grid-cols-2 gap-3">
        {/* Assistant models (left column) */}
        <div className="space-y-2">
          <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
            Assistant model
          </span>
          {modelsLoading ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" />
              Loading...
            </div>
          ) : (
            <div className="space-y-2">
              {activeConfig.models.map((model, index) => (
                <div key={index} className="group/model relative">
                  {showModelInput ? (
                    <Input
                      value={model}
                      onChange={(e) => updateModelAt(provider, index, e.target.value)}
                      placeholder="Enter model"
                    />
                  ) : (
                    <Select
                      value={model}
                      onValueChange={(value) => updateModelAt(provider, index, value)}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Select a model" />
                      </SelectTrigger>
                      <SelectContent>
                        {modelsForProvider.map((m) => (
                          <SelectItem key={m.id} value={m.id}>
                            {m.name || m.id}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                  {activeConfig.models.length > 1 && (
                    <button
                      onClick={() => removeModel(provider, index)}
                      className="absolute right-8 top-1/2 -translate-y-1/2 flex size-6 items-center justify-center rounded text-muted-foreground opacity-0 transition-opacity hover:text-foreground group-hover/model:opacity-100"
                    >
                      <X className="size-3.5" />
                    </button>
                  )}
                </div>
              ))}
              <button
                onClick={() => addModel(provider)}
                className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
              >
                <Plus className="size-3.5" />
                Add assistant model
              </button>
            </div>
          )}
          {modelsError && <div className="text-xs text-destructive">{modelsError}</div>}
        </div>

        {/* Knowledge graph model (right column) */}
        <div className="space-y-2">
          <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
            Knowledge graph model
          </span>
          {modelsLoading ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" />
              Loading...
            </div>
          ) : showModelInput ? (
            <Input
              value={activeConfig.knowledgeGraphModel}
              onChange={(e) => updateConfig(provider, { knowledgeGraphModel: e.target.value })}
              placeholder={primaryModel || "Enter model"}
            />
          ) : (
            <Select
              value={activeConfig.knowledgeGraphModel || "__same__"}
              onValueChange={(value) =>
                updateConfig(provider, {
                  knowledgeGraphModel: value === "__same__" ? "" : value,
                })
              }
            >
              <SelectTrigger>
                <SelectValue placeholder="Select a model" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__same__">Same as assistant</SelectItem>
                {modelsForProvider.map((m) => (
                  <SelectItem key={m.id} value={m.id}>
                    {m.name || m.id}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </div>

        {/* Meeting notes model */}
        <div className="space-y-2">
          <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
            Meeting notes model
          </span>
          {modelsLoading ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" />
              Loading...
            </div>
          ) : showModelInput ? (
            <Input
              value={activeConfig.meetingNotesModel}
              onChange={(e) => updateConfig(provider, { meetingNotesModel: e.target.value })}
              placeholder={primaryModel || "Enter model"}
            />
          ) : (
            <Select
              value={activeConfig.meetingNotesModel || "__same__"}
              onValueChange={(value) =>
                updateConfig(provider, {
                  meetingNotesModel: value === "__same__" ? "" : value,
                })
              }
            >
              <SelectTrigger>
                <SelectValue placeholder="Select a model" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__same__">Same as assistant</SelectItem>
                {modelsForProvider.map((m) => (
                  <SelectItem key={m.id} value={m.id}>
                    {m.name || m.id}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </div>

        {/* Track block model */}
        <div className="space-y-2">
          <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
            Track block model
          </span>
          {modelsLoading ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" />
              Loading...
            </div>
          ) : showModelInput ? (
            <Input
              value={activeConfig.liveNoteAgentModel}
              onChange={(e) => updateConfig(provider, { liveNoteAgentModel: e.target.value })}
              placeholder={primaryModel || "Enter model"}
            />
          ) : (
            <Select
              value={activeConfig.liveNoteAgentModel || "__same__"}
              onValueChange={(value) =>
                updateConfig(provider, {
                  liveNoteAgentModel: value === "__same__" ? "" : value,
                })
              }
            >
              <SelectTrigger>
                <SelectValue placeholder="Select a model" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__same__">Same as assistant</SelectItem>
                {modelsForProvider.map((m) => (
                  <SelectItem key={m.id} value={m.id}>
                    {m.name || m.id}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </div>

        {/* Auto-permission model */}
        <div className="space-y-2">
          <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
            Auto-permission model
          </span>
          {modelsLoading ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" />
              Loading...
            </div>
          ) : showModelInput ? (
            <Input
              value={activeConfig.autoPermissionDecisionModel}
              onChange={(e) =>
                updateConfig(provider, {
                  autoPermissionDecisionModel: e.target.value,
                })
              }
              placeholder={primaryModel || "Enter model"}
            />
          ) : (
            <Select
              value={activeConfig.autoPermissionDecisionModel || "__same__"}
              onValueChange={(value) =>
                updateConfig(provider, {
                  autoPermissionDecisionModel: value === "__same__" ? "" : value,
                })
              }
            >
              <SelectTrigger>
                <SelectValue placeholder="Select a model" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__same__">Same as assistant</SelectItem>
                {modelsForProvider.map((m) => (
                  <SelectItem key={m.id} value={m.id}>
                    {m.name || m.id}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </div>
      </div>

      {/* API Key */}
      {showApiKey && (
        <div className="space-y-2">
          <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
            {provider === "openai-compatible" ? "API Key (optional)" : "API Key"}
          </span>
          <div className="relative">
            <Key className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              type="password"
              value={activeConfig.apiKey}
              onChange={(e) => updateConfig(provider, { apiKey: e.target.value })}
              placeholder="Paste your API key"
              className="pl-9 font-mono tracking-tight"
            />
          </div>
          <p className="text-[11px] text-muted-foreground">
            Stored locally in <code className="font-mono text-[10px]">config/models.json</code> and
            sent only to the selected provider.
          </p>
        </div>
      )}

      {/* Base URL */}
      {showBaseURL && (
        <div className="space-y-2">
          <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
            Base URL
          </span>
          <Input
            value={activeConfig.baseURL}
            onChange={(e) => updateConfig(provider, { baseURL: e.target.value })}
            placeholder={
              provider === "ollama"
                ? "http://localhost:11434"
                : provider === "openai-compatible"
                  ? "http://localhost:1234/v1"
                  : "https://ai-gateway.vercel.sh/v1"
            }
          />
        </div>
      )}

      {/* Test status */}
      {testState.status === "error" && (
        <div className="text-sm text-destructive">
          {testState.error || "Connection test failed"}
        </div>
      )}
      {testState.status === "success" && (
        <div className="flex items-center gap-1.5 text-sm text-green-600">
          <CheckCircle2 className="size-4" />
          Connected and saved
        </div>
      )}

      {/* Test & Save button */}
      <Button
        onClick={handleTestAndSave}
        disabled={!canTest || testState.status === "testing"}
        className="w-full"
      >
        {testState.status === "testing" ? (
          <>
            <Loader2 className="size-4 animate-spin mr-2" />
            Testing connection...
          </>
        ) : (
          "Test & Save"
        )}
      </Button>
    </div>
  );
}

export function SolomonModelSettings({ dialogOpen }: { dialogOpen: boolean }) {
  const [gatewayModels, setGatewayModels] = useState<LlmModelOption[]>([]);
  const [selectedModel, setSelectedModel] = useState("");
  const [selectedKgModel, setSelectedKgModel] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!dialogOpen) return;

    async function load() {
      setLoading(true);
      try {
        // Fetch gateway models
        const listResult = await window.ipc.invoke("models:list", null);
        const solomonProvider = listResult.providers?.find(
          (p: { id: string }) => p.id === PRODUCT_PROVIDER_ID,
        );
        const models = solomonProvider?.models || [];
        setGatewayModels(models);

        // Read current selection from config
        try {
          const configResult = await window.ipc.invoke("workspace:readFile", {
            path: "config/models.json",
          });
          const parsed = JSON.parse(configResult.data);
          if (parsed?.model) setSelectedModel(parsed.model);
          if (parsed?.knowledgeGraphModel) setSelectedKgModel(parsed.knowledgeGraphModel);
        } catch {
          // No config yet — pick first model as default
          if (models.length > 0) setSelectedModel(models[0].id);
        }
      } catch {
        toast.error("Failed to load models");
      } finally {
        setLoading(false);
      }
    }

    load();
  }, [dialogOpen]);

  const handleSave = useCallback(async () => {
    if (!selectedModel) return;
    setSaving(true);
    try {
      await window.ipc.invoke("models:saveConfig", {
        provider: { flavor: "openrouter" as const },
        model: selectedModel,
        knowledgeGraphModel: selectedKgModel || undefined,
      });
      window.dispatchEvent(new Event("models-config-changed"));
      toast.success("Model configuration saved");
    } catch {
      toast.error("Failed to save model configuration");
    } finally {
      setSaving(false);
    }
  }, [selectedModel, selectedKgModel]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12 text-muted-foreground">
        <Loader2 className="size-5 animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <p className="text-sm text-muted-foreground">
        Select the models {PRODUCT_NAME} uses. These are provided through your {PRODUCT_NAME}{" "}
        account.
      </p>

      {/* Assistant model */}
      <div className="space-y-2">
        <label className="text-sm font-medium">Assistant model</label>
        <Select value={selectedModel} onValueChange={setSelectedModel}>
          <SelectTrigger className="w-full">
            <SelectValue placeholder="Select a model" />
          </SelectTrigger>
          <SelectContent>
            {gatewayModels.map((m) => (
              <SelectItem key={m.id} value={m.id}>
                {m.name || m.id}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Knowledge graph model */}
      <div className="space-y-2">
        <label className="text-sm font-medium">Knowledge graph model</label>
        <Select
          value={selectedKgModel || "__same__"}
          onValueChange={(v) => setSelectedKgModel(v === "__same__" ? "" : v)}
        >
          <SelectTrigger className="w-full">
            <SelectValue placeholder="Same as assistant" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__same__">Same as assistant</SelectItem>
            {gatewayModels.map((m) => (
              <SelectItem key={m.id} value={m.id}>
                {m.name || m.id}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Save */}
      <Button onClick={handleSave} disabled={!selectedModel || saving}>
        {saving ? (
          <>
            <Loader2 className="size-4 animate-spin mr-2" />
            Saving...
          </>
        ) : (
          "Save"
        )}
      </Button>
    </div>
  );
}
