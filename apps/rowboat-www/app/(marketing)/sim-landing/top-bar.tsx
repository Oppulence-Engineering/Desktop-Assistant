import Link from "next/link";

import { cn } from "@/lib/sim/cn";

import { InlineLogo, MobileMenu } from "../marketing-chrome";
import { MarketingSpan, marketingSpanClass } from "../marketing-primitives";
import { headerNav, headerUtilityLinks } from "../site";
import { SimCtaLink } from "./primitives";
import { LANDING_CONTENT_WIDTH, LANDING_GUTTER } from "./tokens";

const NAV_CHIP =
  "inline-flex min-h-[26px] items-center rounded-full px-3 text-[13px] text-[var(--text-body)] transition-colors duration-150 hover:bg-[var(--surface-3)] hover:text-[var(--text-primary)]";

const AUTH_SEGMENT =
  "relative inline-flex min-w-0 items-center justify-center whitespace-nowrap text-[var(--text-body)] transition-colors duration-150 hover:bg-[var(--surface-3)] hover:text-[var(--text-primary)] focus-visible:z-10 focus-visible:outline focus-visible:outline-1 focus-visible:outline-[var(--text-primary)] focus-visible:outline-offset-[-3px]";

/**
 * Sim `Navbar` geometry with Oppulence navigation content.
 * Centered product links, divided auth pill, and compact primary CTA.
 */
export function SimTopBar() {
  return (
    <header className="sim-landing-header sm-header relative sticky top-0 z-50">
      <nav
        aria-label="Primary navigation"
        className={cn(
          "relative flex items-center justify-between py-4",
          LANDING_CONTENT_WIDTH,
          LANDING_GUTTER,
        )}
        itemScope
        itemType="https://schema.org/SiteNavigationElement"
      >
        <Link
          aria-label="Oppulence home"
          className="relative z-10 flex h-[30px] shrink-0 items-center"
          href="/"
          itemProp="url"
        >
          <span className="sr-only" itemProp="name">
            Oppulence
          </span>
          <InlineLogo header />
        </Link>

        <div className="absolute inset-x-0 hidden items-center justify-center gap-1 xl:flex">
          {headerNav.map((group) =>
            group.href ? (
              <Link className={NAV_CHIP} href={group.href} itemProp="url" key={group.label}>
                {group.label}
              </Link>
            ) : (
              <div className="sm-nav-item" key={group.label}>
                <span className={cn(NAV_CHIP, "cursor-default")}>{group.label}</span>
                <div
                  aria-label={group.label}
                  className={cn("sm-nav-panel", group.items.length > 6 && "is-wide")}
                  role="group"
                >
                  <div className="sm-nav-panel-card">
                    {group.items.map((item) => (
                      <Link href={item.href} key={item.href}>
                        <MarketingSpan>{item.label}</MarketingSpan>
                        {item.description ? <small>{item.description}</small> : null}
                      </Link>
                    ))}
                  </div>
                </div>
              </div>
            ),
          )}
          {headerUtilityLinks.map((item) => (
            <Link className={NAV_CHIP} href={item.href} itemProp="url" key={item.href}>
              {item.label}
            </Link>
          ))}
        </div>

        <div className="relative z-10 hidden shrink-0 items-center gap-2 xl:flex">
          <div
            aria-label="Account actions"
            className="inline-flex h-[26px] shrink-0 items-stretch rounded-full border border-[var(--border)] text-[13px]"
            role="group"
          >
            <Link className={cn(AUTH_SEGMENT, "rounded-l-full px-3")} href="/sign-in">
              Sign in
            </Link>
            <span aria-hidden="true" className="w-px shrink-0 self-center bg-[var(--border)]" />
            <Link className={cn(AUTH_SEGMENT, "rounded-r-full px-3")} href="/sign-up">
              Start for free
            </Link>
          </div>
          <SimCtaLink href="/product" size="compact">
            See how it works
          </SimCtaLink>
        </div>

        <div className="relative z-10 flex flex-1 items-center justify-end xl:hidden">
          <Link
            className={cn("sm-login hidden md:inline-flex", marketingSpanClass)}
            href="/sign-in"
          >
            Sign in
          </Link>
          <Link className="sm-header-cta hidden md:inline-flex" href="/sign-up">
            Start for free
          </Link>
          <MobileMenu />
        </div>
      </nav>
    </header>
  );
}
