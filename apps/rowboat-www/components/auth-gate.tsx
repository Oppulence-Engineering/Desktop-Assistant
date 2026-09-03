"use client";

import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { ArrowClockwise, CircleNotch } from "@phosphor-icons/react";

import { Button } from "@oppulence/ui/components/button";
import { loadBrowserSession, loginURL } from "@/lib/auth/client";
import type { BrowserSessionResponse } from "@/lib/auth/schemas";

type AuthState =
  | { status: "loading" }
  | { status: "authenticated"; session: Extract<BrowserSessionResponse, { authenticated: true }> }
  | { status: "unauthenticated" }
  | { status: "error" };

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
      .catch(() => {
        if (cancelled) return;
        setState({ status: "error" });
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const contextValue = useMemo(() => (state.status === "authenticated" ? state : null), [state]);

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
            <div className="space-y-1">
              <h1 className="text-base font-medium">We couldn’t verify your session</h1>
              <p className="text-sm text-muted-foreground">Check your connection and try again.</p>
            </div>
            <Button onClick={() => window.location.reload()}>
              <ArrowClockwise />
              Try again
            </Button>
          </>
        ) : (
          <>
            <CircleNotch className="h-5 w-5 animate-spin text-muted-foreground" />
            <div className="text-sm text-muted-foreground">Checking session</div>
          </>
        )}
      </div>
    </main>
  );
}
