import { DM_Mono, Geist, Geist_Mono, Inter } from "next/font/google";
import localFont from "next/font/local";

import { cn } from "@/lib/utils";

/**
 * Root font variables loaded once in `app/layout.tsx`.
 *
 * Marketing and auth add the shared mono stack from this module; product
 * and dashboard code read the root defaults via CSS tokens.
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
  weight: ["400", "500", "600"],
  display: "swap",
});

/**
 * Shared public-site stacks. Instantiated once so marketing, legal, and auth
 * do not each download their own next/font copy of the same family.
 */
const marketingMono = DM_Mono({
  variable: "--font-marketing-mono",
  weight: ["400", "500"],
  subsets: ["latin"],
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

export const marketingFontVariables = marketingMono.variable;
