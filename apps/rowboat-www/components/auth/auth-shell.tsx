import Link from "next/link";

import { Button } from "@oppulence/ui/components/button";

/** Multi-color Google "G". Explicit fills, so the button's currentColor rules don't tint it. */
function GoogleLogo() {
  return (
    <svg aria-hidden height="18" viewBox="0 0 24 24" width="18">
      <path
        d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
        fill="#4285F4"
      />
      <path
        d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
        fill="#34A853"
      />
      <path
        d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
        fill="#FBBC05"
      />
      <path
        d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
        fill="#EA4335"
      />
    </svg>
  );
}

const FEATURES = [
  "Maintains living customer relationship state",
  "Shows what changed and why it matters",
  "Prepares evidence-backed actions for approval",
];

const AUTH_ERROR_MESSAGES: Record<string, string> = {
  sign_in_unavailable: "Sign-in is temporarily unavailable. Please try again.",
};

export function AuthShell({
  mode,
  error,
  returnTo,
}: {
  mode: "sign-in" | "sign-up";
  error?: string;
  returnTo: string;
}) {
  const isSignUp = mode === "sign-up";
  const errorMessage = error
    ? AUTH_ERROR_MESSAGES[error] || "We couldn't complete sign-in. Please try again."
    : undefined;
  const loginHref = `/api/auth/workos/login?${new URLSearchParams({ return_to: returnTo })}`;
  const crossHref = isSignUp
    ? `/sign-in?${new URLSearchParams({ return_to: returnTo })}`
    : `/sign-up?${new URLSearchParams({ return_to: returnTo })}`;

  return (
    <main className="app-shell grid min-h-svh bg-background lg:grid-cols-2">
      {/* Form panel */}
      <div className="flex flex-col px-6 py-8 sm:px-10">
        <Link className="flex items-center gap-2.5" href="/">
          <img alt="" className="size-6" src="/marketing/oppulence-icon.png" />
          <span className="font-display text-lg text-foreground">Oppulence</span>
        </Link>

        <div className="flex flex-1 items-center justify-center py-10">
          <div className="flex w-full max-w-sm flex-col gap-6">
            <div className="space-y-2">
              <p className="font-mono text-xs text-oppulence-orange">
                {isSignUp ? "[get started]" : "[welcome back]"}
              </p>
              <h1 className="font-display text-3xl text-foreground">
                {isSignUp ? "Create your account" : "Sign in"}
              </h1>
              <p className="text-sm text-muted-foreground">
                {isSignUp
                  ? "Continue with Google — your first sign-in creates your workspace."
                  : "Continue with Google to access your workspace."}
              </p>
            </div>

            {errorMessage ? (
              <div className="rounded-[2px] border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                {errorMessage}
              </div>
            ) : null}

            <Button asChild className="h-11 w-full" size="lg" variant="outline">
              <a href={loginHref}>
                <GoogleLogo />
                {isSignUp ? "Sign up with Google" : "Continue with Google"}
              </a>
            </Button>

            <p className="text-xs leading-relaxed text-muted-foreground">
              By continuing you agree to our{" "}
              <Link className="text-primary underline-offset-4 hover:underline" href="/terms">
                Terms
              </Link>{" "}
              and{" "}
              <Link className="text-primary underline-offset-4 hover:underline" href="/privacy">
                Privacy Policy
              </Link>
              .
            </p>

            <div className="border-t pt-5 text-sm text-muted-foreground">
              {isSignUp ? "Already have an account? " : "Don't have an account? "}
              <Link
                className="font-medium text-primary underline-offset-4 hover:underline"
                href={crossHref}
              >
                {isSignUp ? "Sign in" : "Sign up"}
              </Link>
            </div>
          </div>
        </div>

        {/* Mobile-only tagline (brand panel is hidden below lg) */}
        <p className="font-mono text-xs text-primary/40 lg:hidden">relationship intelligence</p>
      </div>

      {/* Brand panel — always dark, regardless of theme */}
      <div className="relative hidden overflow-hidden bg-[#0b0b0c] lg:flex lg:flex-col lg:justify-between lg:p-12">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0"
          style={{
            background:
              "radial-gradient(60% 50% at 80% 0%, rgba(240,110,40,0.16), transparent 70%)",
          }}
        />
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 opacity-[0.04]"
          style={{
            backgroundImage: "radial-gradient(rgba(255,255,255,0.8) 1px, transparent 1px)",
            backgroundSize: "22px 22px",
          }}
        />
        <div className="relative flex items-center gap-2.5">
          <img alt="" className="size-6" src="/marketing/oppulence-icon.png" />
          <span className="font-display text-lg text-white">Oppulence</span>
        </div>

        <div className="relative max-w-md space-y-6">
          <p className="font-mono text-xs text-oppulence-orange">[relationship intelligence]</p>
          <h2 className="font-display text-4xl leading-tight text-white">
            Know every customer relationship. Know what needs action.
          </h2>
          <ul className="space-y-3">
            {FEATURES.map((feature) => (
              <li className="flex items-start gap-2.5 text-sm text-white/70" key={feature}>
                <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-oppulence-orange" />
                {feature}
              </li>
            ))}
          </ul>
        </div>

        <p className="relative font-mono text-xs text-white/30">
          A Playbook Media product · oppulence.io
        </p>
      </div>
    </main>
  );
}
