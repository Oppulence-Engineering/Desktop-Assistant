import { Suspense } from "react";

import { AuthShell } from "@/components/auth/auth-shell";
import { safeReturnTo } from "@/lib/auth/pkce";
import { createMetadata } from "@/lib/metadata";

export const metadata = createMetadata({
  title: "Create a workspace",
  description: "Start an Oppulence workspace with Google. The first sign-in builds the register.",
  robots: { index: false, follow: false },
});

type SignUpSearchParams = Promise<{ error?: string; return_to?: string }>;

async function SignUpContent({ searchParams }: { searchParams: SignUpSearchParams }) {
  const params = await searchParams;
  return (
    <AuthShell error={params.error} mode="sign-up" returnTo={safeReturnTo(params.return_to)} />
  );
}

export default function SignUpPage({ searchParams }: { searchParams: SignUpSearchParams }) {
  // searchParams is runtime data, so it must resolve under Suspense.
  // One AuthShell fallback — do not also add loading.tsx with the same tree.
  return (
    <Suspense fallback={<AuthShell mode="sign-up" returnTo="/app" />}>
      <SignUpContent searchParams={searchParams} />
    </Suspense>
  );
}
