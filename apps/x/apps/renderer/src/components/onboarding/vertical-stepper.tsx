import { CheckCircle2 } from "@/lib/icons";
import { cn } from "@/lib/utils";
import { ROWBOAT_STEPS, BYOK_STEPS } from "./step-indicator";
import type { Step, OnboardingPath } from "./use-onboarding-state";

interface VerticalStepperProps {
  currentStep: Step;
  path: OnboardingPath;
}

/** One-line context under each step label; keyed by the step's label. */
const SUBLABELS: Record<string, string> = {
  Access: "Account or API key",
  Model: "Provider validation",
  Sources: "Work context",
  Ready: "First run",
};

export function VerticalStepper({ currentStep, path }: VerticalStepperProps) {
  const steps = path === "byok" ? BYOK_STEPS : ROWBOAT_STEPS;
  const currentIndex = steps.findIndex((s) => s.step === currentStep);

  return (
    <div className="flex flex-col">
      {steps.map((s, i) => {
        const done = i < currentIndex;
        const current = i === currentIndex;
        const isLast = i === steps.length - 1;
        return (
          <div key={s.step} className="flex items-start gap-3">
            <div className="flex flex-col items-center">
              <div
                className={cn(
                  "flex size-8 items-center justify-center border font-mono text-[11px] font-medium transition-all duration-300",
                  done && "border-emerald-500/30 bg-emerald-500/10 text-emerald-500",
                  current &&
                    "border-foreground bg-foreground text-background ring-4 ring-foreground/10",
                  !done &&
                    !current &&
                    "border-[var(--onboarding-border)] bg-[var(--onboarding-card)] text-muted-foreground",
                )}
              >
                {done ? <CheckCircle2 className="size-4" /> : String(i + 1).padStart(2, "0")}
              </div>
              {!isLast && (
                <div
                  className={cn(
                    "my-1 h-8 w-px transition-colors duration-500",
                    i < currentIndex ? "bg-emerald-500/60" : "bg-[var(--onboarding-border)]",
                  )}
                />
              )}
            </div>
            <div className={cn("pt-0.5", isLast ? "pb-0" : "pb-6")}>
              <div
                className={cn(
                  "text-sm font-medium transition-colors duration-300",
                  i <= currentIndex ? "text-foreground" : "text-muted-foreground",
                )}
              >
                {s.label}
              </div>
              <div className="text-xs text-muted-foreground">{SUBLABELS[s.label]}</div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
