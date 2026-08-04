import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { ArrowLeft, ArrowRight } from "@/lib/icons";
import * as analytics from "@/lib/analytics";
import {
  getProductTourStorage,
  isProductTourComplete,
  markProductTourComplete,
} from "@/lib/product-tour-state";

export type ProductTourVariant = "main" | "relationships" | "meetings" | "actions";
export type TourPlacement = "top" | "bottom" | "left" | "right";

export type TourStep = {
  target: string;
  eyebrow: string;
  title: string;
  body: string;
  placement?: TourPlacement;
};

export const PRODUCT_TOUR_STEPS: Record<ProductTourVariant, TourStep[]> = {
  main: [
    {
      target: "assistant",
      eyebrow: "01 · Assistant",
      title: "Work with your relationship context",
      body: "Ask the assistant to explain a customer signal, find supporting evidence, or draft the next action without sending it.",
      placement: "left",
    },
    {
      target: "accounts",
      eyebrow: "02 · Accounts",
      title: "Make the relationship the unit of work",
      body: "Start with the customer account that needs attention. Health, evidence, commitments, and next actions stay together.",
      placement: "right",
    },
    {
      target: "evidence-inbox",
      eyebrow: "03 · Evidence inbox",
      title: "Bring source material into the relationship",
      body: "Review the messages and records that explain what changed before you decide what it means.",
      placement: "right",
    },
    {
      target: "meetings",
      eyebrow: "04 · Meetings",
      title: "Turn conversations into evidence",
      body: "Capture or import meetings so transcripts, commitments, and relationship updates stay connected to the account.",
      placement: "right",
    },
    {
      target: "evidence-nav",
      eyebrow: "05 · Evidence graph",
      title: "Trace the story behind the state",
      body: "Use the evidence graph to connect messages, meetings, notes, and observations into an explainable relationship timeline.",
      placement: "right",
    },
    {
      target: "chat-composer",
      eyebrow: "06 · Active context",
      title: "Ask from the context you have gathered",
      body: "The composer can use the account, meeting, evidence, and connected tools already open in Rowboat.",
      placement: "top",
    },
    {
      target: "actions",
      eyebrow: "07 · Actions",
      title: "Automate repeatable relationship work",
      body: "Use background actions for recurring follow-ups, risk checks, and evidence maintenance.",
      placement: "right",
    },
    {
      target: "tools",
      eyebrow: "08 · Tools",
      title: "Bring your working tools into context",
      body: "Connect the apps and MCP tools you already use so relationship context can travel with the work.",
      placement: "right",
    },
    {
      target: "evidence",
      eyebrow: "09 · Relationship evidence",
      title: "Every claim has a source",
      body: "Inspect source-linked observations, timeline events, freshness, confidence, and why the relationship state changed.",
      placement: "right",
    },
    {
      target: "connections",
      eyebrow: "10 · Sources",
      title: "Keep source health visible",
      body: "Google, Slack, Fireflies, HubSpot, MCP tools, and local notes contribute evidence to the same relationship model.",
      placement: "right",
    },
    {
      target: "settings",
      eyebrow: "11 · Settings",
      title: "Control privacy, models, and permissions",
      body: "Configure connected accounts, model providers, notifications, security, and what stays on this Mac.",
      placement: "right",
    },
    {
      target: "relationship-action",
      eyebrow: "12 · Approval",
      title: "Oppulence proposes; you approve",
      body: "Review the recommendation, policy decision, and evidence before any external message or write is executed.",
      placement: "right",
    },
    {
      target: "tour-button",
      eyebrow: "13 · Help",
      title: "Come back here anytime",
      body: "Use Take a tour from the sidebar or Settings → Help to restart this walkthrough whenever you need it.",
      placement: "top",
    },
  ],
  relationships: [
    {
      target: "home-accounts",
      eyebrow: "01 · Mission control",
      title: "Start with the account",
      body: "Home surfaces the customer relationships that need attention before inboxes and tools.",
      placement: "bottom",
    },
    {
      target: "attention-queue",
      eyebrow: "02 · Prioritize",
      title: "Review explainable urgency",
      body: "Open an attention item to see what changed, why it matters, and which evidence is still needed.",
      placement: "right",
    },
    {
      target: "evidence",
      eyebrow: "03 · Reconcile",
      title: "Trace the relationship state",
      body: "Follow claims back to source records and timeline observations instead of trusting an opaque score.",
      placement: "right",
    },
    {
      target: "relationship-action",
      eyebrow: "04 · Act safely",
      title: "Approve the next action",
      body: "Recommendations stay reviewable until you approve the exact action and revision.",
      placement: "right",
    },
  ],
  meetings: [
    {
      target: "meetings",
      eyebrow: "01 · Meetings",
      title: "Turn conversations into evidence",
      body: "Capture or import a meeting and keep the transcript, commitments, and relationship updates together.",
      placement: "right",
    },
    {
      target: "meeting-notes",
      eyebrow: "02 · Notes",
      title: "Capture commitments as they happen",
      body: "Meeting notes become source-linked evidence that can update account health and next actions.",
      placement: "right",
    },
    {
      target: "evidence",
      eyebrow: "03 · Evidence",
      title: "Review what the meeting changed",
      body: "Inspect the timeline and relationship state after capture, including confidence and unresolved questions.",
      placement: "right",
    },
    {
      target: "connections",
      eyebrow: "04 · Sources",
      title: "Complete the meeting context",
      body: "Calendar, Fireflies, Slack, and connected notes make the meeting record more useful than a transcript alone.",
      placement: "right",
    },
  ],
  actions: [
    {
      target: "actions",
      eyebrow: "01 · Actions",
      title: "Automate repeatable relationship work",
      body: "Use background actions for recurring follow-ups, risk checks, and evidence maintenance.",
      placement: "right",
    },
    {
      target: "relationship-action",
      eyebrow: "02 · Approval",
      title: "Review before anything leaves Rowboat",
      body: "Inspect the proposed message, policy decision, revision, and evidence before approving it.",
      placement: "right",
    },
    {
      target: "assistant",
      eyebrow: "03 · Assistant",
      title: "Use the assistant to resolve the exception",
      body: "Ask for a grounded draft, research, or next-step recommendation when an action needs human judgment.",
      placement: "left",
    },
    {
      target: "settings",
      eyebrow: "04 · Controls",
      title: "Keep automation within your policy",
      body: "Configure permissions, security, models, and notifications so automation stays observable and governed.",
      placement: "right",
    },
  ],
};

