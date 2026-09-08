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

const HIGHLIGHTS = [
  "Every account, always current",
  "Evidence before every action",
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
    <main className="app-shell grid min-h-svh bg-muted/30 lg:grid-cols-2">
      {/* Form panel */}
      <div className="flex items-center justify-center px-6 py-12 sm:px-10">
        <div className="flex w-full max-w-sm flex-col gap-8">
          <Link className="flex items-center gap-2.5" href="/">
            <img alt="" className="size-7" src="/marketing/oppulence-icon.png" />
            <span className="font-display text-2xl tracking-tight text-foreground">Oppulence</span>
          </Link>

          <div className="space-y-2">
            <h1 className="font-display text-3xl leading-tight text-foreground">
              Your relationship layer awaits
            </h1>
            <p className="text-sm text-muted-foreground">
              {isSignUp
                ? "Create an account to get started. Your first sign-in builds your workspace."
                : "Sign in or create an account to get started."}
            </p>
          </div>

          {errorMessage ? (
            <div className="rounded-[2px] border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {errorMessage}
            </div>
          ) : null}

          <div className="space-y-3">
            <Button asChild className="h-12 w-full bg-background" size="lg" variant="outline">
              <a href={loginHref}>
                <GoogleLogo />
                {isSignUp ? "Sign up with Google" : "Continue with Google"}
              </a>
            </Button>
            <p className="text-center text-xs text-muted-foreground">
              {isSignUp ? "Already have an account? " : "Don't have an account? "}
              <Link
                className="font-medium text-primary underline-offset-4 hover:underline"
                href={crossHref}
              >
                {isSignUp ? "Sign in" : "Sign up"}
              </Link>
            </p>
          </div>

          <p className="text-xs leading-relaxed text-muted-foreground">
            By continuing, you agree to our{" "}
            <Link className="underline underline-offset-4" href="/terms">
              Terms
            </Link>{" "}
            and{" "}
            <Link className="underline underline-offset-4" href="/privacy">
              Privacy Policy
            </Link>
            .
          </p>
        </div>
      </div>

      {/* Showcase panel */}
      <div className="relative hidden p-6 lg:block">
        <div className="relative h-full overflow-hidden rounded-2xl bg-[#0b0b0c]">
          <img
            alt=""
            className="absolute inset-0 size-full scale-105 object-cover opacity-60 blur-[3px]"
            src="/marketing/relationship-desktop.png"
          />
          <div
            aria-hidden
            className="absolute inset-0"
            style={{
              background:
                "linear-gradient(180deg, rgba(11,11,12,0.55) 0%, rgba(11,11,12,0.85) 100%), radial-gradient(60% 50% at 80% 0%, rgba(240,110,40,0.25), transparent 70%)",
            }}
          />

          <div className="relative flex h-full flex-col items-center justify-center gap-6 p-10">
            <div className="w-full max-w-lg rounded-2xl bg-background p-7 shadow-2xl">
              <p className="font-display text-xl leading-snug text-foreground">
                Every customer relationship, kept current — and the next action already prepared,
                with the evidence behind it.
              </p>
              <p className="mt-3 text-sm text-muted-foreground">
                Not another CRM to update. A system that watches the work and tells you what
                changed.
              </p>
              <div className="mt-6 flex items-center gap-3 border-t pt-4">
                <img alt="" className="size-9 rounded-full" src="/marketing/oppulence-icon.png" />
                <div className="text-sm">
                  <p className="font-medium text-foreground">Oppulence</p>
                  <p className="text-muted-foreground">Relationship intelligence</p>
                </div>
              </div>
            </div>

            <div className="flex flex-wrap justify-center gap-3">
              {HIGHLIGHTS.map((highlight) => (
                <span
                  className="rounded-full bg-white/10 px-4 py-2 text-sm text-white backdrop-blur"
                  key={highlight}
                >
                  {highlight}
                </span>
              ))}
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}
