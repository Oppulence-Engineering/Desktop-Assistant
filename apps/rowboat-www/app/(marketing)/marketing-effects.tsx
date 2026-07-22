"use client";

import { useEffect } from "react";

export function MarketingEffects() {
  useEffect(() => {
    const root = document.documentElement;
    const mobileMenu = document.querySelector<HTMLDetailsElement>("[data-marketing-mobile-menu]");
    const mobileMenuSummary = mobileMenu?.querySelector<HTMLElement>("summary");
    const mobileMenuLinks = mobileMenu?.querySelectorAll<HTMLAnchorElement>("a") ?? [];
    const desktopMedia = window.matchMedia("(min-width: 1024px)");
    const previousBodyOverflow = document.body.style.overflow;
    const desktopDropdowns = Array.from(
      document.querySelectorAll<HTMLDetailsElement>("[data-marketing-dropdown]"),
    );

    const syncScrollState = () => {
      root.toggleAttribute("data-marketing-scrolled", window.scrollY > 8);
    };

    const syncMobileMenuState = () => {
      const isOpen = mobileMenu?.open ?? false;
      root.toggleAttribute("data-marketing-menu-open", isOpen);
      document.body.style.overflow = isOpen ? "hidden" : previousBodyOverflow;
    };

    const closeMobileMenu = () => {
      if (mobileMenu) mobileMenu.open = false;
    };

    const handleDesktopMedia = (event: MediaQueryListEvent) => {
      if (event.matches) closeMobileMenu();
    };

    const closeDesktopDropdowns = (except?: HTMLDetailsElement) => {
      desktopDropdowns.forEach((dropdown) => {
        if (dropdown !== except) dropdown.open = false;
      });
    };

    const handleDropdownToggle = (event: Event) => {
      const dropdown = event.currentTarget as HTMLDetailsElement;
      if (dropdown.open) closeDesktopDropdowns(dropdown);
    };

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (!desktopDropdowns.some((dropdown) => dropdown.contains(target))) {
        closeDesktopDropdowns();
      }
    };

    const handleDropdownLinkClick = () => {
      closeDesktopDropdowns();
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;

      if (mobileMenu?.open) {
        closeMobileMenu();
        mobileMenuSummary?.focus();
        return;
      }

      const openDropdown = desktopDropdowns.find((dropdown) => dropdown.open);
      if (openDropdown) {
        openDropdown.open = false;
        openDropdown.querySelector<HTMLElement>("summary")?.focus();
      }
    };

    // Scroll-reveal choreography. Gated behind a root attribute so the page
    // stays fully visible for no-JS visitors and reduced-motion users.
    const revealSelector = [
      ".linear-statement-title",
      ".linear-benefit",
      ".linear-product-header",
      ".linear-product-visual",
      ".linear-update",
      ".linear-capabilities > header",
      ".linear-capabilities > div > div",
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
      const siblingIndex = new Map<Element, number>();
      revealTargets.forEach((element) => {
        const parent = element.parentElement;
        const index = parent ? (siblingIndex.get(parent) ?? 0) : 0;
        if (parent) siblingIndex.set(parent, index + 1);
        element.style.setProperty("--reveal-delay", `${Math.min(index, 5) * 70}ms`);
      });
      root.setAttribute("data-marketing-reveals", "");
      revealObserver = new IntersectionObserver(
        (entries) => {
          entries.forEach((entry) => {
            // Reveal on intersection; also reveal anything already scrolled
            // past so deep links never land on blank sections.
            if (entry.isIntersecting || entry.boundingClientRect.bottom < 0) {
              entry.target.classList.add("is-revealed");
              revealObserver?.unobserve(entry.target);
            }
          });
        },
        { rootMargin: "0px 0px -10% 0px", threshold: 0.1 },
      );
      revealTargets.forEach((element) => revealObserver?.observe(element));

      // Safety net: if observer callbacks never arrive (headless capture,
      // print, embedded webviews), reveal everything after a beat so no
      // section can stay invisible.
      revealFallback = window.setTimeout(() => {
        revealTargets.forEach((element) => element.classList.add("is-revealed"));
        revealObserver?.disconnect();
      }, 4000);
    }

    syncScrollState();
    syncMobileMenuState();
    window.addEventListener("scroll", syncScrollState, { passive: true });
    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("pointerdown", handlePointerDown);
    desktopMedia.addEventListener("change", handleDesktopMedia);
    mobileMenu?.addEventListener("toggle", syncMobileMenuState);
    mobileMenuLinks.forEach((link) => link.addEventListener("click", closeMobileMenu));
    desktopDropdowns.forEach((dropdown) => {
      dropdown.addEventListener("toggle", handleDropdownToggle);
      dropdown
        .querySelectorAll<HTMLAnchorElement>("a")
        .forEach((link) => link.addEventListener("click", handleDropdownLinkClick));
    });

    return () => {
      if (revealFallback !== undefined) window.clearTimeout(revealFallback);
      revealObserver?.disconnect();
      root.removeAttribute("data-marketing-reveals");
      window.removeEventListener("scroll", syncScrollState);
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("pointerdown", handlePointerDown);
      desktopMedia.removeEventListener("change", handleDesktopMedia);
      mobileMenu?.removeEventListener("toggle", syncMobileMenuState);
      mobileMenuLinks.forEach((link) => link.removeEventListener("click", closeMobileMenu));
      desktopDropdowns.forEach((dropdown) => {
        dropdown.removeEventListener("toggle", handleDropdownToggle);
        dropdown
          .querySelectorAll<HTMLAnchorElement>("a")
          .forEach((link) => link.removeEventListener("click", handleDropdownLinkClick));
        dropdown.open = false;
      });
      root.removeAttribute("data-marketing-scrolled");
      root.removeAttribute("data-marketing-menu-open");
      document.body.style.overflow = previousBodyOverflow;
    };
  }, []);

  return null;
}
