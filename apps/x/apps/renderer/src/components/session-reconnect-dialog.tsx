import * as React from "react";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@oppulence/ui/components/dialog";
import { ProductLoginExperience } from "@/components/onboarding/product-login-experience";
import { PRODUCT_NAME, PRODUCT_PROVIDER_ID, isProductProvider } from "@x/shared/dist/branding.js";

interface SessionReconnectDialogProps {
  open: boolean;
  onReconnected: () => void | Promise<void>;
  onContinueOffline: () => void;
}

export function SessionReconnectDialog({
  open,
  onReconnected,
  onContinueOffline,
}: SessionReconnectDialogProps) {
  const [connecting, setConnecting] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!open) {
      setConnecting(false);
      setError(null);
    }
  }, [open]);

  React.useEffect(() => {
    return window.ipc.on("oauth:didConnect", (event) => {
      if (!isProductProvider(event.provider)) return;
      setConnecting(false);
      if (event.success) {
        setError(null);
        void onReconnected();
      } else {
        setError(event.error || "We couldn't complete sign-in. Please try again.");
      }
    });
  }, [onReconnected]);

  const handleSignIn = React.useCallback(async () => {
    setConnecting(true);
    setError(null);
    try {
      const result = await window.ipc.invoke("oauth:connect", {
        provider: PRODUCT_PROVIDER_ID,
      });
      if (!result.success) {
        setConnecting(false);
        setError(result.error || "We couldn't open sign-in. Please try again.");
      }
    } catch (caught) {
      setConnecting(false);
      setError(caught instanceof Error ? caught.message : "We couldn't open sign-in.");
    }
  }, []);

  return (
    <Dialog open={open} onOpenChange={() => undefined}>
      {/*
        A full page, not a floating dialog.
        
        Signing back in is not a decision taken beside your work — the session is
        gone, every connected source is unreachable, and the app behind this is
        showing stale state the user cannot act on. Framing it as an 85vw card
        over a dimmed workspace invited exactly that misreading.

        It stays a Radix Dialog so the focus trap, the aria wiring, and the
        refusal to close on Escape or an outside click all still hold; only the
        presentation is full-bleed. The centering transform and size caps in the
        base DialogContent are overridden here rather than in the shared
        primitive, which other dialogs still want.
      */}
      <DialogContent
        showCloseButton={false}
        // data-[state=closed]:[animation:none]! is load-bearing, not cosmetic.
        //
        // Radix's Presence keeps the node mounted until it sees an animationend
        // for the exit animation the base DialogContent declares
        // (data-[state=closed]:animate-out). On this surface that event never
        // arrives, so the node stayed in the DOM at opacity 1 after closing —
        // and once this became a full-page surface, that meant "Back to app"
        // appeared to do nothing at all: state flipped to closed and the user
        // was left staring at a settings page they could not leave.
        //
        // Killing the exit animation makes Presence unmount synchronously, which
        // is what a full-page surface wants anyway: pages do not zoom out. The
        // important modifier is required because tailwind-merge does not treat
        // these arbitrary data-variants as conflicting, so animate-out survives
        // in the class list and would otherwise win on source order.
        className="app-shell inset-0 top-0 left-0 flex h-svh w-screen max-w-none translate-x-0 translate-y-0 gap-0 overflow-hidden rounded-none border-0 bg-[#09090b] p-0 text-white shadow-none sm:max-w-none data-[state=closed]:[animation:none]!"
        onEscapeKeyDown={(event) => event.preventDefault()}
        onPointerDownOutside={(event) => event.preventDefault()}
        onInteractOutside={(event) => event.preventDefault()}
      >
        <DialogTitle className="sr-only">Sign back in to {PRODUCT_NAME}</DialogTitle>
        <DialogDescription className="sr-only">
          Your session expired. Sign in again to restore connected sources and AI actions, or
          continue with your local workspace.
        </DialogDescription>
        <ProductLoginExperience
          mode="reconnect"
          connecting={connecting}
          error={error}
          onProductSignIn={() => void handleSignIn()}
          onContinueOffline={onContinueOffline}
        />
      </DialogContent>
    </Dialog>
  );
}
