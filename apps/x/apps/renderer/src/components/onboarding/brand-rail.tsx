import { BrainIcon, CheckCircle2, Mail, Network, ShieldCheck, Sparkles } from "@/lib/icons";
import { PRODUCT_NAME, isProductProvider } from "@x/shared/branding";
import type { OnboardingState } from "./use-onboarding-state";
import { VerticalStepper } from "./vertical-stepper";

interface BrandRailProps {
  state: OnboardingState;
}

export function BrandRail({ state }: BrandRailProps) {
  const connectedSources =
    state.connectedProviders.filter((provider) => !isProductProvider(provider)).length +
    (state.gmailConnected ? 1 : 0) +
    (state.googleCalendarConnected ? 1 : 0);
  const modelMode =
    state.onboardingPath === "byok"
      ? "Own provider"
      : state.onboardingPath === "rowboat"
        ? "Managed"
        : "Select access";

  return (
    <aside className="onboarding-dot-grid relative hidden w-[420px] shrink-0 flex-col border-r border-[var(--onboarding-border)] bg-[var(--onboarding-panel)] px-9 py-8 lg:flex">
      <div className="relative flex flex-1 flex-col">
        <div className="mb-10">
          <div className="mb-6 flex items-center gap-3">
            <div className="flex size-9 items-center justify-center border border-[var(--onboarding-border)] bg-[var(--onboarding-card)]">
              <img src="/logo-only.png" alt={PRODUCT_NAME} className="size-6 dark:invert" />
            </div>
            <div className="min-w-0">
              <div className="text-base font-semibold tracking-tight">{PRODUCT_NAME}</div>
              <div className="text-xs text-muted-foreground">Desktop setup</div>
            </div>
          </div>

          <div className="inline-flex items-center gap-2 border border-[var(--onboarding-border)] bg-[var(--onboarding-card)] px-2.5 py-1 text-[11px] font-medium text-muted-foreground">
            <span className="size-1.5 rounded-full bg-emerald-500" />
            Private working memory
          </div>
        </div>

        <div className="mb-9">
          <p className="mb-3 max-w-[300px] text-3xl font-semibold leading-[1.05] tracking-tight">
            Give {PRODUCT_NAME} its model and memory sources.
          </p>
          <p className="max-w-[280px] text-sm leading-6 text-muted-foreground">
            A short setup pass for model access, work context, and the first run.
          </p>
        </div>

        <div className="mb-8">
          <VerticalStepper currentStep={state.currentStep} path={state.onboardingPath} />
        </div>

        <div className="flex-1" />

        <div className="mb-6 border border-[var(--onboarding-border)] bg-[var(--onboarding-card)]">
          <div className="flex items-center justify-between border-b border-[var(--onboarding-border)] px-4 py-3">
            <div className="flex items-center gap-2 text-sm font-medium">
              <BrainIcon className="size-4" />
              Context engine
            </div>
            <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
              local
            </span>
          </div>
          <div className="grid grid-cols-3 divide-x divide-[var(--onboarding-border)]">
            {[
              { icon: Mail, label: "Ingest" },
              { icon: Network, label: "Map" },
              { icon: Sparkles, label: "Recall" },
            ].map(({ icon: Icon, label }) => (
              <div key={label} className="flex min-h-[86px] flex-col justify-between p-3">
                <Icon className="size-4 text-muted-foreground" />
                <span className="text-xs font-medium">{label}</span>
              </div>
            ))}
          </div>
          <div className="border-t border-[var(--onboarding-border)] px-4 py-3">
            <div className="grid grid-cols-2 gap-3 text-xs">
              <div>
                <div className="font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
                  Model
                </div>
                <div className="mt-1 font-medium">{modelMode}</div>
              </div>
              <div>
                <div className="font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
                  Sources
                </div>
                <div className="mt-1 font-medium">{connectedSources || "Pending"}</div>
              </div>
            </div>
          </div>
        </div>

        <div className="flex items-center justify-between border-t border-[var(--onboarding-border)] pt-4 text-xs text-muted-foreground">
          <div className="flex items-center gap-2">
            <ShieldCheck className="size-3.5" />
            Local-first by default
          </div>
          <CheckCircle2 className="size-3.5 text-emerald-500" />
        </div>
      </div>
    </aside>
  );
}
