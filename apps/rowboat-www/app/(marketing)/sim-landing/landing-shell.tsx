import Link from "next/link";
import type { ReactNode } from "react";

import { cn } from "@/lib/sim/cn";

import { SimClosingCta } from "./closing-cta";
import { SimFooter } from "./sim-footer";
import { SimTopBar } from "./top-bar";
import { HOME_SECTION_RHYTHM } from "./tokens";

type SimLandingShellVariant = "home" | "subpage";

type SimLandingShellProps = {
  children: ReactNode;
  /** Home keeps section rhythm; subpages wrap legacy linear content. */
  variant?: SimLandingShellVariant;
  /** Legal and other long-form pages skip the painted pre-footer CTA. */
  showClosingCta?: boolean;
};

/**
 * Sim `LandingShell` scroll port for all Oppulence marketing routes.
 *
 * The internal scroll container keeps sticky header math and footer artwork
 * contained the way sim.ai does, instead of relying on document scroll.
 */
export function SimLandingShell({
  children,
  variant = "subpage",
  showClosingCta = true,
}: SimLandingShellProps) {
  const isHome = variant === "home";

  return (
    <div className="sim-landing-scroll-port sim-landing-root relative h-full min-h-0 flex-1 overflow-y-auto overscroll-y-none bg-[var(--bg)] text-[var(--text-primary)] [--text-muted:var(--text-secondary)]">
      <div aria-hidden="true" className="sim-landing-scroll-sentinel -mb-px h-px" />
      <Link className="linear-skip-link" href="#main-content">
        Skip to content →
      </Link>
      <SimTopBar />
      <main
        className={cn("flex flex-col", isHome ? HOME_SECTION_RHYTHM : "sim-marketing-page-main")}
        id="main-content"
      >
        {isHome ? children : <div className="linear-shell linear-guides">{children}</div>}
      </main>
      <div className="pt-36 max-sm:pt-20 max-lg:pt-24">
        {showClosingCta ? <SimClosingCta /> : null}
        <SimFooter />
      </div>
    </div>
  );
}
