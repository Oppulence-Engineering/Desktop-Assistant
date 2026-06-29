"use client";

import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { Loader2, LogIn } from "lucide-react";

import { Button } from "@/components/ui/button";
import { loadBrowserSession, loginURL } from "@/lib/auth/client";
import type { BrowserSessionResponse } from "@/lib/auth/schemas";

type AuthState =
  | { status: "loading" }
  | { status: "authenticated"; session: Extract<BrowserSessionResponse, { authenticated: true }> }
  | { status: "unauthenticated" }
  | { status: "error"; message: string };

const AuthSessionContext = createContext<Extract<AuthState, { status: "authenticated" }> | null>(
  null,
);

export function useAuthSession() {
  const value = useContext(AuthSessionContext);
  if (!value) {
    throw new Error("useAuthSession must be used inside AuthGate");
  }
  return value.session;
}

export function AuthGate({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({ status: "loading" });

  useEffect(() => {
    let cancelled = false;
    loadBrowserSession()
      .then((session) => {
        if (cancelled) return;
        if (!session.authenticated) {
          setState({ status: "unauthenticated" });
          window.location.assign(loginURL(window.location.pathname + window.location.search));
          return;
        }
        setState({ status: "authenticated", session });
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        const message = error instanceof Error ? error.message : "Could not verify your session";
        setState({ status: "error", message });
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const contextValue = useMemo(
    () => (state.status === "authenticated" ? state : null),
    [state],
  );

  if (state.status === "authenticated" && contextValue) {
    return (
      <AuthSessionContext.Provider value={contextValue}>{children}</AuthSessionContext.Provider>
    );
  }

  return (
    <main className="flex min-h-svh items-center justify-center bg-background px-6">
      <div className="flex w-full max-w-sm flex-col items-center gap-4 text-center">
        {state.status === "error" ? (
          <>
            <div className="text-sm font-medium text-destructive">{state.message}</div>
            <Button asChild>
              <a href={loginURL("/app")}>
                <LogIn />
                Sign in
              </a>
            </Button>
          </>
        ) : (
          <>
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            <div className="text-sm text-muted-foreground">Checking session</div>
          </>
        )}
      </div>
    </main>
  );
}
