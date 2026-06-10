import { Loader2, CheckCircle2 } from "@/lib/icons";
import { motion } from "motion/react";
import { Button } from "@/components/ui/button";
import type { OnboardingState } from "../use-onboarding-state";
import {
  PRODUCT_NAME,
  PRODUCT_PROVIDER_ID,
  getProductProviderState,
} from "@x/shared/dist/branding.js";

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
    <div className="flex flex-col items-center justify-center text-center flex-1">
      {/* Logo + tagline live in the persistent brand rail now (full-page shell). */}
      {/* Main heading */}
      <motion.h1
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.2 }}
        className="text-3xl font-bold tracking-tight mb-3"
      >
        Welcome to {PRODUCT_NAME}
      </motion.h1>
      <motion.p
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.3 }}
        className="text-base text-muted-foreground leading-relaxed max-w-sm mb-10"
      >
        {PRODUCT_NAME} connects to your work, builds a knowledge graph, and uses that context to
        help you get things done. Private and on your machine.
      </motion.p>

      {/* Sign in / connected state */}
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.4 }}
        className="w-full max-w-xs"
      >
        {solomonState.isConnected ? (
          <div className="flex flex-col items-center gap-4">
            <div className="flex items-center gap-2 text-green-600 dark:text-green-400">
              <CheckCircle2 className="size-5" />
              <span className="text-sm font-medium">Connected to {PRODUCT_NAME}</span>
            </div>
            <Button
              onClick={() => {
                state.setOnboardingPath("rowboat");
                state.setCurrentStep(2);
              }}
              size="lg"
              className="w-full h-12 text-base font-medium"
            >
              Continue
            </Button>
          </div>
        ) : (
          <div className="flex flex-col items-center gap-4">
            <Button
              onClick={() => {
                state.setOnboardingPath("rowboat");
                state.startConnect(PRODUCT_PROVIDER_ID);
              }}
              size="lg"
              className="w-full h-12 text-base font-medium"
              disabled={solomonState.isConnecting}
            >
              {solomonState.isConnecting ? (
                <>
                  <Loader2 className="size-5 animate-spin mr-2" />
                  Waiting for sign in...
                </>
              ) : (
                `Sign in with ${PRODUCT_NAME}`
              )}
            </Button>
            {solomonState.isConnecting && (
              <p className="text-xs text-muted-foreground animate-pulse">
                Complete sign in in your browser, then return here.
              </p>
            )}
          </div>
        )}
      </motion.div>

      {/* BYOK link */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.5 }}
        className="mt-8"
      >
        <button
          onClick={() => {
            state.setOnboardingPath("byok");
            state.setCurrentStep(1);
          }}
          className="text-sm text-muted-foreground hover:text-foreground transition-colors underline underline-offset-4 decoration-muted-foreground/30 hover:decoration-foreground/50"
        >
          I want to bring my own API key
        </button>
      </motion.div>
    </div>
  );
}
