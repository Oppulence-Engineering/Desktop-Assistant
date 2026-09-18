/**
 * Layout tokens ported from sim.ai `apps/sim/app/(landing)/components/landing-layout.ts`.
 * Tailwind class strings are kept verbatim so section geometry matches Sim 1:1.
 */
export const LANDING_CONTENT_WIDTH = "mx-auto w-full max-w-[1728px]";
export const LANDING_GUTTER = "px-10 max-md:px-7 max-lg:px-8 max-xl:px-9";
export const LANDING_HERO_TOP_PADDING = "pt-[112px] max-sm:pt-12 max-xl:pt-20";
export const LANDING_SECTION_RHYTHM = "gap-[120px] max-sm:gap-16 max-lg:gap-[88px]";
export const HOME_SECTION_RHYTHM = "gap-36 max-sm:gap-20 max-lg:gap-24";
export const HOME_INSET = "w-full lg:mx-auto lg:w-[83.333%]";
export const LANDING_WINDOW_SHADOW =
  "shadow-[0_0_0_1px_rgba(0,0,0,0.08),0_2px_6px_0_rgba(0,0,0,0.05),0_4px_42px_0_rgba(0,0,0,0.06)]";
export const LANDING_STAGE_RADIUS = "rounded-[12px]";
export const LANDING_STAGE_WINDOW_RADIUS = "rounded-[8px]";
export const LANDING_HERO_CTA_GAP = "mt-3";

export const LANDING_TYPE = {
  h1: "text-[76px] leading-[1.0] tracking-[-0.03em] max-sm:text-[38px] max-xl:text-[56px]",
  proof: "text-[40px] leading-[1.1] tracking-[-0.02em] max-sm:text-[28px] max-xl:text-[34px]",
  lead: "text-[20px] leading-[1.4] max-sm:text-[17px]",
  body: "text-[16px] leading-[1.45]",
  meta: "text-[14px] leading-[1.4]",
} as const;

export const HOME_TYPE = {
  h1: "text-[80px] leading-[0.96] tracking-[-0.025em] max-sm:text-[42px] max-xl:text-[64px]",
  h2Display: "text-[64px] leading-[1.05] tracking-[-0.025em] max-sm:text-[36px] max-xl:text-[48px]",
  h2: LANDING_TYPE.proof,
  h3: "text-[32px] leading-[1.15] tracking-[-0.015em] max-sm:text-[24px]",
  lead: LANDING_TYPE.lead,
  body: LANDING_TYPE.body,
  meta: LANDING_TYPE.meta,
} as const;
