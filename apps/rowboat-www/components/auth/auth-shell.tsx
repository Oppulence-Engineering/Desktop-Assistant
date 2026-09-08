import Link from "next/link";

import { AuthTestimonials, type Testimonial } from "@/app/(auth)/_components/auth-testimonials";

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

/** Stat pills under the quote card, mirroring the public site's proof strip. */
const STATS = ["Every account, always current", "Evidence behind every action"];

// Showcase quotes, rotated every few seconds. Keep these real and attributable
// — swap text and attribution together, and don't ship a quote we can't source.
const TESTIMONIALS: Testimonial[] = [
  {
    quote:
      "The Monday scramble is gone. Open it and the accounts that moved are already surfaced, with the reasoning attached, so nothing is a guess. It's not magic — it's just the first tool here that stayed accurate past week two.",
    name: "Design partner",
    title: "Head of Customer Success, B2B SaaS",
    avatar: "/marketing/oppulence-icon.png",
  },
  {
    quote:
      "Renewal prep used to mean digging through six months of threads the night before. Now the history is already assembled and the gaps are called out, so the call is about the customer instead of about catching up.",
    name: "Design partner",
    title: "Account Director, enterprise software",
    avatar: "/marketing/oppulence-icon.png",
  },
  {
    quote:
      "What sold the team was the receipts. Every suggestion links back to the actual email or meeting it came from, so people trust it enough to act instead of double-checking everything by hand.",
    name: "Design partner",
    title: "RevOps lead, Series B",
    avatar: "/marketing/oppulence-icon.png",
  },
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
    <main className="sm-site sm-auth">
      {/* Form column */}
      <div className="sm-auth-form">
        <div className="sm-auth-form-inner">
          <Link aria-label="Oppulence home" className="sm-auth-lockup" href="/">
            <img alt="" src="/marketing/oppulence-icon.png" />
            <span>Oppulence</span>
          </Link>

          <h1 className="sm-auth-title">Your relationship layer awaits</h1>
          <p className="sm-auth-sub">
            {isSignUp
              ? "Create an account to get started. Your first sign-in builds your workspace."
              : "Sign in or create an account to get started."}
          </p>

          {errorMessage ? <p className="sm-auth-error">{errorMessage}</p> : null}

          <a className="sm-auth-provider" href={loginHref}>
            <GoogleLogo />
            Continue with Google
          </a>

          <p className="sm-auth-legal">
            By continuing, you agree to our <Link href="/terms">Terms</Link> and{" "}
            <Link href="/privacy">Privacy Policy</Link>. {isSignUp ? "Have an account?" : "New here?"}{" "}
            <Link href={crossHref}>{isSignUp ? "Sign in" : "Create one"}</Link>.
          </p>
        </div>
      </div>

      {/* Showcase column */}
      <div className="sm-auth-showcase">
        <div className="sm-auth-canvas">
          <img alt="" className="sm-auth-canvas-image" src="/marketing/relationship-desktop.png" />
          <div aria-hidden className="sm-auth-canvas-wash" />

          <div className="sm-auth-overlay">

            <AuthTestimonials items={TESTIMONIALS} />

            <div className="sm-auth-stats">
              {STATS.map((stat) => (
                <span key={stat}>{stat}</span>
              ))}
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}
