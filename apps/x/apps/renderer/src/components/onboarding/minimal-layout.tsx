import type { CSSProperties, ReactNode } from "react";
import { motion } from "motion/react";
import { cn } from "@/lib/utils";
import { PRODUCT_NAME } from "@x/shared/dist/branding.js";

const DIAGRAM_BARS = [
  46, 56, 66, 74, 82, 88, 92, 96, 98, 100, 100, 98, 94, 90, 84, 76, 68, 58, 48,
];

interface MinimalOnboardingLayoutProps {
  title: ReactNode;
  description: ReactNode;
  chips?: string[];
  panelTitle: ReactNode;
  panelDescription?: ReactNode;
  footer?: ReactNode;
  children: ReactNode;
  panelSize?: "default" | "wide";
  panelAlign?: "center" | "start";
  presentation?: "page" | "dialog";
}

export function MinimalOnboardingLayout({
  title,
  description,
  chips = [],
  panelTitle,
  panelDescription,
  footer,
  children,
  panelSize = "default",
  panelAlign = "center",
  presentation = "page",
}: MinimalOnboardingLayoutProps) {
  return (
    <div
      data-presentation={presentation}
      className={cn(
        "onboarding-welcome-screen flex flex-1 flex-col overflow-hidden bg-[#09090b] text-white lg:flex-row",
        presentation === "dialog" ? "h-full min-h-0" : "min-h-full",
      )}
    >
      <section
        className={cn(
          "onboarding-welcome-hero relative flex flex-1 items-center justify-center overflow-hidden px-6",
          presentation === "dialog" ? "min-h-[320px] py-10 lg:min-h-0" : "min-h-[520px] py-14 lg:min-h-0",
        )}
      >
        <div className="absolute left-7 top-7 flex items-center gap-3">
          <span className="flex size-9 items-center justify-center border border-white/14 bg-white/[0.03]">
            <img src="/logo-only.png" alt="" className="size-5 invert" />
          </span>
          <span className="text-sm font-medium text-white/86">{PRODUCT_NAME}</span>
        </div>

        <WelcomeDiagram />

        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.08 }}
          className="relative z-[1] mx-auto max-w-[560px] text-center"
        >
          <h1 className="text-balance text-3xl font-semibold leading-[1.08] tracking-tight text-white sm:text-4xl">
            {title}
          </h1>
          <p className="mx-auto mt-5 max-w-[470px] font-mono text-[12px] leading-6 text-white/48">
            {description}
          </p>
          {chips.length > 0 && (
            <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
              {chips.map((chip) => (
                <span
                  key={chip}
                  className="border border-white/18 px-2 py-1 text-[11px] font-medium text-white/62"
                >
                  {chip}
                </span>
              ))}
            </div>
          )}
        </motion.div>
      </section>

      <aside
        className={cn(
          "onboarding-welcome-panel flex shrink-0 flex-col border-t border-white/8 bg-[#0d0d11] px-6 lg:border-l lg:border-t-0",
          panelAlign === "start" ? "justify-start py-7 lg:overflow-y-auto" : "justify-center py-10",
          panelSize === "wide" ? "lg:w-[460px] lg:px-8" : "lg:w-[390px] lg:px-10",
          presentation === "dialog" && "min-h-0 overflow-y-auto",
        )}
      >
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.16 }}
          className={cn(
            "mx-auto w-full",
            panelSize === "wide" ? "max-w-[380px]" : "max-w-[300px]",
          )}
        >
          <div className="mb-7">
            <h2 className="text-lg font-semibold tracking-tight text-white">{panelTitle}</h2>
            {panelDescription && (
              <p className="mt-2 text-sm leading-5 text-white/52">{panelDescription}</p>
            )}
          </div>

          {children}

          {footer && (
            <>
              <div className="my-5 flex items-center gap-3">
                <div className="h-px flex-1 bg-white/8" />
                <span className="text-[11px] text-white/28">or</span>
                <div className="h-px flex-1 bg-white/8" />
              </div>
              <div className="text-center text-xs leading-5 text-white/32">{footer}</div>
            </>
          )}
        </motion.div>
      </aside>
    </div>
  );
}

function WelcomeDiagram() {
  return (
    <div aria-hidden className="onboarding-welcome-diagram">
      <div className="onboarding-welcome-diagram__bars">
        {DIAGRAM_BARS.map((height, index) => (
          <span
            key={`${height}-${index}`}
            className="onboarding-welcome-diagram__bar"
            style={
              {
                "--welcome-bar-height": `${height}%`,
                "--welcome-bar-delay": `${index * -0.09}s`,
              } as CSSProperties
            }
          />
        ))}
      </div>
      <div className="onboarding-welcome-diagram__cutout" />
    </div>
  );
}
