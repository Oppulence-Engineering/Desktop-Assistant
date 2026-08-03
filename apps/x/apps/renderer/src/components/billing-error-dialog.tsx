import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@oppulence/ui/components/dialog";
import { Button } from "@oppulence/ui/components/button";
import type { BillingErrorMatch } from "@/lib/billing-error";

interface BillingErrorDialogProps {
  open: boolean;
  match: BillingErrorMatch | null;
  onOpenChange: (open: boolean) => void;
}

export function BillingErrorDialog({ open, match, onOpenChange }: BillingErrorDialogProps) {
  const [pending, setPending] = useState(false);

  if (!match) return null;

  const handleUpgrade = async () => {
    setPending(true);
    try {
      let url: string | null = null;
      if (match.cta === "Reactivate") {
        try {
          const portal = await window.ipc.invoke("billing:getPortalUrl", null);
          url = portal.url;
        } catch {
          url = null;
        }
      }
      if (!url) {
        const checkout = await window.ipc.invoke("billing:getCheckoutUrl", { plan: "starter" });
        url = checkout.url;
      }
      window.open(url);
      onOpenChange(false);
    } catch (error) {
      console.error("Failed to open billing flow:", error);
    } finally {
      setPending(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{match.title}</DialogTitle>
          <DialogDescription>{match.subtitle}</DialogDescription>
        </DialogHeader>
        <DialogFooter className="gap-2 sm:gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Dismiss
          </Button>
          <Button onClick={handleUpgrade} disabled={pending}>
            {match.cta}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
