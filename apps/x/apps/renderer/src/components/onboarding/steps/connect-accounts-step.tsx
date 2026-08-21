import {
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  Link2,
  Loader2,
  Plug,
  ShieldCheck,
} from "@/lib/icons";
import { PRODUCT_NAME } from "@x/shared/branding";
import {
  GOOGLE_BRAND_ICON,
  HUBSPOT_BRAND_ICON,
  WISPR_FLOW_BRAND_ICON,
} from "../brand-icons";
import { MinimalOnboardingLayout } from "../minimal-layout";
import type { OnboardingState } from "../use-onboarding-state";

interface ConnectAccountsStepProps {
  state: OnboardingState;
}

const INTEGRATION_BRAND_ICONS: Record<string, string> = {
  hubspot: HUBSPOT_BRAND_ICON,
  wispr: WISPR_FLOW_BRAND_ICON,
};

function IntegrationBrandIcon({
  integrationName,
  displayName,
}: {
  integrationName: string;
  displayName: string;
}) {
  const brandIcon = INTEGRATION_BRAND_ICONS[integrationName];

  if (brandIcon) {
    return (
      <img
        src={brandIcon}
        alt=""
        aria-hidden="true"
        className="size-9 shrink-0 rounded-lg object-cover"
      />
    );
  }

  return (
    <span
      aria-label={`${displayName} integration`}
      className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-sky-300/[0.09] text-sky-200"
    >
      <Plug className="size-4" />
    </span>
  );
}

