import Link from "next/link";

import { cn } from "@/lib/sim/cn";

import { footerGroups } from "../site";
import type { LinkItem } from "../marketing-data";
import { InlineLogo } from "../marketing-components";
import { SimFooterWordmark } from "./footer-wordmark";
import { SimThemeToggle } from "./theme-toggle";
import { LANDING_CONTENT_WIDTH, LANDING_GUTTER } from "./tokens";

const LINK_CLASS =
  "text-left text-sm text-[var(--text-secondary)] transition-colors hover:text-[var(--text-primary)]";

function SimFooterColumn({ title, items }: { title: string; items: LinkItem[] }) {
  return (
    <div>
      <h3 className="mb-4 text-sm text-[var(--text-primary)]">{title}</h3>
      <div className="flex flex-col gap-2.5">
        {items.map((item) =>
          item.external ? (
            <a
              className={LINK_CLASS}
              href={item.href}
              key={`${title}-${item.label}`}
              rel="noopener noreferrer"
              target="_blank"
            >
              {item.label}
            </a>
          ) : (
            <Link className={LINK_CLASS} href={item.href} key={`${title}-${item.label}`}>
              {item.label}
            </Link>
          ),
        )}
      </div>
    </div>
  );
}

/** Sim `Footer` grid with Oppulence link groups and no invented proof blocks. */
export function SimFooter() {
  return (
    <footer className="sim-landing-root w-full border-t border-[var(--border)] bg-[var(--bg)] text-[var(--text-primary)]">
      <div className={cn("pt-16 pb-6 max-sm:pb-5 max-lg:pt-12", LANDING_CONTENT_WIDTH, LANDING_GUTTER)}>
        <nav
          aria-label="Footer navigation"
          className="grid grid-cols-7 gap-x-8 gap-y-10 max-sm:grid-cols-2 max-sm:gap-y-8 max-lg:grid-cols-3"
          itemScope
          itemType="https://schema.org/SiteNavigationElement"
        >
          <div className="flex flex-col items-start gap-5 max-lg:col-span-full max-lg:mb-2">
            <Link aria-label="Oppulence home" className="flex h-[18px] items-center" href="/">
              <InlineLogo header />
            </Link>
            <SimThemeToggle />
          </div>

          {footerGroups.map((group) => (
            <SimFooterColumn items={group.items} key={group.title} title={group.title} />
          ))}
        </nav>

        <SimFooterWordmark />

        <p className="mt-16 text-sm text-[var(--text-secondary)]">
          © 2026 Playbook Media · Oppulence
        </p>
      </div>
    </footer>
  );
}
