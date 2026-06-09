import { motion } from "motion/react";
import { Loader2, CheckCircle2, ArrowLeft, ArrowRight } from "@/lib/icons";
import { Button } from "@/components/ui/button";
import { PRODUCT_NAME } from "@x/shared/dist/branding.js";
import type { OnboardingState } from "./use-onboarding-state";

interface OnboardingFooterProps {
  state: OnboardingState;
}

/**
 * Sticky action bar for the full-page onboarding. The primary action differs per
 * step, so this is config-driven rather than a single button. Step 0 (Welcome)
 * has no footer — its CTA (sign in / continue) lives in the step body. All
 * handlers come straight off {@link OnboardingState}; no new logic here.
 */
export function OnboardingFooter({ state }: OnboardingFooterProps) {
  const { currentStep } = state;
  if (currentStep === 0) return null;

  return (
    <div className="sticky bottom-0 z-10 border-t border-border bg-background/80 px-8 py-4 backdrop-blur supports-[backdrop-filter]:bg-background/60 lg:px-14">
      <div className="mx-auto flex w-full max-w-[520px] items-center justify-between gap-3">
        {currentStep === 1 && (
          <>
            <Button variant="ghost" onClick={state.handleBack} className="gap-1">
              <ArrowLeft className="size-4" />
              Back
            </Button>
            <div className="flex items-center gap-3">
              {state.testState.status === "success" && (
                <motion.div
                  initial={{ opacity: 0, scale: 0.8 }}
                  animate={{ opacity: 1, scale: 1 }}
                  className="flex items-center gap-1.5 text-sm text-green-600 dark:text-green-400"
                >
                  <CheckCircle2 className="size-4" />
                  Connected
                </motion.div>
              )}
              {state.testState.status === "error" && (
                <span className="max-w-[200px] truncate text-sm text-destructive">
                  {state.testState.error}
                </span>
              )}
              <Button
                onClick={state.handleTestAndSaveLlmConfig}
                disabled={!state.canTest || state.testState.status === "testing"}
                className="min-w-[150px]"
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
            <Button variant="ghost" onClick={state.handleBack} className="gap-1">
              <ArrowLeft className="size-4" />
              Back
            </Button>
            <div className="flex items-center gap-2">
              <Button variant="ghost" onClick={state.handleNext} className="text-muted-foreground">
                Skip for now
              </Button>
              <Button onClick={state.handleNext} className="group">
                Continue
                <ArrowRight className="ml-1.5 size-4 transition-transform group-hover:translate-x-0.5" />
              </Button>
            </div>
          </>
        )}

        {currentStep === 3 && (
          <div className="flex w-full justify-center">
            <Button
              onClick={state.handleComplete}
              size="lg"
              className="h-12 min-w-[240px] text-base font-medium"
            >
              Start Using {PRODUCT_NAME}
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
