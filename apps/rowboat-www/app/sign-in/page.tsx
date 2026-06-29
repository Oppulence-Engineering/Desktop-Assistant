import { LogIn } from "lucide-react";

import { Button } from "@/components/ui/button";

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; return_to?: string }>;
}) {
  const params = await searchParams;
  const returnTo = params.return_to || "/app";
  const loginHref = `/api/auth/workos/login?${new URLSearchParams({ return_to: returnTo })}`;

  return (
    <main className="flex min-h-svh items-center justify-center bg-background px-6">
      <section className="flex w-full max-w-sm flex-col gap-5 text-center">
        <div className="space-y-2">
          <h1 className="text-2xl font-semibold tracking-normal">Sign in to Oppulence</h1>
          <p className="text-sm text-muted-foreground">
            Use your WorkOS account to access the dashboard.
          </p>
        </div>
        {params.error ? (
          <div className="border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {params.error}
          </div>
        ) : null}
        <Button asChild>
          <a href={loginHref}>
            <LogIn />
            Continue with WorkOS
          </a>
        </Button>
      </section>
    </main>
  );
}
