"use client";

import "client-only";

import { ArrowRight, Buildings, FileText, ListBullets } from "@/lib/icons";
import { useEffect, useState, type ComponentPropsWithoutRef, type ReactNode } from "react";

import { cn } from "@oppulence/ui/lib/utils";

const STARTING_POINTS = [
  {
    title: "Find a slipping promise",
    prompt:
      "Find the promise most likely to slip this week. Show me the source evidence, who owns it, and the smallest intervention that would get it back on track.",
  },
  {
    title: "Review an at-risk relationship",
    prompt:
      "Which relationship needs intervention right now? Trace the signals that indicate risk and recommend the next conversation to have.",
  },
  {
    title: "Sequence open obligations",
    prompt:
      "Turn our open obligations into a recovery sequence. Prioritize by business impact, identify dependencies, and draft the next action for each owner.",
  },
] as const;

const ACTION_ICONS = [ListBullets, Buildings, FileText] as const;

export type HomeAgentSurfaceProps = ComponentPropsWithoutRef<"section"> & {
  activeAgent: string;
  promptInput: ReactNode;
  signalPanel: ReactNode;
  userName?: string;
  workspace: string;
  onSelectPrompt: (prompt: string) => void;
};

function resolveGreetingName(userName?: string) {
  if (!userName?.trim()) return "there";
  if (!userName.includes("@")) return userName.trim();
  const local = userName.split("@")[0] ?? userName;
  const token = local.split(/[.+_-]/)[0] ?? local;
  if (!token) return "there";
  return token.charAt(0).toUpperCase() + token.slice(1);
}

/**
 * Home empty state aligned with the Sim hero composer: greeting above the input
 * and suggested actions below on desktop.
 */
export function HomeAgentSurface({
  activeAgent,
  className,
  promptInput,
  signalPanel,
  userName,
  workspace,
  onSelectPrompt,
  ...props
}: HomeAgentSurfaceProps) {
  const [motionReduced, setMotionReduced] = useState(false);
  const greetingName = resolveGreetingName(userName);

  useEffect(() => {
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const syncMotion = () => setMotionReduced(media.matches);
    syncMotion();
    media.addEventListener("change", syncMotion);
    return () => media.removeEventListener("change", syncMotion);
  }, []);

  return (
    <section
      className={cn("relative flex min-h-full flex-col", className)}
      data-slot="home-agent-surface"
      {...props}
    >
      <div
        className="mx-auto flex w-full max-w-xl flex-1 flex-col justify-center px-4 py-8 md:px-8"
        data-slot="home-agent-hero"
      >
        <div className="relative mx-auto w-full max-w-[560px]">
          <p className="mb-7 text-balance text-center text-[26px] text-[var(--text-primary)] leading-[1.2] tracking-[-0.01em] max-sm:text-[20px]">
            What should we get done, {greetingName}?
          </p>

          <div
            aria-label="Agent brief"
            className={[
              "relative",
              "[&_[data-slot=input-group]]:rounded-[10px]",
              "[&_[data-slot=input-group]]:border",
              "[&_[data-slot=input-group]]:border-[var(--border)]",
              "[&_[data-slot=input-group]]:bg-[var(--surface-2)]",
              "[&_[data-slot=input-group]]:shadow-xs",
              "[&_[data-slot=input-group]:focus-within]:border-[var(--text-primary)]",
              "[&_[data-slot=input-group]:focus-within]:ring-0",
              "[&_[data-slot=input-group-control]]:min-h-12",
              "[&_[data-slot=input-group-control]]:px-3",
              "[&_[data-slot=input-group-control]]:text-[15px]",
              "[&_[data-slot=input-group-control]]:leading-6",
              "[&_[data-slot=input-group-control]]:text-[var(--text-primary)]",
              "[&_[data-slot=input-group-control]]:placeholder:text-[var(--text-muted)]",
            ].join(" ")}
          >
            {promptInput}
          </div>

          <div className="mt-7 max-sm:hidden">
            <span className="text-[13px] text-[var(--text-secondary)]">Suggested actions</span>
            <div className="mt-2 flex flex-col overflow-hidden rounded-[10px] border border-[var(--border)] bg-[var(--bg)]">
              {STARTING_POINTS.map((action, index) => {
                const Icon = ACTION_ICONS[index];
                return (
                  <button
                    className="flex items-center gap-2 px-2 py-2 text-left text-[var(--text-body)] text-sm transition-colors duration-150 hover:bg-[var(--surface-hover)] focus-visible:outline focus-visible:outline-1 focus-visible:outline-[var(--text-primary)] [&+button]:border-[var(--border)] [&+button]:border-t"
                    key={action.title}
                    onClick={() => onSelectPrompt(action.prompt)}
                    type="button"
                  >
                    <Icon className="size-[16px] shrink-0 text-[var(--text-icon)]" />
                    <span className="min-w-0 flex-1 truncate">{action.title}</span>
                    <ArrowRight className="size-[14px] shrink-0 text-[var(--text-icon)]" />
                  </button>
                );
              })}
            </div>
          </div>

          <div className="mt-5 sm:hidden">
            {motionReduced ? (
              <div className="flex flex-col gap-2">
                {STARTING_POINTS.map((startingPoint) => (
                  <button
                    className="rounded-[10px] border border-[var(--border)] px-3 py-2 text-left text-sm text-[var(--text-secondary)] transition-colors hover:bg-[var(--surface-hover)]"
                    key={startingPoint.title}
                    onClick={() => onSelectPrompt(startingPoint.prompt)}
                    type="button"
                  >
                    {startingPoint.title}
                  </button>
                ))}
              </div>
            ) : (
              <button
                className="w-full rounded-[10px] border border-[var(--border)] px-3 py-2 text-left text-sm text-[var(--text-secondary)] transition-colors hover:bg-[var(--surface-hover)]"
                onClick={() => onSelectPrompt(STARTING_POINTS[0].prompt)}
                type="button"
              >
                {STARTING_POINTS[0].title}
              </button>
            )}
          </div>

          <p className="mt-8 text-center font-mono text-[10px] tracking-[0.08em] text-[var(--text-muted)]">
            {workspace} · {activeAgent}
          </p>
        </div>

        {signalPanel ? (
          <div className="mt-10 shrink-0" data-slot="home-agent-pulse">
            {signalPanel}
          </div>
        ) : null}
      </div>
    </section>
  );
}
