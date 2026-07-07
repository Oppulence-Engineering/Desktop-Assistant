import { ArrowLeft, ArrowRight, CheckCircle2, KeyRound, Loader2 } from "@/lib/icons";
import { cn } from "@/lib/utils";
import { PRODUCT_NAME } from "@x/shared/dist/branding.js";
import { MinimalOnboardingLayout } from "../minimal-layout";
import type { LlmProviderFlavor, OnboardingState } from "../use-onboarding-state";

interface LlmSetupStepProps {
  state: OnboardingState;
}

const PROVIDERS: Array<{ id: LlmProviderFlavor; label: string; sublabel: string }> = [
  { id: "openai", label: "OpenAI", sublabel: "GPT models" },
  { id: "anthropic", label: "Anthropic", sublabel: "Claude models" },
  { id: "google", label: "Gemini", sublabel: "Google AI Studio" },
  { id: "ollama", label: "Ollama", sublabel: "Local models" },
  { id: "openrouter", label: "OpenRouter", sublabel: "Model router" },
  { id: "openai-compatible", label: "Compatible", sublabel: "Custom endpoint" },
];

export function LlmSetupStep({ state }: LlmSetupStepProps) {
  const models = state.modelsCatalog[state.llmProvider] || [];
  const selectedProvider = PROVIDERS.find((provider) => provider.id === state.llmProvider);

  return (
    <MinimalOnboardingLayout
      title={`Connect a model provider that can keep up with ${PRODUCT_NAME}.`}
      description="Provider, model routing, and credentials stay together in one small setup panel."
      chips={["Step 02 / 04", selectedProvider?.label || "Provider"]}
      panelTitle="Model access"
      panelDescription="Pick a provider and test the connection."
      footer={
        <button
          type="button"
          onClick={state.handleSwitchToRowboat}
          className="text-white/46 underline-offset-4 hover:text-white/72 hover:underline"
        >
          Use managed access instead
        </button>
      }
    >
      <div className="grid gap-4">
        <div>
          <div className="mb-2 font-mono text-[10px] uppercase tracking-[0.18em] text-white/35">
            Provider
          </div>
          <div className="grid gap-2">
            {PROVIDERS.slice(0, state.showMoreProviders ? PROVIDERS.length : 4).map((provider) => {
              const isSelected = provider.id === state.llmProvider;
              return (
                <button
                  key={provider.id}
                  type="button"
                  onClick={() => state.setLlmProvider(provider.id)}
                  className={cn(
                    "group flex min-h-12 items-center justify-between border border-white/10 bg-white/[0.045] px-3 text-left transition-colors hover:border-white/18 hover:bg-white/[0.075] focus-visible:border-white/40 focus-visible:outline-none",
                    isSelected && "border-white/45 bg-white/[0.09]",
                  )}
                >
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-medium text-white/86">
                      {provider.label}
                    </span>
                    <span className="block truncate text-xs text-white/38">{provider.sublabel}</span>
                  </span>
                  {isSelected ? (
                    <CheckCircle2 className="size-4 shrink-0 text-emerald-400" />
                  ) : (
                    <ArrowRight className="size-4 shrink-0 text-white/28 transition-transform group-hover:translate-x-0.5 group-hover:text-white/58" />
                  )}
                </button>
              );
            })}
          </div>
          {!state.showMoreProviders && (
            <button
              type="button"
              onClick={() => state.setShowMoreProviders(true)}
              className="mt-2 text-xs text-white/38 hover:text-white/62"
            >
              Show more providers
            </button>
          )}
        </div>

        <label className="grid gap-2">
          <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-white/35">
            Assistant model
          </span>
          <select
            value={state.activeConfig.model}
            onChange={(event) =>
              state.updateProviderConfig(state.llmProvider, { model: event.target.value })
            }
            className="h-11 border border-white/10 bg-white/[0.055] px-3 text-sm text-white outline-none focus:border-white/38"
          >
            {state.modelsLoading && <option value="">Loading models...</option>}
            {!state.modelsLoading && models.length === 0 && (
              <option value="">Enter a model in settings later</option>
            )}
            {models.map((model) => (
              <option key={model.id} value={model.id}>
                {model.name || model.id}
              </option>
            ))}
          </select>
        </label>

        {state.showBaseURL && (
          <label className="grid gap-2">
            <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-white/35">
              Endpoint
            </span>
            <input
              value={state.activeConfig.baseURL}
              onChange={(event) =>
                state.updateProviderConfig(state.llmProvider, { baseURL: event.target.value })
              }
              placeholder="https://api.example.com/v1"
              className="h-11 border border-white/10 bg-white/[0.055] px-3 font-mono text-sm text-white outline-none placeholder:text-white/26 focus:border-white/38"
            />
          </label>
        )}

        {state.showApiKey && (
          <label className="grid gap-2">
            <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-white/35">
              API key
            </span>
            <input
              type="password"
              value={state.activeConfig.apiKey}
              onChange={(event) =>
                state.updateProviderConfig(state.llmProvider, { apiKey: event.target.value })
              }
              placeholder="Paste your API key"
              className="h-11 border border-white/10 bg-white/[0.055] px-3 font-mono text-sm text-white outline-none placeholder:text-white/26 focus:border-white/38"
            />
          </label>
        )}

        {state.modelsError && <div className="text-xs leading-5 text-red-300">{state.modelsError}</div>}
        {state.testState.status === "error" && (
          <div className="text-xs leading-5 text-red-300">{state.testState.error}</div>
        )}

        <div className="grid grid-cols-[auto_1fr] gap-2 pt-1">
          <button
            type="button"
            onClick={state.handleBack}
            className="flex h-11 items-center gap-2 border border-white/10 px-3 text-sm font-medium text-white/64 hover:border-white/18 hover:text-white"
          >
            <ArrowLeft className="size-4" />
            Back
          </button>
          <button
            type="button"
            onClick={state.handleTestAndSaveLlmConfig}
            disabled={!state.canTest || state.testState.status === "testing"}
            className="flex h-11 items-center justify-center gap-2 bg-white px-3 text-sm font-semibold text-black transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {state.testState.status === "testing" ? (
              <>
                <Loader2 className="size-4 animate-spin" />
                Testing
              </>
            ) : state.testState.status === "success" ? (
              <>
                <CheckCircle2 className="size-4" />
                Connected
              </>
            ) : (
              <>
                <KeyRound className="size-4" />
                Test & Continue
              </>
            )}
          </button>
        </div>
      </div>
    </MinimalOnboardingLayout>
  );
}
