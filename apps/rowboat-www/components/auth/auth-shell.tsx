import Link from "next/link";

import { AuthLedgerPreview } from "@/components/auth/auth-ledger-preview";

/** Multi-color Google "G". Explicit fills, so button color rules don't tint it. */
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
    <main
      className="grid min-h-svh bg-[var(--bg)] text-[var(--text-primary)] lg:grid-cols-[minmax(22rem,28rem)_minmax(0,1fr)]"
      key={mode}
    >
      <section className="flex flex-col justify-between px-6 py-8 sm:px-10 lg:border-r lg:border-[var(--border)] lg:px-12 lg:py-10">
        <Link
          aria-label="Oppulence home"
          className="inline-flex items-center gap-2.5 text-[15px] font-medium tracking-[-0.02em] text-[var(--text-primary)]"
          href="/"
        >
          <img alt="" className="size-7 object-contain" src="/marketing/oppulence-icon.png" />
          Oppulence
        </Link>

        <div className="mx-auto w-full max-w-[22rem] py-12 lg:mx-0 lg:py-16">
          <p className="font-mono text-[11px] tracking-[0.08em] text-[var(--text-muted)] uppercase">
            {isSignUp ? "Start" : "Sign in"}
          </p>
          {/* Same headline as the public CTA so this does not read as a second product. */}
          <h1 className="mt-3 text-balance text-[32px] leading-[1.15] font-medium tracking-[-0.02em] text-[var(--text-primary)] sm:text-[36px]">
            Every promise, on the record
          </h1>
          <p className="mt-3 text-pretty text-[15px] leading-[1.5] text-[var(--text-body)]">
            {isSignUp
              ? "Create a workspace with Google. The first sign-in builds the register — what you owe, what they owe, and the proof."
              : "Continue with Google to open the register. A new workspace starts on the first sign-in."}
          </p>

          {errorMessage ? (
            <p
              className="mt-6 rounded-[8px] border border-[var(--border)] bg-[var(--surface-3)] px-3 py-2.5 text-[13px] leading-relaxed text-[var(--text-primary)]"
              role="alert"
            >
              {errorMessage}
            </p>
          ) : null}

          <a
            className="mt-8 inline-flex h-11 w-full items-center justify-center gap-2 rounded-[8px] border border-[var(--border)] bg-[var(--surface-2)] text-[15px] font-medium text-[var(--text-primary)] transition-colors hover:bg-[var(--surface-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--text-primary)]/20"
            href={loginHref}
          >
            <GoogleLogo />
            Continue with Google
          </a>

          <p className="mt-5 text-[12.5px] leading-relaxed text-[var(--text-muted)]">
            By continuing, you agree to our{" "}
            <Link
              className="underline underline-offset-3 hover:text-[var(--text-primary)]"
              href="/terms"
            >
              Terms
            </Link>{" "}
            and{" "}
            <Link
              className="underline underline-offset-3 hover:text-[var(--text-primary)]"
              href="/privacy"
            >
              Privacy Policy
            </Link>
            .
          </p>
        </div>

        <p className="text-[13px] text-[var(--text-secondary)]">
          {isSignUp ? "Have an account?" : "New here?"}{" "}
          <Link
            className="font-medium text-[var(--text-primary)] underline-offset-3 hover:underline"
            href={crossHref}
          >
            {isSignUp ? "Sign in" : "Create a workspace"}
          </Link>
        </p>
      </section>

      <aside className="relative min-h-[22rem] overflow-hidden lg:min-h-svh">
        <AuthLedgerPreview />
      </aside>
    </main>
  );
}
