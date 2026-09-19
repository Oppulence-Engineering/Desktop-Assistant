import { Suspense } from "react";

import { SupportChat } from "@/components/features/support/support-chat/support-chat";
import { marketingFontVariables } from "@/lib/fonts";

import { MarketingLayout } from "./marketing-components";

export const viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#000000",
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <div className={marketingFontVariables}>
      <MarketingLayout>{children}</MarketingLayout>
      {/* The public site is dark-on-black, so the widget is pinned dark
          rather than following the visitor's system preference. */}
      <Suspense fallback={null}>
        <SupportChat theme="dark" />
      </Suspense>
    </div>
  );
}