type ProductTourProps = {
  open: boolean;
  variant?: ProductTourVariant;
  forceStart?: boolean;
  onClose: () => void;
  onStepChange?: (step: TourStep, index: number) => void;
  onStartVariant?: (variant: Exclude<ProductTourVariant, "main">) => void;
};

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function calculateCardPosition(
  target: DOMRect | null,
  card: DOMRect | null,
  placement: TourPlacement,
) {
  if (!card || !target) {
    return {
      left: Math.max(16, (window.innerWidth - (card?.width ?? 380)) / 2),
      top: Math.max(16, (window.innerHeight - (card?.height ?? 240)) / 2),
    };
  }
  const gap = 16;
  const candidates = {
    top: {
      left: target.left + (target.width - card.width) / 2,
      top: target.top - card.height - gap,
    },
    bottom: { left: target.left + (target.width - card.width) / 2, top: target.bottom + gap },
    left: {
      left: target.left - card.width - gap,
      top: target.top + (target.height - card.height) / 2,
    },
    right: { left: target.right + gap, top: target.top + (target.height - card.height) / 2 },
  };
  const preferred = candidates[placement];
  const left = clamp(preferred.left, 16, Math.max(16, window.innerWidth - card.width - 16));
  const top = clamp(preferred.top, 16, Math.max(16, window.innerHeight - card.height - 16));
  return { left, top };
}

