"use client";

import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { ArrowClockwise } from "@/lib/icons";

import { Button } from "@oppulence/ui/components/button";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@oppulence/ui/components/empty";
import { Spinner } from "@oppulence/ui/components/spinner";
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
      <Empty className="w-full max-w-sm border-0">
        {state.status === "error" ? (
          <>
            <EmptyHeader>
              <EmptyTitle className="text-base">We couldn’t verify your session</EmptyTitle>
              <EmptyDescription>Check your connection and try again.</EmptyDescription>
            </EmptyHeader>
            <EmptyContent>
              <Button onClick={() => window.location.reload()}>
                <ArrowClockwise />
                Try again
              </Button>
            </EmptyContent>
          </>
        ) : (
          <EmptyHeader>
            <Spinner className="size-5 text-muted-foreground" />
            <EmptyDescription>Checking session</EmptyDescription>
          </EmptyHeader>
        )}
      </Empty>
    </main>
  );
}
