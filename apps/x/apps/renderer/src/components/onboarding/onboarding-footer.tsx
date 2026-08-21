import { motion } from "motion/react";
import { Loader2, CheckCircle2, ArrowLeft, ArrowRight } from "@/lib/icons";
import { Button } from "@oppulence/ui/components/button";
import { PRODUCT_NAME } from "@x/shared/branding";
import type { OnboardingState } from "./use-onboarding-state";

interface OnboardingFooterProps {
  state: OnboardingState;
}

export function OnboardingFooter({ state }: OnboardingFooterProps) {
  const { currentStep } = state;
  if (currentStep === 0) return null;

  return (
    <div className="sticky bottom-0 z-10 border-t border-[var(--onboarding-border)] bg-[var(--onboarding-bg)]/90 px-5 py-4 backdrop-blur supports-[backdrop-filter]:bg-[var(--onboarding-bg)]/78 sm:px-8 lg:px-12 xl:px-14">
      <div className="mx-auto flex w-full max-w-[980px] flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        {currentStep === 1 && (
          <>
            <Button
              variant="ghost"
              onClick={state.handleBack}
              className="h-10 justify-start gap-1 sm:justify-center"
            >
              <ArrowLeft className="size-4" />
              Back
            </Button>
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
              {state.testState.status === "success" && (
                <motion.div
                  initial={{ opacity: 0, scale: 0.8 }}
                  animate={{ opacity: 1, scale: 1 }}
                  className="flex items-center gap-1.5 text-sm text-emerald-600 dark:text-emerald-400"
                >
                  <CheckCircle2 className="size-4" />
                  Connected
                </motion.div>
              )}
              {state.testState.status === "error" && (
                <span className="max-w-full truncate text-sm text-destructive sm:max-w-[260px]">
                  {state.testState.error}
                </span>
              )}
              <Button
                onClick={state.handleTestAndSaveLlmConfig}
                disabled={!state.canTest || state.testState.status === "testing"}
                className="h-10 min-w-[168px]"
              >
                {state.testState.status === "testing" ? (
                  <>
                    <Loader2 className="mr-2 size-4 animate-spin" />
                    Testing...
                  </>
                ) : (
                  "Test & Continue"
                )}
              </Button>
            </div>
          </>
        )}

        {currentStep === 2 && (
          <>
            <Button
              variant="ghost"
              onClick={state.handleBack}
              className="h-10 justify-start gap-1 sm:justify-center"
            >
              <ArrowLeft className="size-4" />
              Back
            </Button>
            <div className="flex items-center justify-end gap-2">
              <Button
                variant="ghost"
                onClick={state.handleNext}
                className="h-10 text-muted-foreground"
              >
                Skip for now
              </Button>
              <Button onClick={state.handleNext} className="group h-10 min-w-[128px]">
                Continue
                <ArrowRight className="ml-1.5 size-4 transition-transform group-hover:translate-x-0.5" />
              </Button>
            </div>
          </>
        )}

        {currentStep === 3 && (
          <div className="flex w-full justify-end">
            <Button
              onClick={state.handleComplete}
              size="lg"
              className="h-11 min-w-[220px] text-sm font-semibold"
            >
              Start Using {PRODUCT_NAME}
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
