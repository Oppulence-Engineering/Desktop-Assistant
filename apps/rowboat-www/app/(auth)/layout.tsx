import { DM_Mono, DM_Sans, Space_Grotesk } from "next/font/google";

// The auth pages share the public site's type system (DM Sans body, Space
// Grotesk display, DM Mono accents) so sign-in doesn't visually detach from
// marketing. The `sm-site` token scope is applied on the page shell itself.
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
  themeColor: "#ffffff",
};

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className={`${dmSans.variable} ${dmMono.variable} ${spaceGrotesk.variable}`}>
      {children}
    </div>
  );
}
