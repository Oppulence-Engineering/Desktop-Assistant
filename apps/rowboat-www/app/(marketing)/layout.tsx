import { Inter } from "next/font/google";

import { MarketingLayout } from "./marketing-components";

const inter = Inter({
  variable: "--font-linear-sans",
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
    <div className={inter.variable}>
      <MarketingLayout>{children}</MarketingLayout>
    </div>
  );
}
