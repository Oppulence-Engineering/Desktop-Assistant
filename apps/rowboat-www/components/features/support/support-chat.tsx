"use client";

import "client-only";

import { useEffect } from "react";

import { loadSupportChatConfig } from "@/lib/api/support/chat";
import { cn } from "@/lib/utils";

/**
 * Plain chat widget loader.
 *
 * Mounts once per layout and boots Plain's chat script with the config served
 * by /api/support/chat. Signed-in users are identified via a server-minted
 * email hash; anonymous visitors chat as anonymous customers and Plain's own
 * verification flow identifies them if a thread is created.
 *
 * The widget is deliberately additive: if the workspace has no chat app
 * configured, or the script fails to load, nothing renders and no error
 * surfaces to the user. Support chat must never break a marketing page.
 */

const SCRIPT_SRC = "https://chat.cdn-plain.com/index.js";
const SCRIPT_ID = "plain-chat";

interface PlainAPI {
  init: (options: Record<string, unknown>) => void;
  isInitialized?: () => boolean;
  setCustomerDetails?: (details: Record<string, unknown>) => void;
}

declare global {
  interface Window {
    Plain?: PlainAPI;
  }
}

/** Loads Plain's script once, reusing the tag across mounts and route changes. */
function loadScript(): Promise<void> {
  const existing = document.getElementById(SCRIPT_ID) as HTMLScriptElement | null;
  if (existing) {
    if (existing.dataset.loaded === "true") return Promise.resolve();
    return new Promise((resolve, reject) => {
      existing.addEventListener("load", () => resolve(), { once: true });
      existing.addEventListener("error", () => reject(new Error("plain chat failed")), {
        once: true,
      });
    });
  }
  return new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.id = SCRIPT_ID;
    script.src = SCRIPT_SRC;
    script.async = true;
    script.addEventListener(
      "load",
      () => {
        script.dataset.loaded = "true";
        resolve();
      },
      { once: true },
    );
    script.addEventListener("error", () => reject(new Error("plain chat failed")), { once: true });
    document.head.appendChild(script);
  });
}

export interface SupportChatProps extends React.ComponentProps<"div"> {
  /**
   * Theme passed to Plain. The marketing site is dark-on-black while the
   * product follows the user's system preference, so each layout states its
   * own rather than inheriting a wrong default.
   */
  theme?: "auto" | "light" | "dark";
}

export function SupportChat({ theme = "auto", className, ...props }: SupportChatProps) {
  useEffect(() => {
    let cancelled = false;

    async function boot() {
      const config = await loadSupportChatConfig();
      if (cancelled || !config.configured || !config.appId) return;

      await loadScript();
      if (cancelled) return;

      const plain = window.Plain;
      if (!plain) return;

      const customerDetails = config.customer
        ? { email: config.customer.email, emailHash: config.customer.emailHash }
        : undefined;

      // Plain.init throws if called twice (e.g. a client-side navigation
      // between the marketing and product layouts). Update the identity in
      // place instead, so a user who signs in mid-session stops being anonymous
      // without a page reload.
      if (plain.isInitialized?.()) {
        if (customerDetails) plain.setCustomerDetails?.(customerDetails);
        return;
      }

      plain.init({
        appId: config.appId,
        theme,
        ...(customerDetails ? { customerDetails } : {}),
        // Applies to every thread this widget opens, so Oppulence chats are
        // distinguishable from the other brands in the shared Plain workspace.
        ...(config.labelTypeIds?.length
          ? { threadDetails: { labelTypeIds: config.labelTypeIds } }
          : {}),
        links: [
          { icon: "book", text: "Read the docs", url: "https://docs.oppulence.io" },
          {
            icon: "bug",
            text: "Report an issue on GitHub",
            url: "https://github.com/Oppulence-Engineering/Desktop-Assistant/issues/new",
          },
          { icon: "email", text: "Email us", url: "mailto:hello@oppulence.io" },
        ],
      });
    }

    boot().catch(() => {
      // Support chat is additive; a failure here must not surface to the user.
    });

    return () => {
      cancelled = true;
    };
  }, [theme]);

  // Plain renders its own launcher into the document, so this component has no
  // visual output of its own. The hidden marker keeps a stable, addressable
  // root for tests and debugging without affecting layout or the a11y tree.
  return (
    <div aria-hidden className={cn("hidden", className)} data-slot="support-chat" {...props} />
  );
}
