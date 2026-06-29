"use client";

import * as React from "react";
import { AnimatePresence, motion } from "motion/react";

import { GoogleClientIdModal } from "@/components/google-client-id-modal";
import { IntegrationApiKeyModal } from "@/components/integration-api-key-modal";
import { useOnboardingState } from "./use-onboarding-state";
import { WelcomeStep } from "./steps/welcome-step";
import { LlmSetupStep } from "./steps/llm-setup-step";
import { ConnectAccountsStep } from "./steps/connect-accounts-step";
import { CompletionStep } from "./steps/completion-step";

interface FullPageOnboardingProps {
  open: boolean;
  onComplete: () => void;
}

export function FullPageOnboarding({ open, onComplete }: FullPageOnboardingProps) {
  const state = useOnboardingState(open, onComplete);
  const scrollRef = React.useRef<HTMLDivElement>(null);

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

  React.useEffect(() => {
    scrollRef.current?.scrollTo({ top: 0 });
  }, [state.currentStep]);

  return (
    <>
      <GoogleClientIdModal
        open={state.googleClientIdOpen}
        onOpenChange={state.setGoogleClientIdOpen}
        onSubmit={state.handleGoogleClientIdSubmit}
        isSubmitting={state.providerStates.google?.isConnecting ?? false}
      />
      <IntegrationApiKeyModal
        open={state.integrationApiKeyOpen}
        onOpenChange={state.setIntegrationApiKeyOpen}
        onSubmit={state.handleIntegrationApiKeySubmit}
        isSubmitting={state.integrationApiKeySubmitting}
        integrationName={state.integrationApiKeyTarget?.displayName}
      />

      <div
        className="rowboat-shell onboarding-shell onboarding-shell--welcome flex h-svh w-full flex-col overflow-hidden bg-[var(--onboarding-bg)] text-foreground"
      >
        <div className="titlebar-drag-region h-9 shrink-0 border-b border-[var(--onboarding-border)] bg-[var(--onboarding-bg)]" />

        <div className="flex min-h-0 flex-1 bg-[var(--onboarding-bg)]">
          <div className="flex min-w-0 flex-1 flex-col">
            <div className="relative flex min-h-0 flex-1 flex-col">
              <div
                aria-hidden
                className="onboarding-main-grid pointer-events-none absolute inset-0"
              />
              <div ref={scrollRef} className="relative flex-1 overflow-y-auto">
                <div className="flex min-h-full w-full flex-col p-0">
                  <AnimatePresence mode="wait">
                    <motion.div
                      key={state.currentStep}
                      initial={{ opacity: 0, y: 12 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -6 }}
                      transition={{ duration: 0.24, ease: [0.16, 1, 0.3, 1] }}
                      className="flex min-h-full flex-1 flex-col"
                    >
                      {stepContent}
                    </motion.div>
                  </AnimatePresence>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
