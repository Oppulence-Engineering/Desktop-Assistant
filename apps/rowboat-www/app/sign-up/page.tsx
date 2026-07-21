import { AuthShell } from "@/components/auth/auth-shell";
import { safeReturnTo } from "@/lib/auth/pkce";

export default async function SignUpPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; return_to?: string }>;
}) {
  const params = await searchParams;
  return (
    <AuthShell error={params.error} mode="sign-up" returnTo={safeReturnTo(params.return_to)} />
  );
}
