import type { Metadata } from "next";
import { Geist_Mono, Inter } from "next/font/google";
import localFont from "next/font/local";
import Script from "next/script";
import "./globals.css";

export const metadata: Metadata = {
  title: "Oppulence - Local-first AI coworker and agent platform",
  description:
    "Oppulence turns email, calendar, meetings, and operational context into an owned knowledge graph that agents can reason over and act on.",
  icons: {
    icon: "/icon.png",
    apple: "/icon.png",
  },
};

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
  display: "swap",
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
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
  maximumScale: 1,
  userScalable: false,
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <Script src="/config.js" strategy="beforeInteractive" />
      </head>
      <body
        className={`${inter.variable} ${geistMono.variable} ${f37Stout.variable} antialiased`}
        suppressHydrationWarning
      >
        {children}
      </body>
    </html>
  );
}
