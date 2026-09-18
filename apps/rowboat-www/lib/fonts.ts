import { Geist, Geist_Mono, Inter } from "next/font/google";
import localFont from "next/font/local";

import { cn } from "@/lib/utils";

/**
 * Root font variables loaded once in `app/layout.tsx`.
 *
 * Route groups (marketing, auth) may add scoped display/body stacks on their
 * own wrappers; product and dashboard code read these defaults via CSS tokens.
 */
const fontSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
  display: "swap",
});

const fontMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
  display: "swap",
});

const fontInter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
  weight: ["400", "500"],
  display: "swap",
});

const fontDisplay = localFont({
  src: [
    {
      path: "../public/fonts/F37Stout-Regular.woff2",
      weight: "400",
      style: "normal",
    },
  ],
  variable: "--font-f37-stout",
  display: "swap",
});

export const fontVariables = cn(
  fontSans.variable,
  fontMono.variable,
  fontInter.variable,
  fontDisplay.variable,
);
