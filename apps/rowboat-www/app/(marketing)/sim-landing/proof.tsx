import {
  BriefcaseIcon,
  CalendarDotsIcon,
  ChartLineIcon,
  EnvelopeIcon,
  HeadsetIcon,
} from "@/lib/icons";

import { cn } from "@/lib/sim/cn";

import { HOME_INSET, LANDING_CONTENT_WIDTH, LANDING_GUTTER } from "./tokens";

const sources = [
  { label: "Gmail", icon: EnvelopeIcon },
  { label: "Calendar", icon: CalendarDotsIcon },
  { label: "Slack", icon: HeadsetIcon },
  { label: "HubSpot", icon: BriefcaseIcon },
  { label: "Meetings", icon: ChartLineIcon },
] as const;

/** Sim `Proof` — connector row in the homepage inset. */
export function SimProof() {
  return (
    <section
      aria-label="Connected sources"
      className={cn(LANDING_CONTENT_WIDTH, LANDING_GUTTER)}
      id="proof"
    >
      <div className={cn(HOME_INSET, "flex justify-center")}>
        <div className="flex flex-wrap items-center justify-center gap-x-10 gap-y-4 text-[var(--text-secondary)] max-sm:gap-x-6">
          {sources.map((source) => {
            const Icon = source.icon;
            return (
              <div
                className="inline-flex items-center gap-2 text-[14px] font-medium tracking-[-0.01em]"
                key={source.label}
              >
                <Icon aria-hidden="true" className="size-4 opacity-70" />
                {source.label}
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
