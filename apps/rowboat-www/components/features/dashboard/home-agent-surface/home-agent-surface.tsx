"use client";

import "client-only";

import { useEffect, useState, type ComponentPropsWithoutRef, type ReactNode } from "react";

import { cn } from "@oppulence/ui/lib/utils";

const STARTING_POINTS = [
  {
    label: "slipping promise",
    prompt:
      "Find the promise most likely to slip this week. Show me the source evidence, who owns it, and the smallest intervention that would get it back on track.",
  },
  {
    label: "at-risk relationship",
    prompt:
      "Which relationship needs intervention right now? Trace the signals that indicate risk and recommend the next conversation to have.",
  },
  {
    label: "open obligations",
    prompt:
      "Turn our open obligations into a recovery sequence. Prioritize by business impact, identify dependencies, and draft the next action for each owner.",
  },
] as const;

export type HomeAgentSurfaceProps = ComponentPropsWithoutRef<"section"> & {
  activeAgent: string;
  promptInput: ReactNode;
  signalPanel: ReactNode;
  workspace: string;
  onSelectPrompt: (prompt: string) => void;
};

/**
 * Keeps the home route focused on one operator brief while leaving workspace
 * signals visible. Reduced-motion users receive stable choices instead of a
 * timer-driven suggestion.
 */
export function HomeAgentSurface({
  activeAgent,
  className,
  promptInput,
  signalPanel,
  workspace,
  onSelectPrompt,
  ...props
}: HomeAgentSurfaceProps) {
  const [activeIndex, setActiveIndex] = useState(0);
  const [motionReduced, setMotionReduced] = useState(false);

  useEffect(() => {
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const syncMotion = () => setMotionReduced(media.matches);
    syncMotion();
    media.addEventListener("change", syncMotion);
    return () => media.removeEventListener("change", syncMotion);
  }, []);

  useEffect(() => {
    if (motionReduced) return;
    const timer = window.setInterval(() => {
      setActiveIndex((current) => (current + 1) % STARTING_POINTS.length);
    }, 4200);
    return () => window.clearInterval(timer);
  }, [motionReduced]);

  const activeStartingPoint = STARTING_POINTS[activeIndex];

  return (
    <section
      className={cn("relative flex min-h-full flex-col", className)}
      data-slot="home-agent-surface"
      {...props}
    >
      <div
        className="mx-auto flex w-full max-w-xl flex-1 flex-col justify-start px-4 md:px-8"
        data-slot="home-agent-hero"
      >
        <div className="flex gap-5 md:gap-6">
          <div
            aria-hidden
            className="flex shrink-0 flex-col items-end pt-1 font-mono text-[10px] leading-none text-[var(--text-muted)] opacity-70"
          >
            <span>01</span>
            <div className="mt-3 min-h-[88px] w-px flex-1 bg-[var(--border)]" />
          </div>

          <div className="min-w-0 flex-1">
            <h1 className="text-[2rem] font-medium tracking-[-0.04em] text-[var(--text-primary)] md:text-[2.35rem]">
              Resolve.
            </h1>

            <div
              aria-label="Agent brief"
              className={[
                "mt-8",
                "[&_[data-slot=input-group]]:border-0",
                "[&_[data-slot=input-group]]:border-b",
                "[&_[data-slot=input-group]]:border-[var(--border)]",
                "[&_[data-slot=input-group]]:bg-transparent",
                "[&_[data-slot=input-group]]:shadow-none",
                "[&_[data-slot=input-group]]:rounded-none",
                "[&_[data-slot=input-group]:focus-within]:border-[var(--text-primary)]",
                "[&_[data-slot=input-group]:focus-within]:opacity-100",
                "[&_[data-slot=input-group]:focus-within]:ring-0",
                "[&_[data-slot=input-group-control]]:min-h-12",
                "[&_[data-slot=input-group-control]]:px-0",
                "[&_[data-slot=input-group-control]]:text-xl",
                "[&_[data-slot=input-group-control]]:leading-8",
                "[&_[data-slot=input-group-control]]:text-[var(--text-primary)]",
                "[&_[data-slot=input-group-control]]:placeholder:text-[var(--text-muted)]",
                "[&_[data-slot=input-group]>div:last-child]:opacity-0",
                "[&_[data-slot=input-group]:focus-within>div:last-child]:opacity-100",
                "[&_[data-slot=input-group]>div:last-child]:transition-opacity",
                "[&_[data-slot=input-group-addon]]:px-0",
                "[&_[data-slot=input-group-addon]]:pb-2",
                "[&_[data-slot=input-group-addon]]:pt-0",
              ].join(" ")}
            >
              {promptInput}
            </div>

            <div className="mt-5 min-h-6">
              {motionReduced ? (
                <div className="flex flex-wrap gap-x-3 gap-y-1 text-sm text-[var(--text-muted)]">
                  {STARTING_POINTS.map((startingPoint, index) => (
                    <span className="inline-flex items-center gap-3" key={startingPoint.label}>
                      {index > 0 ? (
                        <span aria-hidden className="text-[var(--border)]">
                          ·
                        </span>
                      ) : null}
                      <button
                        className="font-normal transition-colors hover:text-[var(--text-secondary)]"
                        onClick={() => onSelectPrompt(startingPoint.prompt)}
                        type="button"
                      >
                        {startingPoint.label}
                      </button>
                    </span>
                  ))}
                </div>
              ) : (
                <button
                  className="text-left text-sm font-normal text-[var(--text-muted)] transition-colors hover:text-[var(--text-secondary)]"
                  key={activeStartingPoint.label}
                  onClick={() => onSelectPrompt(activeStartingPoint.prompt)}
                  type="button"
                >
                  <span className="animate-in fade-in duration-500">
                    {activeStartingPoint.label}
                  </span>
                </button>
              )}
            </div>

            <p className="mt-8 font-mono text-[10px] tracking-[0.08em] text-[var(--text-muted)]">
              {workspace} · {activeAgent}
            </p>
          </div>
        </div>

        {signalPanel ? (
          <div className="shrink-0" data-slot="home-agent-pulse">
            {signalPanel}
          </div>
        ) : null}
      </div>
    </section>
  );
}
