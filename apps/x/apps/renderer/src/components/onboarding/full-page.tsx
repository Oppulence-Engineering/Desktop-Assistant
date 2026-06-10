"use client";

import * as React from "react";
import { AnimatePresence, motion } from "motion/react";

import { GoogleClientIdModal } from "@/components/google-client-id-modal";
import { ComposioApiKeyModal } from "@/components/composio-api-key-modal";
import { PRODUCT_NAME } from "@x/shared/dist/branding.js";
import { useOnboardingState } from "./use-onboarding-state";
import { ROWBOAT_STEPS, BYOK_STEPS } from "./step-indicator";
import { BrandRail } from "./brand-rail";
import { OnboardingFooter } from "./onboarding-footer";
import { WelcomeStep } from "./steps/welcome-step";
import { LlmSetupStep } from "./steps/llm-setup-step";
import { ConnectAccountsStep } from "./steps/connect-accounts-step";
import { CompletionStep } from "./steps/completion-step";

interface FullPageOnboardingProps {
  open: boolean;
  onComplete: () => void;
}

/**
 * Full-window onboarding (RFC: "not just a dialog"). Renders a two-column
 * takeover — a persistent {@link BrandRail} + a scrolling step column with a
 * sticky {@link OnboardingFooter}. Mounted by App.tsx via an early return BEFORE
 * the app shell, so no sidebar/tab bar/chat panel exists behind it (a true
 * takeover; no overlay/z-index needed). All flow logic is reused verbatim from
 * {@link useOnboardingState}; only the presentation changed from the old modal.
 */
export function FullPageOnboarding({ open, onComplete }: FullPageOnboardingProps) {
  const state = useOnboardingState(open, onComplete);

  const stepContent = React.useMemo(() => {
    switch (state.currentStep) {
      case 0:
        return <WelcomeStep state={state} />;
      case 1:
        return <LlmSetupStep state={state} />;
      case 2:
        return <ConnectAccountsStep state={state} />;
      case 3:
        return <CompletionStep state={state} />;
    }
  }, [state.currentStep, state]);

  // Compact "Step N of M" for the narrow (<lg) top bar.
  const steps = state.onboardingPath === "byok" ? BYOK_STEPS : ROWBOAT_STEPS;
  const stepNumber = steps.findIndex((s) => s.step === state.currentStep) + 1;

  return (
    <>
      {/* Helper modals preserved verbatim from the old modal shell. */}
      <GoogleClientIdModal
        open={state.googleClientIdOpen}
        onOpenChange={state.setGoogleClientIdOpen}
        onSubmit={state.handleGoogleClientIdSubmit}
        isSubmitting={state.providerStates.google?.isConnecting ?? false}
      />
      <ComposioApiKeyModal
        open={state.composioApiKeyOpen}
        onOpenChange={state.setComposioApiKeyOpen}
        onSubmit={state.handleComposioApiKeySubmit}
        isSubmitting={state.gmailConnecting}
      />

      <div className="rowboat-shell flex h-svh w-full flex-col overflow-hidden bg-background">
        {/* Top drag strip — frameless window has no titlebar while onboarding owns
            the screen; keeps the window movable and clears macOS traffic lights. */}
        <div className="titlebar-drag-region h-9 shrink-0" />

        <div className="flex min-h-0 flex-1">
          <BrandRail state={state} />

          <div className="flex min-w-0 flex-1 flex-col">
            {/* Narrow (<lg) compact header in place of the rail. */}
            <div className="flex shrink-0 items-center gap-2.5 border-b border-border bg-[var(--rowboat-panel)] px-6 py-3.5 lg:hidden">
              <img src="/logo-only.png" alt={PRODUCT_NAME} className="size-6 dark:invert" />
              <span className="text-sm font-semibold">{PRODUCT_NAME}</span>
              <span className="ml-auto text-xs text-muted-foreground">
                Step {stepNumber} of {steps.length}
              </span>
            </div>

            <div className="flex min-h-0 flex-1 flex-col">
              <div className="flex-1 overflow-y-auto">
                <div className="mx-auto flex min-h-full w-full max-w-[520px] flex-col px-8 py-12 lg:px-14 lg:py-16">
                  <AnimatePresence mode="wait">
                    <motion.div
                      key={state.currentStep}
                      initial={{ opacity: 0, y: 14 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -8 }}
                      transition={{ duration: 0.28, ease: [0.16, 1, 0.3, 1] }}
                      className="flex flex-1 flex-col"
                    >
                      {stepContent}
                    </motion.div>
                  </AnimatePresence>
                </div>
              </div>

              <OnboardingFooter state={state} />
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
