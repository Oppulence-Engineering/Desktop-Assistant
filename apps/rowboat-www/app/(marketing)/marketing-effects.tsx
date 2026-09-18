"use client";

import { useEffect } from "react";

function getScrollPosition() {
  const scrollPort = document.querySelector<HTMLElement>(".sim-landing-scroll-port");
  if (scrollPort) return scrollPort.scrollTop;
  return window.scrollY;
}

export function MarketingEffects() {
  useEffect(() => {
    const root = document.documentElement;
    const scrollPort = document.querySelector<HTMLElement>(".sim-landing-scroll-port");
    const mobileMenu = document.querySelector<HTMLDetailsElement>("[data-marketing-mobile-menu]");
    const mobileMenuSummary = mobileMenu?.querySelector<HTMLElement>("summary");
    const mobileMenuLinks = mobileMenu?.querySelectorAll<HTMLAnchorElement>("a") ?? [];
    const desktopMedia = window.matchMedia("(min-width: 1024px)");
    const previousBodyOverflow = document.body.style.overflow;
    const previousScrollPortOverflow = scrollPort?.style.overflowY ?? "";

    const syncScrollState = () => {
      root.toggleAttribute("data-marketing-scrolled", getScrollPosition() > 8);
    };

    const syncMobileMenuState = () => {
      const isOpen = mobileMenu?.open ?? false;
      root.toggleAttribute("data-marketing-menu-open", isOpen);

      if (scrollPort) {
        scrollPort.style.overflowY = isOpen ? "hidden" : previousScrollPortOverflow;
        return;
      }

      document.body.style.overflow = isOpen ? "hidden" : previousBodyOverflow;
    };

    const closeMobileMenu = () => {
      if (mobileMenu) mobileMenu.open = false;
    };

    const handleDesktopMedia = (event: MediaQueryListEvent) => {
      if (event.matches) closeMobileMenu();
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;

      if (mobileMenu?.open) {
        closeMobileMenu();
        mobileMenuSummary?.focus();
        return;
      }

      const navItem = document.activeElement?.closest(".sm-nav-item");
      if (navItem instanceof HTMLElement) {
        (document.activeElement as HTMLElement | null)?.blur();
      }
    };

    // Scroll-reveal choreography. Gated behind a root attribute so the page
    // stays fully visible for no-JS visitors and reduced-motion users.
    const revealSelector = [
      ".linear-manifesto h2",
      ".linear-statement-title",
      ".linear-product-header",
      ".linear-product-visual",
      ".linear-update",
      ".linear-proof",
      ".linear-faq > header",
      ".linear-faq > div",
      ".linear-final-cta",
    ].join(", ");
    const revealTargets = Array.from(document.querySelectorAll<HTMLElement>(revealSelector));
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let revealObserver: IntersectionObserver | undefined;
    let revealFallback: number | undefined;

    if (!reduceMotion && revealTargets.length > 0 && "IntersectionObserver" in window) {
      root.setAttribute("data-marketing-reveals", "");
      revealObserver = new IntersectionObserver(
        (entries) => {
          entries.forEach((entry) => {
            if (entry.isIntersecting || entry.boundingClientRect.bottom < 0) {
              entry.target.classList.add("is-revealed");
              revealObserver?.unobserve(entry.target);
            }
          });
        },
        {
          root: scrollPort ?? undefined,
          rootMargin: "0px 0px -10% 0px",
          threshold: 0.1,
        },
      );
      revealTargets.forEach((element) => revealObserver?.observe(element));

      revealFallback = window.setTimeout(() => {
        revealTargets.forEach((element) => element.classList.add("is-revealed"));
        revealObserver?.disconnect();
      }, 4000);
    }

    syncScrollState();
    syncMobileMenuState();

    if (scrollPort) {
      scrollPort.addEventListener("scroll", syncScrollState, { passive: true });
    } else {
      window.addEventListener("scroll", syncScrollState, { passive: true });
    }

    window.addEventListener("keydown", handleKeyDown);
    desktopMedia.addEventListener("change", handleDesktopMedia);
    mobileMenu?.addEventListener("toggle", syncMobileMenuState);
    mobileMenuLinks.forEach((link) => link.addEventListener("click", closeMobileMenu));

    return () => {
      if (revealFallback !== undefined) window.clearTimeout(revealFallback);
      revealObserver?.disconnect();
      root.removeAttribute("data-marketing-reveals");
      if (scrollPort) {
        scrollPort.removeEventListener("scroll", syncScrollState);
        scrollPort.style.overflowY = previousScrollPortOverflow;
      } else {
        window.removeEventListener("scroll", syncScrollState);
      }
      window.removeEventListener("keydown", handleKeyDown);
      desktopMedia.removeEventListener("change", handleDesktopMedia);
      mobileMenu?.removeEventListener("toggle", syncMobileMenuState);
      mobileMenuLinks.forEach((link) => link.removeEventListener("click", closeMobileMenu));
      root.removeAttribute("data-marketing-scrolled");
      root.removeAttribute("data-marketing-menu-open");
      document.body.style.overflow = previousBodyOverflow;
    };
  }, []);

  return null;
}
