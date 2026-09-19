import { redirect } from "next/navigation";

import { isSessionUsable } from "@/lib/auth/cookies";
import { getOptionalSession } from "@/lib/auth/session";
import { marketingFontVariables } from "@/lib/fonts";
import { cn } from "@/lib/utils";

import "@/app/(marketing)/sim-landing/sim-landing.css";

// The authenticated redirect must resolve before any login UI is streamed.
export const instant = false;

export const viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#fefefe",
};

export default async function AuthLayout({ children }: { children: React.ReactNode }) {
  // Auth routes are public only for anonymous users. Resolving this in their
  // shared server layout avoids rendering a login prompt while a valid sealed
  // session is already available to the same request.
  if (isSessionUsable(await getOptionalSession())) {
    redirect("/app");
  }

  return (
    <div className={cn("sim-landing-root min-h-svh", marketingFontVariables)} data-auth-route>
      {children}
    </div>
  );
}
