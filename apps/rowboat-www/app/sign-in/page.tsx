import { SignIn } from "@phosphor-icons/react/dist/ssr";

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
    <main className="app-shell flex min-h-svh items-center justify-center bg-background-100 px-6 dark:bg-background">
      <section className="flex w-full max-w-sm flex-col gap-4">
        <div className="flex flex-col gap-5 rounded-[2px] border bg-background p-8 dark:bg-background-50">
          <div className="space-y-2 text-center">
            <p className="font-mono text-xs text-oppulence-orange">[oppulence console]</p>
            <h1 className="font-display text-2xl">Sign in to Oppulence</h1>
            <p className="text-sm text-muted-foreground">
              Use your WorkOS account to access the dashboard.
            </p>
          </div>
          {params.error ? (
            <div className="rounded-[2px] border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {params.error}
            </div>
          ) : null}
          <Button asChild>
            <a href={loginHref}>
              <SignIn />
              Continue with WorkOS
            </a>
          </Button>
        </div>
        <p className="text-center font-mono text-xs text-primary/40">
          revenue memory and execution os
        </p>
      </section>
    </main>
  );
}
