import Link from "next/link";

import { cn } from "@/lib/sim/cn";

import { SimChevronArrow } from "../chevron-arrow";
import {
  SimBorderedColumn,
  SimPageDivider,
  SimPageFooterRule,
  SimSubpageHero,
} from "./sim-subpage-hero";
import { LANDING_CONTENT_WIDTH, LANDING_GUTTER } from "../tokens";
import type { SimCatalogHubItem } from "./sim-catalog-hub";

const extraLinks: SimCatalogHubItem[] = [
  {
    href: "/changelog",
    title: "Changelog",
    body: "Desktop releases from GitHub. No invented version numbers.",
  },
  {
    href: "/security",
    title: "Security",
    body: "What stays on the machine, what syncs, what waits for approval.",
  },
  {
    href: "/integrations",
    title: "Integrations",
    body: "Gmail, Calendar, Slack, HubSpot, MCP.",
  },
  {
    href: "/blog",
    title: "Blog",
    body: "Editorial notes from the product. Categories: product, workflow, security, install.",
  },
  {
    href: "/customers",
    title: "Customers",
    body: "A published-story index. Empty until a real write-up is approved.",
  },
  {
    href: "/compare",
    title: "Compare",
    body: "CRM, inbox, meeting notes, and generic assistants — only the seams we can defend.",
  },
  {
    href: "/answers",
    title: "Answer hub",
    body: "Definitions for leftover search URLs. Help-center queries stay answered.",
  },
];

function SimCatalogRows({ items }: { items: SimCatalogHubItem[] }) {
  return (
    <div>
      {items.map((item) => (
        <div key={item.href}>
          <Link
            aria-label={item.title}
            className="group/link flex items-center gap-4 px-6 py-4 transition-colors hover-hover:bg-[var(--surface-hover)]"
            href={item.href}
          >
            <div className="flex min-w-0 flex-1 flex-col gap-0.5">
              <h3 className="text-[var(--text-primary)] text-sm leading-snug tracking-[-0.02em]">
                {item.title}
              </h3>
              <p className="hidden text-[var(--text-muted)] text-[12px] leading-[150%] sm:line-clamp-1">
                {item.body}
              </p>
            </div>
            <SimChevronArrow />
          </Link>
          <div className="h-px w-full bg-[var(--border)]" />
        </div>
      ))}
    </div>
  );
}

/** Sim resources hub — guides plus the rest of the public site. */
export function SimResourcesPage({
  description,
  heading,
  guideItems,
}: {
  description: string;
  heading: string;
  guideItems: SimCatalogHubItem[];
}) {
  const items = [...guideItems, ...extraLinks];

  return (
    <div className="bg-[var(--bg)] pb-16 max-sm:pb-12">
      <div className={cn(LANDING_CONTENT_WIDTH, LANDING_GUTTER)}>
        <div aria-hidden="true" className="mb-6 h-6" />
        <SimSubpageHero description={description} eyebrow="[resources]" title={heading} titleId="resources-heading" />
      </div>

      <SimPageDivider />

      <SimBorderedColumn>
        <section aria-labelledby="resources-list-heading" className="pt-10">
          <h2
            className="mb-4 px-6 text-[20px] text-[var(--text-primary)] leading-[100%] tracking-[-0.02em] lg:text-[24px]"
            id="resources-list-heading"
          >
            Guides and public pages
          </h2>
          <SimCatalogRows items={items} />
        </section>

        <div className="h-px w-full bg-[var(--border)]" />

        <section className="px-6 py-10">
          <p className="max-w-[720px] text-[14px] text-[var(--text-muted)] leading-[1.55]">
            Documentation for the API lives at{" "}
            <Link className="text-[var(--text-body)] underline-offset-4 hover:underline" href="https://docs.oppulence.io">
              docs.oppulence.io
            </Link>
            . We are not building a second docs tree here.
          </p>
        </section>
      </SimBorderedColumn>

      <SimPageFooterRule />
    </div>
  );
}
