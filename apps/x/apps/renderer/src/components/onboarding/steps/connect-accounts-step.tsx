import { ArrowLeft, ArrowRight, CheckCircle2, Loader2, Mail, ShieldCheck } from "@/lib/icons";
import { PRODUCT_NAME } from "@x/shared/dist/branding.js";
import { MinimalOnboardingLayout } from "../minimal-layout";
import type { OnboardingState } from "../use-onboarding-state";

interface ConnectAccountsStepProps {
  state: OnboardingState;
}

export function ConnectAccountsStep({ state }: ConnectAccountsStepProps) {
  const googleState = state.providerStates.google || {
    isConnected: false,
    isLoading: false,
    isConnecting: false,
  };

  return (
    <MinimalOnboardingLayout
      title={`Connect the work surfaces ${PRODUCT_NAME} should remember.`}
      description="Email, calendar, and meeting notes give memory enough context to answer with history."
      chips={["Step 03 / 04", "Local memory"]}
      panelTitle="Sources"
      panelDescription="Connect now or add more sources later."
      footer="Connected data is used to build your private context graph on this desktop."
    >
      <div className="grid gap-3">
        <div className="border border-white/10 bg-white/[0.045] p-3">
          <div className="flex items-start gap-3">
            <span className="flex size-9 shrink-0 items-center justify-center bg-red-500/15 text-red-300">
              <Mail className="size-4" />
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex items-center justify-between gap-3">
                <div className="font-medium text-white/86">Google</div>
                {googleState.isConnected && <CheckCircle2 className="size-4 text-emerald-400" />}
              </div>
              <p className="mt-1 text-xs leading-5 text-white/40">
                Email and calendar context for personalized assistance.
              </p>
              <button
                type="button"
                onClick={() => state.handleConnect("google")}
                disabled={googleState.isConnecting}
                className="mt-3 flex h-9 w-full items-center justify-center gap-2 border border-white/10 bg-white/[0.055] px-3 text-sm font-medium text-white/82 hover:border-white/18 hover:bg-white/[0.085] disabled:pointer-events-none disabled:opacity-60"
              >
                {googleState.isConnecting ? (
                  <>
                    <Loader2 className="size-4 animate-spin" />
                    Connecting
                  </>
                ) : googleState.isConnected ? (
                  <>
                    <CheckCircle2 className="size-4 text-emerald-400" />
                    Connected
                  </>
                ) : (
                  "Connect Google"
                )}
              </button>
            </div>
          </div>
        </div>

        <div className="border border-emerald-400/24 bg-emerald-400/[0.055] p-3">
          <div className="flex items-start gap-3">
            <span className="flex size-9 shrink-0 items-center justify-center bg-emerald-400/12 text-emerald-300">
              <ShieldCheck className="size-4" />
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex items-center justify-between gap-3">
                <div className="font-medium text-white/86">{PRODUCT_NAME} Meeting Notes</div>
                <span className="text-xs font-medium text-emerald-300">Ready</span>
              </div>
              <p className="mt-1 text-xs leading-5 text-white/40">
                Capture and summaries are ready once setup is complete.
              </p>
            </div>
          </div>
        </div>

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
            onClick={state.handleNext}
            className="flex h-11 items-center justify-center gap-2 bg-white px-3 text-sm font-semibold text-black transition-opacity hover:opacity-90"
          >
            Continue
            <ArrowRight className="size-4" />
          </button>
        </div>

        <button
          type="button"
          onClick={state.handleNext}
          className="text-xs text-white/34 hover:text-white/58"
        >
          Skip source connections for now
        </button>
      </div>
    </MinimalOnboardingLayout>
  );
}
