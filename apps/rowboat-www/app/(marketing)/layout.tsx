import { DM_Mono, Inter } from "next/font/google";

import { SupportChat } from "@/components/features/support/support-chat";

import { MarketingLayout } from "./marketing-components";

const inter = Inter({
  variable: "--font-marketing-sans",
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  display: "swap",
});

const dmMono = DM_Mono({
  variable: "--font-marketing-mono",
  weight: ["400", "500"],
  subsets: ["latin"],
  display: "swap",
});

export const viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#000000",
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <div className={`${inter.variable} ${dmMono.variable}`}>
      <MarketingLayout>{children}</MarketingLayout>
      {/* The public site is dark-on-black, so the widget is pinned dark
          rather than following the visitor's system preference. */}
      <SupportChat theme="dark" />
    </div>
  );
}
