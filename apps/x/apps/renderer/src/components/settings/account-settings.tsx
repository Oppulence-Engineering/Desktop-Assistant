"use client";

import { useState, useEffect, useCallback } from "react";
import { Loader2, User, CreditCard, LogOut, ExternalLink } from "@/lib/icons";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { useBilling } from "@/hooks/useBilling";
import { toast } from "sonner";
import type { BillingUsageBucket } from "@x/shared/dist/billing.js";
import {
  PRODUCT_NAME,
  PRODUCT_PROVIDER_ID,
  getProductProviderState,
  isProductProvider,
} from "@x/shared/dist/branding.js";

interface AccountSettingsProps {
  dialogOpen: boolean;
}

function formatPlanName(plan: string | null | undefined) {
  if (!plan) return "No Plan";
  return `${plan.charAt(0).toUpperCase()}${plan.slice(1)} Plan`;
}

function CreditUsageBar({
  label,
  bucket,
  helper,
}: {
  label: string;
  bucket: BillingUsageBucket;
  helper?: string;
}) {
  const pct =
    bucket.sanctionedCredits > 0
      ? Math.min(
          100,
          Math.max(0, Math.round((bucket.usedCredits / bucket.sanctionedCredits) * 100)),
        )
      : 0;

  return (
    <div className="space-y-1.5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs font-medium text-muted-foreground">{label}</p>
          {helper ? <p className="text-[11px] text-muted-foreground">{helper}</p> : null}
        </div>
        <p className="shrink-0 text-xs font-medium tabular-nums">{pct}%</p>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-muted">
        <div
          className="h-full rounded-full bg-primary transition-all"
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

export function AccountSettings({ dialogOpen }: AccountSettingsProps) {
  const [isSolomonConnected, setIsSolomonConnected] = useState(false);
  const [connectionLoading, setConnectionLoading] = useState(true);
  const [disconnecting, setDisconnecting] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [confirmingLogout, setConfirmingLogout] = useState(false);
  const [appUrl, setAppUrl] = useState<string | null>(null);
  const {
    billing,
    isLoading: billingLoading,
    error: billingError,
  } = useBilling(isSolomonConnected);
  const hasPaidSubscription =
    billing?.subscriptionPlan === "starter" || billing?.subscriptionPlan === "pro";
  const billingNeedsReconnect = billingError?.reason === "auth_unavailable";

  const checkConnection = useCallback(async () => {
    try {
      setConnectionLoading(true);
      const result = await window.ipc.invoke("oauth:getState", null);
      const connected = getProductProviderState(result.config)?.connected ?? false;
      setIsSolomonConnected(connected);
    } catch {
      setIsSolomonConnected(false);
    } finally {
      setConnectionLoading(false);
    }
  }, []);

  useEffect(() => {
    if (dialogOpen) {
      checkConnection();
    } else {
      setConfirmingLogout(false);
    }
  }, [dialogOpen, checkConnection]);

  useEffect(() => {
    if (isSolomonConnected) {
      window.ipc
        .invoke("account:getSolomon", null)
        .then((account) => setAppUrl(account.config?.appUrl ?? null))
        .catch(() => {});
    }
  }, [isSolomonConnected]);

  useEffect(() => {
    const cleanup = window.ipc.on("oauth:didConnect", (event) => {
      if (isProductProvider(event.provider)) {
        setIsSolomonConnected(event.success);
        setConnecting(false);
        if (event.success) {
          toast.success(`Logged in to ${PRODUCT_NAME}`);
        }
      }
    });
    return cleanup;
  }, []);

  const handleConnect = useCallback(async () => {
    try {
      setConnecting(true);
      const result = await window.ipc.invoke("oauth:connect", { provider: PRODUCT_PROVIDER_ID });
      if (!result.success) {
        toast.error(result.error || `Failed to log in to ${PRODUCT_NAME}`);
        setConnecting(false);
      }
    } catch {
      toast.error(`Failed to log in to ${PRODUCT_NAME}`);
      setConnecting(false);
    }
  }, []);

  const handleDisconnect = useCallback(async () => {
    try {
      setDisconnecting(true);
      const result = await window.ipc.invoke("oauth:disconnect", { provider: PRODUCT_PROVIDER_ID });
      if (result.success) {
        setIsSolomonConnected(false);
        setConfirmingLogout(false);
        toast.success(`Logged out of ${PRODUCT_NAME}`);
      } else {
        toast.error(`Failed to log out of ${PRODUCT_NAME}`);
      }
    } catch {
      toast.error(`Failed to log out of ${PRODUCT_NAME}`);
    } finally {
      setDisconnecting(false);
    }
  }, []);

  if (connectionLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="size-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!isSolomonConnected) {
    return (
      <div className="flex flex-col items-center justify-center py-12 gap-4">
        <div className="flex size-14 items-center justify-center rounded-full bg-muted">
          <User className="size-7 text-muted-foreground" />
        </div>
        <div className="text-center space-y-1">
          <p className="text-sm font-medium">Not logged in</p>
          <p className="text-xs text-muted-foreground">
            Log in to your {PRODUCT_NAME} account to access premium features
          </p>
        </div>
        <Button onClick={handleConnect} disabled={connecting}>
          {connecting ? <Loader2 className="size-4 animate-spin mr-2" /> : null}
          Log in to {PRODUCT_NAME}
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Profile Section */}
      <div className="space-y-4">
        <div className="flex items-center gap-4">
          <div className="flex size-12 items-center justify-center rounded-full bg-primary/10">
            <User className="size-6 text-primary" />
          </div>
          <div className="space-y-0.5">
            <p className="text-sm font-medium">
              {billing?.userEmail ?? (billingNeedsReconnect ? "Session expired" : "Loading...")}
            </p>
            <p className="text-xs text-muted-foreground">
              {billingNeedsReconnect
                ? `Log in again to refresh your ${PRODUCT_NAME} session`
                : `${PRODUCT_NAME} Account`}
            </p>
          </div>
        </div>
      </div>

      <Separator />

      {/* Plan Section */}
      <div className="space-y-3">
        <div className="flex items-center gap-2">
          <CreditCard className="size-4 text-muted-foreground" />
          <h4 className="text-sm font-medium">Plan</h4>
        </div>

        {billingLoading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="size-3 animate-spin" />
            Loading plan details...
          </div>
        ) : billing ? (
          <div className="rounded-none border p-4 space-y-3">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium capitalize">
                  {formatPlanName(billing.subscriptionPlan)}
                </p>
                {billing.subscriptionStatus === "trialing" && billing.trialExpiresAt ? (
                  (() => {
                    const days = Math.max(
                      0,
                      Math.ceil(
                        (new Date(billing.trialExpiresAt).getTime() - Date.now()) /
                          (1000 * 60 * 60 * 24),
                      ),
                    );
                    return (
                      <p className="text-xs text-muted-foreground">
                        Trial ·{" "}
                        {days === 0
                          ? "expires today"
                          : days === 1
                            ? "1 day left"
                            : `${days} days left`}
                      </p>
                    );
                  })()
                ) : billing.subscriptionStatus ? (
                  <p className="text-xs text-muted-foreground capitalize">
                    {billing.subscriptionStatus}
                  </p>
                ) : null}
                {!billing.subscriptionPlan && (
                  <p className="text-xs text-muted-foreground">Subscribe to access AI features</p>
                )}
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={() => appUrl && window.open(`${appUrl}?intent=upgrade`)}
              >
                {!billing.subscriptionPlan
                  ? "Subscribe"
                  : billing.subscriptionPlan === "free"
                    ? "Upgrade"
                    : "Change plan"}
              </Button>
            </div>
            <div className="space-y-3 border-t pt-3">
              <CreditUsageBar label="Plan usage" bucket={billing.monthly} />
              <CreditUsageBar
                label="Daily use"
                bucket={billing.daily}
                helper="Daily usage resets at 00:00 UTC"
              />
            </div>
          </div>
        ) : billingNeedsReconnect ? (
          <div className="rounded-none border border-amber-500/30 bg-amber-500/5 p-4 space-y-3">
            <div className="space-y-1">
              <p className="text-sm font-medium">Log in again to load plan details</p>
              <p className="text-xs text-muted-foreground">
                Your {PRODUCT_NAME} session has expired. Reconnect to refresh billing, usage, and
                payment status.
              </p>
            </div>
            <Button variant="outline" size="sm" onClick={handleConnect} disabled={connecting}>
              {connecting ? <Loader2 className="size-4 animate-spin mr-2" /> : null}
              Log in again
            </Button>
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">Unable to load plan details</p>
        )}
      </div>

      <Separator />

      {/* Payment Section */}
      <div className="space-y-3">
        <div className="flex items-center gap-2">
          <CreditCard className="size-4 text-muted-foreground" />
          <h4 className="text-sm font-medium">Payment</h4>
        </div>
        <p className="text-xs text-muted-foreground">
          Manage invoices, payment methods, and billing details.
        </p>
        <Button
          variant="outline"
          size="sm"
          disabled={!hasPaidSubscription}
          onClick={() => appUrl && window.open(appUrl)}
          className="gap-1.5"
        >
          <ExternalLink className="size-3" />
          Manage in Stripe
        </Button>
        {!hasPaidSubscription && (
          <p className="text-[11px] text-muted-foreground">Upgrade to a paid plan first</p>
        )}
      </div>

      <Separator />

      {/* Log Out Section */}
      <div className="space-y-3">
        <div className="flex items-center gap-2">
          <LogOut className="size-4 text-muted-foreground" />
          <h4 className="text-sm font-medium">Log Out</h4>
        </div>
        <p className="text-xs text-muted-foreground">
          Logging out will remove access to synced data and {PRODUCT_NAME}-provided models.
        </p>
        {confirmingLogout ? (
          <div className="space-y-3 rounded-none border border-destructive/30 bg-destructive/5 p-3">
            <div className="space-y-1">
              <p className="text-sm font-medium">Log out of your {PRODUCT_NAME} account?</p>
              <p className="text-xs text-muted-foreground">
                This will remove access to synced data and {PRODUCT_NAME}-provided models. You can
                log back in at any time.
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setConfirmingLogout(false)}
                disabled={disconnecting}
              >
                Cancel
              </Button>
              <Button
                size="sm"
                onClick={handleDisconnect}
                disabled={disconnecting}
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              >
                {disconnecting ? <Loader2 className="size-4 animate-spin mr-2" /> : null}
                Log Out
              </Button>
            </div>
          </div>
        ) : (
          <Button
            variant="outline"
            size="sm"
            className="text-destructive hover:text-destructive"
            onClick={() => setConfirmingLogout(true)}
          >
            Log Out
          </Button>
        )}
      </div>
    </div>
  );
}
