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
      <DialogContent
        showCloseButton={false}
        className="app-shell flex h-[85svh] w-[85vw] max-w-none gap-0 overflow-hidden rounded-2xl border-white/10 bg-[#09090b] p-0 text-white shadow-2xl sm:max-w-none"
        style={{ width: "85vw", height: "85vh", maxWidth: "85vw" }}
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
