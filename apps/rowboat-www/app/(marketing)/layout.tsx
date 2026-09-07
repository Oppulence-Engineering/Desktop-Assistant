import { DM_Mono, DM_Sans, Space_Grotesk } from "next/font/google";

import { MarketingLayout } from "./marketing-components";

const dmSans = DM_Sans({
  variable: "--font-marketing-sans",
  subsets: ["latin"],
  display: "swap",
});

const dmMono = DM_Mono({
  variable: "--font-marketing-mono",
  weight: ["400", "500"],
  subsets: ["latin"],
  display: "swap",
});

const spaceGrotesk = Space_Grotesk({
  variable: "--font-marketing-display",
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
    <div className={`${dmSans.variable} ${dmMono.variable} ${spaceGrotesk.variable}`}>
      <MarketingLayout>{children}</MarketingLayout>
    </div>
  );
}
