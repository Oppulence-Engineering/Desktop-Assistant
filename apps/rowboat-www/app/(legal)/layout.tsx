import { LegalLayoutClient } from "./legal-layout-client";

import "@/app/(marketing)/marketing-sim-theme.css";

export const viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#ffffff" },
    { media: "(prefers-color-scheme: dark)", color: "#111111" },
  ],
};

export default function LegalLayout({ children }: { children: React.ReactNode }) {
  return <LegalLayoutClient>{children}</LegalLayoutClient>;
}
