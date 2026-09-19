import { ArrowRight as ArrowRightIcon } from "@/lib/icons";
import Image from "next/image";
import Link from "next/link";

import { Badge } from "@oppulence/ui/components/badge";

import { MarketingSpan, marketingSpanClass } from "./marketing-primitives";
import { headerNav } from "./site";
import { cn } from "@/lib/utils";

/**
 * Header/footer marks used by the Sim shell.
 *
 * Kept out of marketing-components so the landing shell can render a logo
 * without importing the layout that mounts that shell.
 */
const mobileNavLinks = [
  { label: "Products", href: "/products" },
  { label: "Features", href: "/features" },
  { label: "Use cases", href: "/use-cases" },
  { label: "How it works", href: "/product" },
  { label: "Pricing", href: "/pricing" },
  { label: "Download", href: "/download" },
  { label: "Resources", href: "/resources" },
  { label: "Security", href: "/security" },
];

export function InlineLogo({
  compact = false,
  header = false,
  prominent = false,
}: {
  compact?: boolean;
  header?: boolean;
  prominent?: boolean;
}) {
  // The header mark is rendered at its box size now that the lockup no longer
  // crops an oversized image down to a narrow window.
  const iconSize = header ? 20 : compact ? 20 : prominent ? 40 : 28;

  return (
    <Badge
      className={cn(
        header ? "oppulence-compact-lockup" : "flex items-center gap-2",
        marketingSpanClass,
      )}
      variant="ghost"
    >
      {header ? (
        <Badge
          aria-hidden="true"
          className={cn("oppulence-compact-lockup__mark", marketingSpanClass)}
          variant="ghost"
        >
          <Image
            alt=""
            className="oppulence-compact-lockup__mark-image"
            height={iconSize}
            src="/marketing/oppulence-icon.png"
            width={iconSize}
          />
        </Badge>
      ) : (
        <Image
          alt=""
          className={cn("rounded-[3px]", compact ? "size-5" : prominent ? "size-10" : "size-7")}
          height={iconSize}
          src="/marketing/oppulence-icon.png"
          width={iconSize}
        />
      )}
      {!compact ? (
        <MarketingSpan
          className={cn(
            header
              ? "oppulence-compact-lockup__wordmark"
              : "font-display text-[24px] leading-6 font-medium text-primary",
          )}
        >
          {header ? "Oppulence" : "oppulence"}
        </MarketingSpan>
      ) : null}
    </Badge>
  );
}

export function MobileMenu() {
  return (
    <details className="relative lg:hidden" data-marketing-mobile-menu>
      <summary aria-label="Toggle navigation" className="linear-mobile-summary">
        <Badge className={marketingSpanClass} variant="ghost" />
        <Badge className={marketingSpanClass} variant="ghost" />
      </summary>
      <nav className="linear-mobile-panel sm-mobile-panel">
        {mobileNavLinks.map((item) => (
          <Link href={item.href} key={`${item.label}-${item.href}`}>
            {item.label}
          </Link>
        ))}
        {headerNav.map((group) => (
          <div key={group.label}>
            <p className="sm-mobile-kicker">{group.label}</p>
            {group.items.slice(0, 6).map((item) => (
              <Link className="sm-mobile-product" href={item.href} key={item.href}>
                {item.label}
              </Link>
            ))}
          </div>
        ))}
        <div className="mt-auto grid gap-2 pt-8">
          <Link className="sm-button sm-button-light" href="/sign-in">
            Sign in
          </Link>
          <Link className="sm-button sm-button-blue" href="/sign-up">
            Start for free <ArrowRightIcon aria-hidden="true" />
          </Link>
        </div>
      </nav>
    </details>
  );
}
