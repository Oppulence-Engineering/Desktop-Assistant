import { useEffect, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { ShieldCheck } from "@/lib/icons";
import { PRODUCT_NAME } from "@x/shared/dist/branding.js";
import type { OnboardingState } from "./use-onboarding-state";
import { VerticalStepper } from "./vertical-stepper";

interface BrandRailProps {
  state: OnboardingState;
}

/** Short, on-message value props sourced from the existing product framing. */
const VALUE_PROPS = [
  "Connects to the work you already do.",
  "Builds a private knowledge graph.",
  "Remembers context so you don't repeat yourself.",
];

const ROTATE_MS = 4500;

/**
 * Persistent left rail for the full-page onboarding (lg+ only). Owns the brand
 * identity (logo, wordmark, tagline) and the vertical progress, so the step
 * content column stays focused on the task at hand. Hidden below `lg`, where the
 * full-page shell renders a compact top bar instead.
 */
export function BrandRail({ state }: BrandRailProps) {
  const reduceMotion = useReducedMotion();
  const [propIndex, setPropIndex] = useState(0);

  useEffect(() => {
    if (reduceMotion) return;
    const id = setInterval(() => setPropIndex((i) => (i + 1) % VALUE_PROPS.length), ROTATE_MS);
    return () => clearInterval(id);
  }, [reduceMotion]);

  return (
    <aside className="onboarding-dot-grid relative hidden w-[400px] shrink-0 flex-col border-r border-border bg-[var(--rowboat-panel)] px-9 py-10 lg:flex">
      {/* Ambient gradient keyed off --foreground → auto-inverts between themes. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(120%_80%_at_15%_100%,color-mix(in_oklab,var(--foreground)_6%,transparent),transparent_60%)]"
      />

      <div className="relative flex flex-1 flex-col">
        {/* Logo + wordmark (with the signature ambient glow). */}
        <div className="mb-3 flex items-center gap-3">
          <div className="relative">
            <div className="absolute inset-0 size-9 bg-primary/10 blur-xl scale-[2.5]" />
            <img src="/logo-only.png" alt={PRODUCT_NAME} className="relative size-9 dark:invert" />
          </div>
          <span className="text-lg font-semibold tracking-tight">{PRODUCT_NAME}</span>
        </div>

        {/* Tagline badge. */}
        <div className="mb-10 inline-flex w-fit items-center gap-2 rounded-full border bg-muted/50 px-3 py-1 text-xs font-medium text-muted-foreground">
          <span className="size-1.5 rounded-full bg-green-500 animate-pulse" />
          Your AI coworker, with memory
        </div>

        {/* Vertical progress. */}
        <VerticalStepper currentStep={state.currentStep} path={state.onboardingPath} />

        <div className="flex-1" />

        {/* Rotating value prop (static when reduced motion is requested). */}
        <div className="mb-6 min-h-[40px]">
          {reduceMotion ? (
            <p className="text-sm text-muted-foreground">{VALUE_PROPS[0]}</p>
          ) : (
            <AnimatePresence mode="wait">
              <motion.p
                key={propIndex}
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -6 }}
                transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
                className="text-sm text-muted-foreground"
              >
                {VALUE_PROPS[propIndex]}
              </motion.p>
            </AnimatePresence>
          )}
        </div>

        {/* Privacy footnote. */}
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <ShieldCheck className="size-3.5" />
          Private · on your machine
        </div>
      </div>
    </aside>
  );
}
