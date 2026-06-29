import { ArrowRight, CheckCircle2, KeyRound, Loader2 } from "@/lib/icons";
import { cn } from "@/lib/utils";
import {
  PRODUCT_NAME,
  PRODUCT_PROVIDER_ID,
  getProductProviderState,
} from "@x/shared/dist/branding.js";
import { MinimalOnboardingLayout } from "../minimal-layout";
import type { OnboardingState } from "../use-onboarding-state";

interface WelcomeStepProps {
  state: OnboardingState;
}

export function WelcomeStep({ state }: WelcomeStepProps) {
  const solomonState = getProductProviderState(state.providerStates) || {
    isConnected: false,
    isLoading: false,
    isConnecting: false,
  };

  return (
    <MinimalOnboardingLayout
      title="You're 2 clicks away from a workspace that remembers."
      description="Private local memory for the work you already do."
      chips={["Local-first context", "Change anytime"]}
      panelTitle={`Set up ${PRODUCT_NAME}`}
      panelDescription="Choose how the app should access models."
      footer="Sources and memory are configured after model access."
    >
      <div className="grid gap-2">
        <button
          type="button"
          onClick={() => {
            state.setOnboardingPath("rowboat");
            if (solomonState.isConnected) {
              state.setCurrentStep(2);
              return;
            }
            state.startConnect(PRODUCT_PROVIDER_ID);
          }}
          disabled={solomonState.isConnecting}
          className={cn(
            "group flex h-11 items-center justify-between border border-white/10 bg-white/[0.055] px-3 text-left text-sm font-medium text-white/82 transition-colors hover:border-white/18 hover:bg-white/[0.085] focus-visible:border-white/40 focus-visible:outline-none disabled:pointer-events-none disabled:opacity-70",
            solomonState.isConnected && "border-emerald-400/30 bg-emerald-400/[0.08] text-emerald-100",
          )}
        >
          <span className="flex min-w-0 items-center gap-2.5">
            <img src="/logo-only.png" alt="" className="size-4 shrink-0 invert" />
            <span className="truncate">Continue with {PRODUCT_NAME}</span>
          </span>
          {solomonState.isConnected ? (
            <CheckCircle2 className="size-4 shrink-0 text-emerald-400" />
          ) : solomonState.isConnecting ? (
            <Loader2 className="size-4 shrink-0 animate-spin text-white/48" />
          ) : (
            <ArrowRight className="size-4 shrink-0 text-white/42 transition-transform group-hover:translate-x-0.5 group-hover:text-white/72" />
          )}
        </button>

        <button
          type="button"
          onClick={() => {
            state.setOnboardingPath("byok");
            state.setCurrentStep(1);
          }}
          className="group flex h-11 items-center justify-between border border-white/10 bg-white/[0.055] px-3 text-left text-sm font-medium text-white/82 transition-colors hover:border-white/18 hover:bg-white/[0.085] focus-visible:border-white/40 focus-visible:outline-none"
        >
          <span className="flex min-w-0 items-center gap-2.5">
            <KeyRound className="size-4 shrink-0 text-white/78" />
            <span className="truncate">Bring your own provider</span>
          </span>
          <ArrowRight className="size-4 shrink-0 text-white/42 transition-transform group-hover:translate-x-0.5 group-hover:text-white/72" />
        </button>
      </div>
    </MinimalOnboardingLayout>
  );
}