export function ConnectAccountsStep({ state }: ConnectAccountsStepProps) {
  const googleState = state.providerStates.google || {
    isConnected: false,
    isLoading: false,
    isConnecting: false,
  };
  const visibleIntegrations = state.integrations.slice(0, 4);
  const readySourceCount =
    1 +
    (googleState.isConnected ? 1 : 0) +
    visibleIntegrations.filter((integration) => integration.connected).length;

  return (
    <MinimalOnboardingLayout
      title={`Choose the context ${PRODUCT_NAME} should remember.`}
      description="Start with the sources you use most. Everything is optional and can be changed later."
      chips={["Step 03 / 04", `${readySourceCount} ready`]}
      panelTitle="Connect sources"
      panelDescription="Recommended sources first. Add the rest anytime."
      panelSize="wide"
      panelAlign="start"
    >
      <div className="grid gap-4">
        <section aria-labelledby="recommended-source-heading">
          <div className="mb-2 flex items-center justify-between gap-3">
            <h3
              id="recommended-source-heading"
              className="font-mono text-[10px] uppercase tracking-[0.18em] text-white/46"
            >
              Recommended first
            </h3>
            <span className="text-[11px] text-white/42">Email + calendar</span>
          </div>

          <div className="rounded-xl border border-red-300/14 bg-gradient-to-br from-red-400/[0.08] to-white/[0.035] p-3.5 shadow-[0_14px_36px_rgba(0,0,0,0.16)]">
            <div className="flex items-start gap-3">
              <img
                src={GOOGLE_BRAND_ICON}
                alt=""
                aria-hidden="true"
                className="size-10 shrink-0 rounded-lg object-cover"
              />
              <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <div className="text-sm font-semibold text-white/92">Google Workspace</div>
                    <div className="mt-0.5 text-xs text-white/52">Gmail and Calendar context</div>
                  </div>
                  {googleState.isConnected && (
                    <span className="flex items-center gap-1 text-[11px] font-medium text-emerald-300">
                      <CheckCircle2 className="size-3.5" />
                      Connected
                    </span>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => state.handleConnect("google")}
                  disabled={googleState.isConnecting || googleState.isConnected}
                  className="mt-3 flex h-9 w-full items-center justify-center gap-2 rounded-lg border border-white/12 bg-white/[0.075] px-3 text-sm font-medium text-white/88 transition-colors hover:border-white/24 hover:bg-white/[0.11] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/35 disabled:pointer-events-none disabled:opacity-65"
                >
                  {googleState.isConnecting ? (
                    <>
                      <Loader2 className="size-4 animate-spin" />
                      Connecting
                    </>
                  ) : googleState.isConnected ? (
                    <>
                      <CheckCircle2 className="size-4 text-emerald-300" />
                      Connected
                    </>
                  ) : (
                    <>
                      <Link2 className="size-4" />
                      Connect Google
                    </>
                  )}
                </button>
              </div>
            </div>
          </div>
        </section>

        <div className="flex items-center gap-3 rounded-xl border border-emerald-300/16 bg-emerald-300/[0.055] p-3">
          <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-emerald-300/10 text-emerald-300">
            <ShieldCheck className="size-[18px]" />
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <div className="truncate text-sm font-semibold text-white/90">
                {PRODUCT_NAME} Meeting Notes
              </div>
              <span className="rounded-full border border-emerald-300/18 bg-emerald-300/10 px-2 py-0.5 text-[10px] font-medium text-emerald-300">
                Built in
              </span>
            </div>
            <p className="mt-1 truncate text-xs text-white/52">Private capture and summaries are ready.</p>
          </div>
          <CheckCircle2 className="size-[18px] shrink-0 text-emerald-300" />
        </div>

        <section aria-labelledby="more-sources-heading">
          <div className="mb-2 flex items-center justify-between gap-3">
            <h3
              id="more-sources-heading"
              className="font-mono text-[10px] uppercase tracking-[0.18em] text-white/46"
            >
              More work surfaces
            </h3>
            <span className="text-[11px] text-white/42">Add anytime</span>
          </div>

          <div className="divide-y divide-white/8 overflow-hidden rounded-xl border border-white/10 bg-white/[0.035]">
            {state.integrationsLoading ? (
              <div className="flex h-20 items-center justify-center gap-2 text-xs text-white/42">
                <Loader2 className="size-4 animate-spin" />
                Loading integrations
              </div>
            ) : (
              visibleIntegrations.map((integration) => {
                const isBusy = state.integrationConnecting[integration.name] ?? false;
                return (
                  <div
                    key={integration.name}
                    className="grid grid-cols-[36px_minmax(0,1fr)_auto] items-center gap-3 px-3 py-2.5 transition-colors hover:bg-white/[0.035]"
                  >
                    <IntegrationBrandIcon
                      integrationName={integration.name}
                      displayName={integration.displayName}
                    />
                    <div className="min-w-0">
                      <div className="truncate text-sm font-medium text-white/86">
                        {integration.displayName}
                      </div>
                      <div className="mt-0.5 truncate text-[11px] text-white/48">
                        {integration.description}
                      </div>
                    </div>
                    <button
                      type="button"
                      aria-label={`Connect ${integration.displayName}`}
                      onClick={() => state.handleConnectIntegration(integration)}
                      disabled={integration.connected || isBusy}
                      className="flex h-8 min-w-[82px] items-center justify-center gap-1.5 rounded-lg border border-white/10 bg-white/[0.055] px-2.5 text-xs font-medium text-white/74 transition-colors hover:border-white/20 hover:bg-white/[0.09] hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/35 disabled:pointer-events-none disabled:opacity-60"
                    >
                      {isBusy ? (
                        <>
                          <Loader2 className="size-3.5 animate-spin" />
                          Wait
                        </>
                      ) : integration.connected ? (
                        <>
                          <CheckCircle2 className="size-3.5 text-emerald-300" />
                          Added
                        </>
                      ) : (
                        <>
                          <Link2 className="size-3.5" />
                          Connect
                        </>
                      )}
                    </button>
                  </div>
                );
              })
            )}
          </div>
        </section>

        <div className="grid grid-cols-[auto_1fr] gap-2 pt-0.5">
          <button
            type="button"
            onClick={state.handleBack}
            className="flex h-11 items-center gap-2 rounded-lg border border-white/10 px-3 text-sm font-medium text-white/58 transition-colors hover:border-white/20 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/35"
          >
            <ArrowLeft className="size-4" />
            Back
          </button>
          <button
            type="button"
            onClick={state.handleNext}
            className="flex h-11 items-center justify-center gap-2 rounded-lg bg-white px-3 text-sm font-semibold text-black shadow-[0_8px_24px_rgba(255,255,255,0.08)] transition-all hover:-translate-y-px hover:bg-white/92 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/50"
          >
            Continue
            <ArrowRight className="size-4" />
          </button>
        </div>

        <div className="flex items-center justify-center gap-1.5 text-[11px] text-white/44">
          <ShieldCheck className="size-3.5" />
          Sources are optional and stay under your control.
        </div>
      </div>
    </MinimalOnboardingLayout>
  );
}
