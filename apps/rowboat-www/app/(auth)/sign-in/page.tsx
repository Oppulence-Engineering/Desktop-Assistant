import { Suspense } from "react";

import { AuthShell } from "@/components/auth/auth-shell";
import { safeReturnTo } from "@/lib/auth/pkce";
import { createMetadata } from "@/lib/metadata";

export const metadata = createMetadata({
  title: "Sign in",
  description: "Continue with Google to open the Oppulence commitment register.",
  robots: { index: false, follow: false },
});

type SignInSearchParams = Promise<{ error?: string; return_to?: string }>;

async function SignInContent({ searchParams }: { searchParams: SignInSearchParams }) {
  const params = await searchParams;
  return (
    <AuthShell error={params.error} mode="sign-in" returnTo={safeReturnTo(params.return_to)} />
  );
}

export default function SignInPage({ searchParams }: { searchParams: SignInSearchParams }) {
  // searchParams is runtime data, so it must resolve under Suspense.
  // One AuthShell fallback — do not also add loading.tsx with the same tree.
  return (
    <Suspense fallback={<AuthShell mode="sign-in" returnTo="/app" />}>
      <SignInContent searchParams={searchParams} />
    </Suspense>
  );
}
