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
  Welcome: "Sign in or bring a key",
  Model: "Pick a provider",
  Connect: "Email, calendar, notes",
  Done: "Ready to go",
};

/**
 * Vertical progress rail for the full-page onboarding. Shares the same step
 * arrays as the horizontal {@link StepIndicator} so the two never drift, and
 * reuses the same done/current/upcoming node treatment.
 */
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
                  "size-7 rounded-full flex items-center justify-center text-xs font-medium transition-all duration-300",
                  done && "bg-primary text-primary-foreground",
                  current && "bg-primary text-primary-foreground ring-4 ring-primary/20",
                  !done && !current && "bg-muted text-muted-foreground",
                )}
              >
                {done ? <CheckCircle2 className="size-4" /> : i + 1}
              </div>
              {!isLast && (
                <div
                  className={cn(
                    "w-px h-8 my-1 transition-colors duration-500",
                    i < currentIndex ? "bg-primary" : "bg-border",
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
