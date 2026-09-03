import type { Metadata } from "next";
import { Geist, Geist_Mono, Inter } from "next/font/google";
import localFont from "next/font/local";
import Script from "next/script";
import "./globals.css";
import "./product-theme.css";

export const metadata: Metadata = {
  title: "Oppulence — Relationship Intelligence",
  description:
    "Oppulence maintains a living model of every customer relationship and shows what changed, what needs action, and the evidence behind every recommendation.",
  icons: {
    icon: "/icon.png",
    apple: "/icon.png",
  },
};

const geist = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
  display: "swap",
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
  display: "swap",
});

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
  weight: ["400", "500"],
  display: "swap",
});

const f37Stout = localFont({
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

export const viewport = {
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html data-scroll-behavior="smooth" lang="en" suppressHydrationWarning>
      <head>
        <Script src="/config.js" strategy="beforeInteractive" />
      </head>
      <body
        className={`${geist.variable} ${geistMono.variable} ${f37Stout.variable} ${inter.variable} antialiased`}
        suppressHydrationWarning
      >
        {children}
      </body>
    </html>
  );
}
