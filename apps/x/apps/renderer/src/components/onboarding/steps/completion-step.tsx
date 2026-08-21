import { ArrowRight, CheckCircle2, ShieldCheck } from "@/lib/icons";
import { PRODUCT_NAME } from "@x/shared/branding";
import { MinimalOnboardingLayout } from "../minimal-layout";
import type { OnboardingState } from "../use-onboarding-state";

interface CompletionStepProps {
  state: OnboardingState;
}

export function CompletionStep({ state }: CompletionStepProps) {
  const modelAccess = state.onboardingPath === "byok" ? "Custom provider" : "Managed access";
  const hasSources =
    state.gmailConnected ||
    state.googleCalendarConnected ||
    state.connectedProviders.some((provider) => provider !== "solomon" && provider !== "rowboat");

  return (
    <MinimalOnboardingLayout
      title={`${PRODUCT_NAME} is ready for the first run.`}
      description="The workspace can start now; more sources and model routing can be changed later."
      chips={["Step 04 / 04", "Ready"]}
      panelTitle="Setup summary"
      panelDescription="Everything needed for first launch is in place."
      footer="Local desktop context stays private by default."
    >
      <div className="grid gap-3">
        <div className="flex size-12 items-center justify-center border border-emerald-400/28 bg-emerald-400/[0.08] text-emerald-300">
          <CheckCircle2 className="size-6" />
        </div>

        <div className="divide-y divide-white/8 border border-white/10 bg-white/[0.045]">
          {[
            ["Model access", modelAccess],
            ["Sources", hasSources ? "Connected" : "Available in settings"],
            ["Memory", "Ready when sources connect"],
          ].map(([label, value]) => (
            <div key={label} className="flex items-center justify-between gap-3 px-3 py-3">
              <span className="text-sm text-white/42">{label}</span>
              <span className="text-right text-sm font-medium text-white/82">{value}</span>
            </div>
          ))}
        </div>

        <div className="flex items-start gap-2 border border-white/10 bg-white/[0.035] p-3 text-xs leading-5 text-white/40">
          <ShieldCheck className="mt-0.5 size-4 shrink-0 text-white/50" />
          <span>Settings stays available if you want to add Google, Slack, Granola, or another model.</span>
        </div>

        <button
          type="button"
          onClick={state.handleComplete}
          className="mt-1 flex h-11 items-center justify-center gap-2 bg-white px-3 text-sm font-semibold text-black transition-opacity hover:opacity-90"
        >
          Start Using {PRODUCT_NAME}
          <ArrowRight className="size-4" />
        </button>
      </div>
    </MinimalOnboardingLayout>
  );
}
