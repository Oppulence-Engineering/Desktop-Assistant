import { Suspense } from "react";

import { AuthShell } from "@/components/auth/auth-shell";
import { safeReturnTo } from "@/lib/auth/pkce";

type SignInSearchParams = Promise<{ error?: string; return_to?: string }>;

async function SignInContent({ searchParams }: { searchParams: SignInSearchParams }) {
  const params = await searchParams;
  return (
    <AuthShell error={params.error} mode="sign-in" returnTo={safeReturnTo(params.return_to)} />
  );
}

export default function SignInPage({ searchParams }: { searchParams: SignInSearchParams }) {
  // searchParams is runtime data, so it must resolve under Suspense for the
  // route to keep an instant prerendered shell. The fallback mirrors the
  // default render (no error, "/app" return), so the swap is invisible.
  return (
    <Suspense fallback={<AuthShell mode="sign-in" returnTo="/app" />}>
      <SignInContent searchParams={searchParams} />
    </Suspense>
  );
}
