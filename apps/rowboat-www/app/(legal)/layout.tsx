import { Inter } from "next/font/google";

import { LegalLayoutClient } from "./legal-layout-client";

import "@/app/(marketing)/marketing-sim-theme.css";

const inter = Inter({
  variable: "--font-marketing-sans",
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  display: "swap",
});

export const viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#ffffff" },
    { media: "(prefers-color-scheme: dark)", color: "#111111" },
  ],
};

export default function LegalLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className={inter.variable}>
      <LegalLayoutClient>{children}</LegalLayoutClient>
    </div>
  );
}
