import Link from "next/link";

import { cn } from "@/lib/sim/cn";

import { SimCtaLink } from "./primitives";
import { HOME_INSET, HOME_TYPE, LANDING_CONTENT_WIDTH, LANDING_GUTTER } from "./tokens";

const trustItems = [
  {
    title: "Security overview",
    href: "/security",
    body: "How local vault, sync, and connector tokens are handled.",
  },
  {
    title: "Responsible disclosure",
    href: "/responsible-disclosure",
    body: "Report a vulnerability through the published channel.",
  },
  {
    title: "Privacy",
    href: "/privacy",
    body: "What we collect when you sign in, and what can stay on the desktop.",
  },
] as const;

/**
 * Sim `Security` beat — split headline + honest trust links.
 * Cert blocs are replaced with the same card grid rhythm (`gap-6`, `px-8 pt-10 pb-10`)
 * but Oppulence copy and internal routes instead of SOC 2 marks.
 */
export function SimSecurity() {
  return (
    <section
      aria-labelledby="security-heading"
      className={cn("flex w-full flex-col", LANDING_CONTENT_WIDTH, LANDING_GUTTER)}
      id="security"
    >
      <div className={cn("flex flex-col gap-20 max-sm:gap-10 max-lg:gap-14", HOME_INSET)}>
        <div className="flex w-full items-start justify-between gap-10 max-sm:gap-5 max-xl:flex-col">
          <h2
            className={cn(
              "max-w-[16ch] text-balance text-[var(--text-primary)] md:w-1/2",
              HOME_TYPE.h2,
            )}
            id="security-heading"
          >
            Governance before anything leaves the building.
          </h2>
          <div className="flex w-[min(28rem,40%)] flex-col items-start max-xl:w-full">
            <p className={cn("max-w-[34ch] text-pretty text-[var(--text-body)]", HOME_TYPE.lead)}>
              Oppulence is built for teams who want a register with sources, approval on external
              writes, and clear docs about what stays local.
            </p>
            <SimCtaLink className="mt-5" href="/security" variant="outline">
              Security overview
            </SimCtaLink>
          </div>
        </div>

        <ul className="grid grid-cols-3 gap-6 max-sm:grid-cols-1 max-sm:gap-4">
          {trustItems.map((item) => (
            <li key={item.href}>
              <Link
                className={cn(
                  "group flex h-full flex-col items-start bg-[var(--surface-2)] px-8 pt-10 pb-10",
                  "rounded-[10px] border border-[var(--border)] max-sm:px-6 max-sm:pb-8",
                  "transition-[border-color] duration-200 ease-out hover-hover:hover:border-[var(--text-muted)] motion-reduce:transition-none",
                  "focus-visible:outline focus-visible:outline-1 focus-visible:outline-[var(--text-primary)] focus-visible:outline-offset-4",
                )}
                href={item.href}
              >
                <span className="text-[18px] text-[var(--text-primary)] leading-[1.3]">
                  {item.title}
                </span>
                <span className="mt-2 max-w-[32ch] text-[15px] text-[var(--text-secondary)] leading-[1.45]">
                  {item.body}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
