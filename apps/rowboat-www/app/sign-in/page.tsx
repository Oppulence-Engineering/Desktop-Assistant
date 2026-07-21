import { AuthShell } from "@/components/auth/auth-shell";
import { safeReturnTo } from "@/lib/auth/pkce";

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; return_to?: string }>;
}) {
  const params = await searchParams;
  return (
    <AuthShell error={params.error} mode="sign-in" returnTo={safeReturnTo(params.return_to)} />
  );
}
