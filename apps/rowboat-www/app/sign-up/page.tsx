import { Suspense } from "react";

import { AuthShell } from "@/components/auth/auth-shell";
import { safeReturnTo } from "@/lib/auth/pkce";

type SignUpSearchParams = Promise<{ error?: string; return_to?: string }>;

async function SignUpContent({ searchParams }: { searchParams: SignUpSearchParams }) {
  const params = await searchParams;
  return (
    <AuthShell error={params.error} mode="sign-up" returnTo={safeReturnTo(params.return_to)} />
  );
}

export default function SignUpPage({ searchParams }: { searchParams: SignUpSearchParams }) {
  // searchParams is runtime data, so it must resolve under Suspense for the
  // route to keep an instant prerendered shell. The fallback mirrors the
  // default render (no error, "/app" return), so the swap is invisible.
  return (
    <Suspense fallback={<AuthShell mode="sign-up" returnTo="/app" />}>
      <SignUpContent searchParams={searchParams} />
    </Suspense>
  );
}
