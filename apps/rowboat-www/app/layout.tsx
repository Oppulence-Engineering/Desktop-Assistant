import type { Metadata, Viewport } from "next";
import Script from "next/script";
import type { ReactNode } from "react";

import { AppProviders } from "@/components/providers/app-providers";
import { isDevelopment } from "@/lib/environment";
import { fontVariables } from "@/lib/fonts";
import { createMetadata } from "@/lib/metadata";
import { cn } from "@/lib/utils";

import "./globals.css";
import "./product-theme.css";
import { Geist } from "next/font/google";

const geist = Geist({ subsets: ["latin"], variable: "--font-sans" });

export const metadata: Metadata = createMetadata({
  title: {
    template: "%s | Oppulence",
    default: "Oppulence — The Commitment Ledger",
  },
  description:
    "Oppulence is the independent record of business promises: what you owe, what they owe, what changed, and the proof behind it.",
});

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#ffffff" },
    { media: "(prefers-color-scheme: dark)", color: "#111111" },
  ],
};

// Cache Components still validates every segment for instant navigation.
// The dashboard and marketing shells are client-heavy; a dropped segment
// was surfacing as a hard "/app" or "/" crash overlay. Opt the tree out
// so a missing prerender shell is not reported as a runtime crash.
export const instant = false;

/**
 * Dev tooling from the react-grab / react-scan ecosystem (Aiden Bai):
 * - React Scan highlights slow or unnecessary re-renders in the component tree.
 * - React Grab copies selected component source context into coding agents.
 *
 * Both load from unpkg in development only. React Scan must run before React
 * hydrates, so its script tag comes first among third-party bundles.
 */
const reactGrabOptions = {
  activationKey: " ",
  activationMode: "toggle",
  allowActivationInsideInput: false,
  maxContextLines: 3,
} as const;

/** Keep theme-color in sync with next-themes before hydration paints the shell. */
const themeColorScript = `
try {
  var meta = document.querySelector('meta[name="theme-color"]');
  if (!meta) return;
  var prefersDark =
    localStorage.theme === "dark" ||
    ((!('theme' in localStorage) || localStorage.theme === "system") &&
      window.matchMedia("(prefers-color-scheme: dark)").matches);
  meta.setAttribute("content", prefersDark ? "#111111" : "#ffffff");
} catch (_) {}
`;

export default function RootLayout({ children }: { children: ReactNode }) {
  const devToolsEnabled = isDevelopment();

  return (
    <html
      lang="en"
      className={cn(fontVariables, "antialiased", "font-sans", geist.variable)}
      suppressHydrationWarning
      data-scroll-behavior="smooth"
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeColorScript }} />
        {devToolsEnabled ? (
          <Script
            src="//unpkg.com/react-scan@0.5.7/dist/auto.global.js"
            crossOrigin="anonymous"
            strategy="beforeInteractive"
          />
        ) : null}
        <Script src="/config.js" strategy="beforeInteractive" />
        {devToolsEnabled ? (
          <>
            <Script
              src="//unpkg.com/react-grab/dist/index.global.js"
              crossOrigin="anonymous"
              strategy="beforeInteractive"
              data-options={JSON.stringify(reactGrabOptions)}
            />
            <Script src="//unpkg.com/@react-grab/mcp/dist/client.global.js" strategy="lazyOnload" />
          </>
        ) : null}
      </head>
      <body suppressHydrationWarning>
        <AppProviders devToolsEnabled={devToolsEnabled}>
          <div className="relative min-h-dvh">{children}</div>
        </AppProviders>
      </body>
    </html>
  );
}
