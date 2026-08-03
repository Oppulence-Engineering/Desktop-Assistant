import { Alert, AlertDescription } from "@oppulence/ui/components/alert";

import { AlertCircle, ArrowRight, KeyRound, ShieldCheck } from "@/lib/icons";
import { Button } from "@oppulence/ui/components/button";
import { PRODUCT_NAME } from "@x/shared/dist/branding.js";
import { MinimalOnboardingLayout } from "./minimal-layout";
import { ProductSignInButton } from "./product-sign-in-button";

interface ProductLoginExperienceProps {
  mode: "onboarding" | "reconnect";
  connected?: boolean;
  connecting?: boolean;
  error?: string | null;
  onProductSignIn: () => void;
  onUseOwnProvider?: () => void;
  onContinueOffline?: () => void;
}

export function ProductLoginExperience({
  mode,
  connected = false,
  connecting = false,
  error,
  onProductSignIn,
  onUseOwnProvider,
  onContinueOffline,
}: ProductLoginExperienceProps) {
  const reconnecting = mode === "reconnect";

  return (
    <MinimalOnboardingLayout
      presentation={reconnecting ? "dialog" : "page"}
      title={
        reconnecting
          ? "Your workspace is right where you left it."
          : "You're 2 clicks away from a workspace that remembers."
      }
      description={
        reconnecting
          ? "Your local memory is safe. Sign in again to restore connected sources and AI actions."
          : "Private local memory for the work you already do."
      }
      chips={
        reconnecting
          ? ["Local data preserved", "Secure reconnect"]
          : ["Local-first context", "Change anytime"]
      }
      panelTitle={reconnecting ? `Sign back in to ${PRODUCT_NAME}` : `Set up ${PRODUCT_NAME}`}
      panelDescription={
        reconnecting
          ? "Your session expired. Sign in again, or keep working with local files and reconnect later."
          : "Choose how the app should access models."
      }
      footer={reconnecting ? undefined : "Sources and memory are configured after model access."}
    >
      <div className="grid gap-2">
        {error ? (
          <Alert
            variant="destructive"
            className="mb-2 border-red-400/25 bg-red-400/10 text-red-100"
          >
            <AlertCircle />
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}

        <ProductSignInButton
          onClick={onProductSignIn}
          connected={connected}
          connecting={connecting}
          label={
            connecting
              ? "Opening secure sign-in…"
              : reconnecting
                ? `Sign in again to ${PRODUCT_NAME}`
                : `Continue with ${PRODUCT_NAME}`
          }
        />

        {reconnecting && onContinueOffline ? (
          <Button
            type="button"
            variant="outline"
            onClick={onContinueOffline}
            disabled={connecting}
            className="group h-11 w-full justify-between rounded-lg border-white/10 bg-white/[0.055] px-3 text-left text-sm text-white/82 shadow-none hover:border-white/18 hover:bg-white/[0.085] hover:text-white focus-visible:border-white/40"
          >
            <span>Continue with local workspace</span>
            <ArrowRight className="size-4 shrink-0 text-white/42 transition-transform group-hover:translate-x-0.5 group-hover:text-white/72" />
          </Button>
        ) : null}

        {!reconnecting && onUseOwnProvider ? (
          <Button
            type="button"
            variant="outline"
            onClick={onUseOwnProvider}
            className="group h-11 w-full justify-between rounded-lg border-white/10 bg-white/[0.055] px-3 text-left text-sm text-white/82 shadow-none hover:border-white/18 hover:bg-white/[0.085] hover:text-white focus-visible:border-white/40"
          >
            <span className="flex min-w-0 items-center gap-2.5">
              <KeyRound className="size-4 shrink-0 text-white/78" />
              <span className="truncate">Bring your own provider</span>
            </span>
            <ArrowRight className="size-4 shrink-0 text-white/42 transition-transform group-hover:translate-x-0.5 group-hover:text-white/72" />
          </Button>
        ) : null}

        {reconnecting ? (
          <div className="mt-2 flex items-start gap-2.5 border border-white/8 bg-white/[0.035] p-3 text-xs leading-5 text-white/50">
            <ShieldCheck className="mt-0.5 size-4 shrink-0 text-emerald-300/80" />
            <p>Your local notes remain on this device. Signing in restores cloud access only.</p>
          </div>
        ) : null}
      </div>
    </MinimalOnboardingLayout>
  );
}