function Spotlight({ target }: { target: DOMRect | null }) {
  if (!target) return null;
  const padding = 8;
  const top = Math.max(0, target.top - padding);
  const left = Math.max(0, target.left - padding);
  const right = Math.min(window.innerWidth, target.right + padding);
  const bottom = Math.min(window.innerHeight, target.bottom + padding);
  return (
    <>
      <div
        className="fixed inset-x-0 top-0 z-[100] bg-black/35 backdrop-blur-[1px]"
        style={{ height: top }}
      />
      <div
        className="fixed left-0 z-[100] bg-black/35 backdrop-blur-[1px]"
        style={{ top, width: left, height: bottom - top }}
      />
      <div
        className="fixed right-0 z-[100] bg-black/35 backdrop-blur-[1px]"
        style={{ top, width: Math.max(0, window.innerWidth - right), height: bottom - top }}
      />
      <div
        className="fixed inset-x-0 bottom-0 z-[100] bg-black/35 backdrop-blur-[1px]"
        style={{ height: Math.max(0, window.innerHeight - bottom) }}
      />
      <div
        className="pointer-events-none fixed z-[101] border-2 border-white/70"
        style={{ top, left, width: right - left, height: bottom - top }}
      />
    </>
  );
}

export function ProductTour({
  open,
  variant = "main",
  forceStart = false,
  onClose,
  onStepChange,
  onStartVariant,
}: ProductTourProps) {
  const steps = PRODUCT_TOUR_STEPS[variant];
  const [stepIndex, setStepIndex] = useState(0);
  const [target, setTarget] = useState<Element | null>(null);
  const [targetMissing, setTargetMissing] = useState(false);
  const [position, setPosition] = useState({ left: 16, top: 16 });
  const cardRef = useRef<HTMLDivElement | null>(null);
  const missingReportedRef = useRef<string | null>(null);
  const startedRef = useRef(false);

  const currentStep = steps[stepIndex] ?? steps[0];
  const canRender = open && (forceStart || !isProductTourComplete(getProductTourStorage()));

  useEffect(() => {
    if (!open) {
      startedRef.current = false;
      return;
    }
    setStepIndex(0);
    setTarget(null);
    setTargetMissing(false);
    if (!startedRef.current) {
      analytics.productTourStarted(variant);
      startedRef.current = true;
    }
  }, [open, variant]);

  useEffect(() => {
    if (!canRender || !currentStep) return;
    onStepChange?.(currentStep, stepIndex);
    setTarget(null);
    setTargetMissing(false);
    missingReportedRef.current = null;
    let raf2: number | undefined;
    let retries = 0;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    const resolve = () => {
      const next = document.querySelector(`[data-tour-target="${currentStep.target}"]`);
      if (next) {
        next.scrollIntoView({ block: "center", inline: "nearest", behavior: "auto" });
        setTarget(next);
        analytics.productTourStepViewed(variant, stepIndex, currentStep.target);
        return;
      }
      if (retries < 8) {
        retries += 1;
        retryTimer = setTimeout(resolve, 80);
        return;
      }
      setTargetMissing(true);
      if (missingReportedRef.current !== currentStep.target) {
        missingReportedRef.current = currentStep.target;
        analytics.productTourTargetMissing(variant, stepIndex, currentStep.target);
      }
    };
    const raf1 = requestAnimationFrame(() => {
      raf2 = requestAnimationFrame(resolve);
    });
    return () => {
      cancelAnimationFrame(raf1);
      if (raf2 !== undefined) cancelAnimationFrame(raf2);
      if (retryTimer) clearTimeout(retryTimer);
    };
  }, [canRender, currentStep, onStepChange, stepIndex, variant]);

  useLayoutEffect(() => {
    if (!canRender) return;
    const update = () => {
      setPosition(
        calculateCardPosition(
          target?.getBoundingClientRect() ?? null,
          cardRef.current?.getBoundingClientRect() ?? null,
          currentStep.placement ?? "right",
        ),
      );
    };
    update();
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(update);
    if (target) observer?.observe(target);
    if (cardRef.current) observer?.observe(cardRef.current);
    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update, true);
    };
  }, [canRender, currentStep.placement, target]);

  const finish = useCallback(
    (outcome: "completed" | "skipped" | "dismissed") => {
      markProductTourComplete(getProductTourStorage());
      if (outcome === "completed") analytics.productTourCompleted(variant, steps.length);
      else if (outcome === "skipped") analytics.productTourSkipped(variant, stepIndex);
      else {
        analytics.productTourDismissed(variant, stepIndex);
        analytics.productTourAbandoned(variant, stepIndex);
      }
      onClose();
    },
    [onClose, stepIndex, steps.length, variant],
  );

  useEffect(() => {
    if (!canRender) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        finish("dismissed");
      } else if (event.key === "ArrowLeft" && stepIndex > 0) {
        event.preventDefault();
        setStepIndex((index) => index - 1);
      } else if (event.key === "ArrowRight") {
        event.preventDefault();
        if (stepIndex === steps.length - 1) finish("completed");
        else setStepIndex((index) => index + 1);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [canRender, finish, stepIndex, steps.length]);

  if (!canRender || !currentStep) return null;

  return (
    <div
      className="fixed inset-0 z-[99]"
      role="dialog"
      aria-modal="true"
      aria-labelledby="product-tour-title"
      aria-describedby="product-tour-body"
    >
      <Spotlight target={target?.getBoundingClientRect() ?? null} />
      <div
        ref={cardRef}
        className="fixed z-[102] w-[min(380px,calc(100vw-32px))] border border-border bg-background p-4 text-foreground shadow-2xl"
        style={{ left: position.left, top: position.top }}
      >
        <button
          type="button"
          onClick={() => finish("dismissed")}
          aria-label="Close tour"
          className="absolute right-3 top-3 text-muted-foreground hover:text-foreground"
        >
          ×
        </button>
        <div className="pr-6 text-[10px] font-medium uppercase tracking-wider text-oppulence-orange">
          {currentStep.eyebrow}
        </div>
        <h2 id="product-tour-title" className="mt-2 text-base font-semibold">
          {currentStep.title}
        </h2>
        <p
          id="product-tour-body"
          className="mt-2 whitespace-pre-line text-sm leading-5 text-muted-foreground"
        >
          {currentStep.body}
        </p>
        {targetMissing && (
          <div className="mt-3 border border-amber-500/30 bg-amber-500/5 p-2 text-xs text-amber-700 dark:text-amber-300">
            This surface is not available in the current view. Continue to the next step.
          </div>
        )}
        <div className="mt-4 grid grid-cols-9 gap-1" aria-label="Tour progress">
          {steps.map((item, index) => (
            <button
              key={item.target}
              type="button"
              aria-label={`Go to tour step ${index + 1}`}
              onClick={() => setStepIndex(index)}
              className={`h-1 ${index === stepIndex ? "bg-primary" : "bg-border"}`}
            />
          ))}
        </div>
        {variant === "main" && stepIndex === steps.length - 1 && onStartVariant ? (
          <div className="mt-4 border-t border-border pt-3">
            <div className="text-[11px] font-medium text-muted-foreground">
              Explore a focused tour
            </div>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {(["relationships", "meetings", "actions"] as const).map((nextVariant) => (
                <button
                  key={nextVariant}
                  type="button"
                  onClick={() => onStartVariant(nextVariant)}
                  className="border border-border px-2 py-1 text-[11px] capitalize hover:bg-accent"
                >
                  {nextVariant === "relationships"
                    ? "Mission control"
                    : nextVariant === "meetings"
                      ? "Meetings"
                      : "Actions"}
                </button>
              ))}
            </div>
          </div>
        ) : null}
        <div className="mt-4 flex items-center justify-between gap-2">
          <button
            type="button"
            onClick={() => finish("skipped")}
            className="text-xs text-muted-foreground hover:text-foreground"
          >
            Skip tour
          </button>
          <div className="flex items-center gap-2">
            <span className="text-[11px] text-muted-foreground">
              Step {stepIndex + 1} of {steps.length}
            </span>
            <button
              type="button"
              disabled={stepIndex === 0}
              onClick={() => setStepIndex((index) => index - 1)}
              className="inline-flex items-center gap-1 border border-border px-2.5 py-1.5 text-xs disabled:opacity-40"
            >
              <ArrowLeft className="size-3" /> Back
            </button>
            <button
              type="button"
              onClick={() =>
                stepIndex === steps.length - 1
                  ? finish("completed")
                  : setStepIndex((index) => index + 1)
              }
              className="inline-flex items-center gap-1 bg-primary px-2.5 py-1.5 text-xs text-primary-foreground"
            >
              {stepIndex === steps.length - 1 ? "Finish" : "Next"} <ArrowRight className="size-3" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
