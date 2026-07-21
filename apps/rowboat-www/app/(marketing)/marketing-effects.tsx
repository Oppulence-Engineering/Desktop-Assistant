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
