import type { Server } from "http";
import { createAuthServer } from "./auth-server.js";
import { DEFAULT_CALLBACK_PORT } from "@x/core/auth/client-repo";
import * as oauthClient from "@x/core/auth/oauth-client";
import type { Configuration } from "@x/core/auth/oauth-client";
import { getProviderConfig, getAvailableProviders } from "@x/core/auth/providers";
import container from "@x/core/di/container";
import { IOAuthRepo } from "@x/core/auth/repo";
import { IClientRegistrationRepo } from "@x/core/auth/client-repo";
import { triggerSync as triggerGmailSync } from "@x/core/knowledge/sync_gmail";
import { triggerSync as triggerCalendarSync } from "@x/core/knowledge/sync_calendar";
import { triggerSync as triggerFirefliesSync } from "@x/core/knowledge/sync_fireflies";
import { emitOAuthEvent } from "./ipc.js";
import { openTrustedExternal } from "./external-url.js";
import { getBillingInfo } from "@x/core/billing/billing";
import {
  capture as analyticsCapture,
  identify as analyticsIdentify,
  reset as analyticsReset,
} from "@x/core/analytics/posthog";
import { isSignedIn } from "@x/core/account/account";
import { startGoogleConnectViaBackend } from "@x/core/auth/google-backend-oauth";
import { invalidateCopilotInstructionsCache } from "@x/core/application/assistant/instructions";
import { claimTokensViaBackend } from "@x/core/auth/google-backend-oauth";
import type { OAuthTokens } from "@x/core/auth/types";
import {
  startConnectorViaBackend,
  claimConnectorViaBackend,
} from "@x/core/connectors/connectors-backend";
import {
  slackStartURL,
  claimSlackWorkspaceViaBackend,
} from "@x/core/auth/slack-backend-oauth";
import { getWorkosLoginUrl, exchangeWorkosCode } from "@x/core/auth/workos-backend";
import { PRODUCT_PROVIDER_ID, isProductProvider } from "@x/shared/branding";
import { isManagedAuthMode } from "@x/core/auth/repo";
import {
  reportRelationshipSourceAuthorization,
  resyncRelationshipSource,
} from "@x/core/relationships/client";

function buildRedirectUri(port: number): string {
  return `http://localhost:${port}/oauth/callback`;
}

const REDIRECT_URI = buildRedirectUri(DEFAULT_CALLBACK_PORT);

async function recordRelationshipSourceAuthorization(event: {
  provider: string;
  success: boolean;
  error?: string;
  sourceAccountId?: string;
  grantedScopes?: string[];
}): Promise<void> {
  const source = ["gmail", "calendar", "google"].includes(event.provider)
    ? "google"
    : event.provider;
  if (!["google", "slack", "hubspot"].includes(source)) return;
  try {
    const canceled = /cancel|denied|access_denied/i.test(event.error || "");
    const defaultReadScopes: Record<string, string[]> = {
      google: [
        "https://www.googleapis.com/auth/gmail.readonly",
        "https://www.googleapis.com/auth/calendar.events.readonly",
      ],
      slack: ["channels:history", "channels:read", "users:read"],
      hubspot: [
        "crm.objects.companies.read",
        "crm.objects.contacts.read",
        "crm.objects.deals.read",
      ],
    };
    const status = await reportRelationshipSourceAuthorization(source, {
      sourceAccountId: event.sourceAccountId || "default",
      state: event.success ? "completed" : canceled ? "canceled" : "failed",
      grantedScopes: event.success ? event.grantedScopes || defaultReadScopes[source] : undefined,
      errorCode: event.success ? undefined : "authorization_failed",
    });
    if (event.success) {
      await resyncRelationshipSource(source, status.sourceAccountId);
    }
  } catch {
    // Connector ownership must remain independent from relationship telemetry
    // availability. The next provider observation reconciles this state.
    console.warn(`[Relationships] could not record ${source} consent lifecycle`);
  }
}

async function beginRelationshipSourceAuthorization(provider: string): Promise<void> {
  const source = ["gmail", "calendar", "google"].includes(provider) ? "google" : provider;
  if (!["google", "slack", "hubspot"].includes(source)) return;
  try {
    await reportRelationshipSourceAuthorization(source, {
      sourceAccountId: "default",
      state: "started",
    });
  } catch {
    console.warn(`[Relationships] could not record ${source} consent start`);
  }
}

/** Top-level openid-client messages that often wrap a more specific cause. */
const OPAQUE_OAUTH_TOP_MESSAGES = new Set(["invalid response encountered"]);

function firstCauseMessage(error: unknown): string | undefined {
  if (error == null || typeof error !== "object" || !("cause" in error)) {
    return undefined;
  }
  const cause = (error as { cause?: unknown }).cause;
  if (cause instanceof Error && cause.message.trim()) {
    return cause.message;
  }
  if (typeof cause === "string" && cause.trim()) {
    return cause;
  }
  return undefined;
}

/**
 * User-facing message for token-exchange failures. Prefer the first cause message when
 * the top-level message is opaque (common for openid-client) or when code is OAUTH_INVALID_RESPONSE.
 * The catch block below still logs the full cause chain for any error; this helper stays conservative.
 */
function getOAuthErrorMessage(error: unknown): string {
  const msg = error instanceof Error ? error.message : "Unknown error";
  const code =
    error != null && typeof error === "object" && "code" in error
      ? (error as { code?: string }).code
      : undefined;
  const causeMsg = firstCauseMessage(error);
  if (code === "OAUTH_INVALID_RESPONSE" && causeMsg) {
    return causeMsg;
  }
  if (causeMsg && OPAQUE_OAUTH_TOP_MESSAGES.has(msg.trim().toLowerCase())) {
    return causeMsg;
  }
  return msg;
}

// Store active OAuth flows (state -> { codeVerifier, provider, config })
const activeFlows = new Map<
  string,
  {
    codeVerifier: string;
    provider: string;
    config: Configuration;
  }
>();

// Module-level state for tracking the active OAuth flow
interface ActiveOAuthFlow {
  provider: string;
  state: string;
  server: Server;
  cleanupTimeout: NodeJS.Timeout;
}

let activeFlow: ActiveOAuthFlow | null = null;

/**
 * Cancel any active OAuth flow, cleaning up resources
 */
function cancelActiveFlow(reason: string = "cancelled"): void {
  if (!activeFlow) {
    return;
  }

  console.log(`[OAuth] Cancelling active flow for ${activeFlow.provider}: ${reason}`);

  clearTimeout(activeFlow.cleanupTimeout);
  activeFlow.server.close();
  activeFlows.delete(activeFlow.state);

  // Only emit event for user-visible cancellations
  if (reason !== "new_flow_started") {
    void recordRelationshipSourceAuthorization({
      provider: activeFlow.provider,
      success: false,
      error: `OAuth flow ${reason}`,
    });
    emitOAuthEvent({
      provider: activeFlow.provider,
      success: false,
      error: `OAuth flow ${reason}`,
    });
  }

  activeFlow = null;
}

/**
 * Get OAuth repository from DI container
 */
function getOAuthRepo(): IOAuthRepo {
  return container.resolve<IOAuthRepo>("oauthRepo");
}

/**
 * Get client registration repository from DI container
 */
function getClientRegistrationRepo(): IClientRegistrationRepo {
  return container.resolve<IClientRegistrationRepo>("clientRegistrationRepo");
}

/**
 * Get or create OAuth configuration for a provider.
 * `redirectUri` is required for DCR providers — it is the actual callback URI
 * (including port) that was just bound, so the registration and auth URL stay in sync.
 */
async function getProviderConfiguration(
  provider: string,
  redirectUri: string = buildRedirectUri(DEFAULT_CALLBACK_PORT),
  credentialsOverride?: { clientId: string; clientSecret: string },
): Promise<Configuration> {
  const config = await getProviderConfig(provider);
  const resolveClientCredentials = async (): Promise<{
    clientId: string;
    clientSecret?: string;
  }> => {
    if (config.client.mode === "static" && config.client.clientId) {
      return { clientId: config.client.clientId, clientSecret: credentialsOverride?.clientSecret };
    }
    if (credentialsOverride) {
      return {
        clientId: credentialsOverride.clientId,
        clientSecret: credentialsOverride.clientSecret,
      };
    }
    const oauthRepo = getOAuthRepo();
    const connection = await oauthRepo.read(provider);
    if (connection.clientId) {
      return { clientId: connection.clientId, clientSecret: connection.clientSecret ?? undefined };
    }
    throw new Error(`${provider} client ID not configured. Please provide a client ID.`);
  };

  if (config.discovery.mode === "issuer") {
    if (config.client.mode === "static") {
      // Discover endpoints, use static client ID
      console.log(`[OAuth] ${provider}: Discovery from issuer with static client ID`);
      const { clientId, clientSecret } = await resolveClientCredentials();
      return await oauthClient.discoverConfiguration(
        config.discovery.issuer,
        clientId,
        clientSecret,
      );
    } else {
      // DCR mode - check for existing registration or register new
      console.log(`[OAuth] ${provider}: Discovery from issuer with DCR`);
      const clientRepo = getClientRegistrationRepo();
      const existingRegistration = await clientRepo.getClientRegistration(provider);

      if (existingRegistration) {
        console.log(`[OAuth] ${provider}: Using existing DCR registration`);
        return await oauthClient.discoverConfiguration(
          config.discovery.issuer,
          existingRegistration.client_id,
        );
      }

      // Register new client with the actual redirect URI (port already bound)
      const scopes = config.scopes || [];
      const { config: oauthConfig, registration } = await oauthClient.registerClient(
        config.discovery.issuer,
        [redirectUri],
        scopes,
      );

      // Parse port from redirectUri (e.g. "http://localhost:8081/...") and save
      const boundPort = new URL(redirectUri).port
        ? parseInt(new URL(redirectUri).port, 10)
        : DEFAULT_CALLBACK_PORT;
      await clientRepo.saveClientRegistration(provider, registration, boundPort);
      console.log(`[OAuth] ${provider}: DCR registration saved (port ${boundPort})`);

      return oauthConfig;
    }
  } else {
    // Static endpoints mode
    if (config.client.mode !== "static") {
      throw new Error('DCR requires discovery mode "issuer", not "static"');
    }

    console.log(`[OAuth] ${provider}: Using static endpoints (no discovery)`);
    const { clientId, clientSecret } = await resolveClientCredentials();
    return oauthClient.createStaticConfiguration(
      config.discovery.authorizationEndpoint,
      config.discovery.tokenEndpoint,
      clientId,
      config.discovery.revocationEndpoint,
      clientSecret,
    );
  }
}

/**
 * Solomon AI sign-in via the API WorkOS broker. The desktop runs the
 * browser authorize + PKCE and the loopback callback; the API completes the
 * confidential code exchange (it holds the WorkOS API key) and returns tokens.
 */
async function connectSolomonViaBroker(): Promise<{ success: boolean; error?: string }> {
  const oauthRepo = getOAuthRepo();
  const { verifier: codeVerifier, challenge: codeChallenge } = await oauthClient.generatePKCE();
  const state = oauthClient.generateState();

  // The API builds the WorkOS AuthKit authorize URL (keeps WorkOS's
  // endpoint layout server-side).
  const loginUrl = await getWorkosLoginUrl(REDIRECT_URI, state, codeChallenge);

  let callbackHandled = false;
  const { server } = await createAuthServer(8080, async (callbackUrl) => {
    if (callbackHandled) return;
    callbackHandled = true;

    // ... (ERRORS.md E44) Sign-in denial / provider error — fail fast with the
    // provider's description instead of waiting for the abandoned-flow timeout.
    const callbackError = callbackUrl.searchParams.get("error");
    if (callbackError) {
      const description = callbackUrl.searchParams.get("error_description") || callbackError;
      console.error(`[OAuth] Solomon AI sign-in error: ${description}`);
      emitOAuthEvent({ provider: PRODUCT_PROVIDER_ID, success: false, error: description });
      if (activeFlow && activeFlow.state === state) {
        clearTimeout(activeFlow.cleanupTimeout);
        activeFlow.server.close();
        activeFlow = null;
      }
      return;
    }

    const receivedState = callbackUrl.searchParams.get("state");
    if (!receivedState || receivedState !== state) {
      throw new Error("Invalid state parameter - possible CSRF attack");
    }
    const code = callbackUrl.searchParams.get("code");
    if (!code) {
      throw new Error("OAuth callback missing authorization code");
    }

    try {
      console.log("[OAuth] Exchanging WorkOS code via Solomon AI API broker...");
      const tokens = await exchangeWorkosCode(code, codeVerifier);
      await oauthRepo.upsert(PRODUCT_PROVIDER_ID, { tokens, error: null });
      console.log("[OAuth] Solomon AI sign-in successful");

      // Ensure user + Stripe customer exist before notifying the renderer.
      let signedInUserId: string | undefined;
      try {
        const billing = await getBillingInfo();
        if (billing.userId) {
          signedInUserId = billing.userId;
          analyticsIdentify(billing.userId, {
            ...(billing.userEmail ? { email: billing.userEmail } : {}),
            plan: billing.subscriptionPlan,
            status: billing.subscriptionStatus,
          });
          analyticsCapture("user_signed_in", {
            plan: billing.subscriptionPlan,
            status: billing.subscriptionStatus,
          });
        }
      } catch (meError) {
        console.error("[OAuth] Failed to initialize user via /v1/me:", meError);
      }

      emitOAuthEvent({
        provider: PRODUCT_PROVIDER_ID,
        success: true,
        ...(signedInUserId ? { userId: signedInUserId } : {}),
      });
    } catch (error) {
      console.error("[OAuth] Solomon AI sign-in failed:", error);
      emitOAuthEvent({
        provider: PRODUCT_PROVIDER_ID,
        success: false,
        error: error instanceof Error ? error.message : "Sign-in failed",
      });
      throw error;
    } finally {
      if (activeFlow && activeFlow.state === state) {
        clearTimeout(activeFlow.cleanupTimeout);
        activeFlow.server.close();
        activeFlow = null;
      }
    }
  });

  const cleanupTimeout = setTimeout(
    () => {
      if (activeFlow?.state === state) {
        console.log("[OAuth] Cleaning up abandoned Solomon AI sign-in (timeout)");
        cancelActiveFlow("timed_out");
      }
    },
    2 * 60 * 1000,
  );

  activeFlow = { provider: PRODUCT_PROVIDER_ID, state, server, cleanupTimeout };

  void openTrustedExternal(loginUrl);
  return { success: true };
}

/**
 * Determine which port to start the OAuth callback server on for a DCR provider.
 *
 * If the provider has an existing registration, probes the port it was registered
 * on. If that port is still available, returns it so the existing client_id keeps
 * working. If it is blocked, clears the stale registration (forcing re-registration
 * on the next available port) and returns DEFAULT_CALLBACK_PORT as the scan base.
 *
 * Exported for unit testing.
 */
export async function resolveStartPort(
  provider: string,
  clientRepo: IClientRegistrationRepo,
): Promise<number> {
  const existingReg = await clientRepo.getClientRegistration(provider);
  if (!existingReg) return DEFAULT_CALLBACK_PORT;

  const registeredPort = await clientRepo.getRegisteredPort(provider);
  try {
    // Probe — fixed-port (no fallback) so we know whether the exact registered port is free
    const probe = await createAuthServer(registeredPort, () => {
      /* probe */
    });
    probe.server.close();
    console.log(`[OAuth] ${provider}: registered port ${registeredPort} still available`);
    return registeredPort;
  } catch {
    console.log(
      `[OAuth] ${provider}: registered port ${registeredPort} blocked, clearing DCR registration`,
    );
    await clientRepo.clearClientRegistration(provider);
    return DEFAULT_CALLBACK_PORT;
  }
}

/**
 * Initiate OAuth flow for a provider
 */
export async function connectProvider(
  provider: string,
  credentials?: { clientId: string; clientSecret: string },
): Promise<{ success: boolean; error?: string }> {
  try {
    console.log(`[OAuth] Starting connection flow for ${provider}...`);
    await beginRelationshipSourceAuthorization(provider);

    // Cancel any existing flow before starting a new one
    cancelActiveFlow("new_flow_started");

    // Solomon AI sign-in goes through the WorkOS broker in the API (WorkOS is
    // a confidential client; the desktop can't hold the API key). The browser
    // authorize + PKCE happen here; the code exchange is server-side.
    if (isProductProvider(provider)) {
      return await connectSolomonViaBroker();
    }

    const oauthRepo = getOAuthRepo();
    const providerConfig = await getProviderConfig(provider);

    if (provider === "google") {
      if (!credentials?.clientId || !credentials?.clientSecret) {
        // No credentials → managed mode if the user is signed in to Solomon AI
        // (we use the company-owned Google client via the api + webapp).
        // Otherwise it's BYOK with missing creds → error.
        if (await isSignedIn()) {
          try {
            // Ask the api for the authorize URL rather than guessing a path.
            // This previously opened `<webapp>/oauth/google/start`, which the
            // webapp has never served since the flow moved to the api — the
            // browser landed on a 404 while this returned success, so the app
            // reported a connect it had not started.
            const authorizeUrl = await startGoogleConnectViaBackend();
            await openTrustedExternal(authorizeUrl);
            console.log("[OAuth] Started Oppulence-managed Google connect (browser opened)");
            // Belt and braces: the api will deep-link back when it finishes,
            // but that depends on owning the URL scheme. Poll for the same
            // tokens so the connect still completes when it does not.
            const state = new URL(authorizeUrl).searchParams.get("state");
            if (state) void pollForGoogleConnect(state);
            return { success: true };
          } catch (error) {
            console.error("[OAuth] Failed to start Oppulence-managed Google connect:", error);
            return {
              success: false,
              error:
                error instanceof Error ? error.message : "Couldn't start Google setup.",
            };
          }
        }
        return {
          success: false,
          error: "Google client ID and client secret are required to connect.",
        };
      }
    }

    // For static-client providers (Google BYOK) the redirect URI is pre-registered
    // at the OAuth provider console on a fixed port — we must not scan.
    // For DCR providers, resolveStartPort handles the re-registration trap.
    const isStaticClient = providerConfig.client.mode === "static";
    const startPort = isStaticClient
      ? DEFAULT_CALLBACK_PORT
      : await resolveStartPort(provider, getClientRegistrationRepo());

    // --- Callback server ---
    // Declare `state` before the closure so the callback can close over its binding.
    // The variable is assigned below, before shell.openExternal, so it is always
    // set by the time any browser request arrives.
    let state = "";
    let callbackHandled = false;

    const { server, port: boundPort } = await createAuthServer(
      startPort,
      async (callbackUrl) => {
        // Guard against duplicate callbacks (browser may send multiple requests)
        if (callbackHandled) return;
        callbackHandled = true;

        // ... (ERRORS.md E44) Consent denial / provider error — fail fast with the
        // provider's description instead of waiting for the abandoned-flow timeout.
        const callbackError = callbackUrl.searchParams.get("error");
        if (callbackError) {
          const description = callbackUrl.searchParams.get("error_description") || callbackError;
          console.error(`[OAuth] ${provider} authorization error: ${description}`);
          await recordRelationshipSourceAuthorization({
            provider,
            success: false,
            error: description,
          });
          emitOAuthEvent({ provider, success: false, error: description });
          activeFlows.delete(state);
          if (activeFlow && activeFlow.state === state) {
            clearTimeout(activeFlow.cleanupTimeout);
            activeFlow.server.close();
            activeFlow = null;
          }
          return;
        }

        const receivedState = callbackUrl.searchParams.get("state");
        if (receivedState == null || receivedState === "") {
          throw new Error(
            "OAuth callback missing state parameter. Complete sign-in in the browser or check the redirect URI.",
          );
        }
        if (receivedState !== state) {
          throw new Error("Invalid state parameter - possible CSRF attack");
        }

        const flow = activeFlows.get(state);
        if (!flow || flow.provider !== provider) {
          throw new Error("Invalid OAuth flow state");
        }

        try {
          // Use full callback URL (includes iss, scope, etc.) so openid-client validation succeeds
          console.log(`[OAuth] Exchanging authorization code for tokens (${provider})...`);
          const tokens = await oauthClient.exchangeCodeForTokens(
            flow.config,
            callbackUrl,
            flow.codeVerifier,
            state,
          );

          // Save tokens and credentials. For Google, BYOK is the only path
          // that reaches this token exchange (managed path returns above
          // before any local server runs); stamp mode: 'byok' so a future
          // refresh / reconnect can't get confused with a managed entry.
          console.log(`[OAuth] Token exchange successful for ${provider}`);
          await oauthRepo.upsert(provider, {
            tokens,
            ...(credentials
              ? { clientId: credentials.clientId, clientSecret: credentials.clientSecret }
              : {}),
            ...(provider === "google" ? { mode: "byok" as const } : {}),
            error: null,
          });

          // Trigger immediate sync for relevant providers
          if (provider === "google") {
            triggerGmailSync();
            triggerCalendarSync();
          } else if (provider === "fireflies-ai") {
            triggerFirefliesSync();
          }

          // For Solomon AI sign-in, ensure user + Stripe customer exist before
          // notifying the renderer. Without this, parallel API calls from
          // multiple renderer hooks race to create the user, causing duplicates.
          let signedInUserId: string | undefined;
          if (isProductProvider(provider)) {
            try {
              const billing = await getBillingInfo();
              if (billing.userId) {
                signedInUserId = billing.userId;
                analyticsIdentify(billing.userId, {
                  ...(billing.userEmail ? { email: billing.userEmail } : {}),
                  plan: billing.subscriptionPlan,
                  status: billing.subscriptionStatus,
                });
                analyticsCapture("user_signed_in", {
                  plan: billing.subscriptionPlan,
                  status: billing.subscriptionStatus,
                });
              }
            } catch (meError) {
              console.error("[OAuth] Failed to initialize user via /v1/me:", meError);
            }
          }

          await recordRelationshipSourceAuthorization({
            provider,
            success: true,
            grantedScopes: tokens.scopes,
          });

          // Emit success event to renderer
          emitOAuthEvent({
            provider,
            success: true,
            ...(signedInUserId ? { userId: signedInUserId } : {}),
          });
        } catch (error) {
          console.error("OAuth token exchange failed:", error);
          // Log cause chain for debugging (e.g. OAUTH_INVALID_RESPONSE -> OperationProcessingError)
          let cause: unknown = error;
          while (cause != null && typeof cause === "object" && "cause" in cause) {
            cause = (cause as { cause?: unknown }).cause;
            if (cause != null) {
              console.error("[OAuth] Caused by:", cause);
            }
          }
          const errorMessage = getOAuthErrorMessage(error);
          await recordRelationshipSourceAuthorization({
            provider,
            success: false,
            error: errorMessage,
          });
          emitOAuthEvent({ provider, success: false, error: errorMessage });
          throw error;
        } finally {
          // Clean up
          activeFlows.delete(state);
          if (activeFlow && activeFlow.state === state) {
            clearTimeout(activeFlow.cleanupTimeout);
            activeFlow.server.close();
            activeFlow = null;
          }
        }
      },
      // Static providers (Google BYOK) keep fixed-port behaviour to match the
      // pre-registered redirect URI at the provider's console. DCR providers
      // can fall back since we register the actual bound port below.
      { fallback: !isStaticClient },
    );

    // Server is bound. Any throw between here and `activeFlow = ...` would
    // leak the port — `cancelActiveFlow` only closes it once activeFlow is set.
    try {
      // TOCTOU guard: resolveStartPort probed the registered port and found it
      // free, but the port could have been grabbed between probe and real bind,
      // causing fallback to a different port. The cached client_id is registered
      // for the old port — clear it so getProviderConfiguration re-registers
      // with the actual bound port.
      if (!isStaticClient && boundPort !== startPort) {
        console.log(
          `[OAuth] ${provider}: bound port ${boundPort} differs from start port ${startPort}, clearing stale DCR registration`,
        );
        await getClientRegistrationRepo().clearClientRegistration(provider);
      }

      const redirectUri = buildRedirectUri(boundPort);
      const config = await getProviderConfiguration(provider, redirectUri, credentials);

      const { verifier: codeVerifier, challenge: codeChallenge } = await oauthClient.generatePKCE();
      state = oauthClient.generateState();

      const scopes = providerConfig.scopes || [];
      activeFlows.set(state, { codeVerifier, provider, config });

      const authUrl = oauthClient.buildAuthorizationUrl(config, {
        redirect_uri: redirectUri,
        scope: scopes.join(" "),
        code_challenge: codeChallenge,
        state,
      });

      // Set timeout to clean up abandoned flows (2 minutes)
      const cleanupTimeout = setTimeout(
        () => {
          if (activeFlow?.state === state) {
            console.log(`[OAuth] Cleaning up abandoned OAuth flow for ${provider} (timeout)`);
            cancelActiveFlow("timed_out");
          }
        },
        2 * 60 * 1000,
      );

      activeFlow = {
        provider,
        state,
        server,
        cleanupTimeout,
      };

      // Open in system browser (shares cookies/sessions with user's regular browser)
      void openTrustedExternal(authUrl.toString());

      return { success: true };
    } catch (setupError) {
      // Post-bind setup failed — close the server so the port is released and
      // a retry isn't blocked by our own zombie listener.
      server.close();
      if (state) {
        activeFlows.delete(state);
      }
      throw setupError;
    }
  } catch (error) {
    console.error("OAuth connection failed:", error);
    await recordRelationshipSourceAuthorization({
      provider,
      success: false,
      error: error instanceof Error ? error.message : "OAuth connection failed",
    });
    return {
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}

/**
 * Complete a Solomon AI-managed Google connect: claim the tokens parked under
 * `state` by the webapp callback, persist them locally, and trigger sync.
 *
 * Called by the deep-link dispatcher (deeplink.ts) when the OS hands us a
 * solomon-ai://oauth/google/done?session=<state> URL.
 */
async function persistGoogleConnect(tokens: OAuthTokens): Promise<void> {
  const oauthRepo = getOAuthRepo();
  await oauthRepo.upsert("google", {
    tokens,
    mode: PRODUCT_PROVIDER_ID,
    // Explicitly null these — no client_id/secret on the desktop in this mode.
    clientId: null,
    clientSecret: null,
    error: null,
  });
  triggerGmailSync();
  triggerCalendarSync();
  await recordRelationshipSourceAuthorization({
    provider: "google",
    success: true,
    grantedScopes: tokens.scopes,
  });
  emitOAuthEvent({ provider: "google", success: true, grantedScopes: tokens.scopes });
  console.log("[OAuth] Solomon AI-managed Google connect complete");
}

/** Whether a managed Google connect has already landed tokens on disk. */
async function googleConnectLanded(): Promise<boolean> {
  try {
    const connection = await getOAuthRepo().read("google");
    return Boolean(connection?.tokens?.access_token);
  } catch {
    return false;
  }
}

const CLAIM_POLL_INTERVAL_MS = 2_000;
// Long enough to cover picking an account, a password, and 2FA.
const CLAIM_POLL_TIMEOUT_MS = 5 * 60_000;

/**
 * Wait for the api to park tokens under `state`, then finish the connect.
 *
 * The deep link is the fast path, but it only works when this app owns the URL
 * scheme, and that is not something the app can assume:
 *
 *   - Dev builds on macOS deliberately never register it (see main.ts), because
 *     registering would steal the scheme from the user's installed app. The
 *     consequence is that a locally-run build could not complete a Google
 *     connect at all, which is exactly what exercising a real mailbox against
 *     the local stack requires.
 *   - Any stale copy of the app can hold the LaunchServices claim — an old DMG
 *     still mounted, a second install, a build someone ran once. The OS then
 *     hands the callback to a process that has never heard of this `state`.
 *
 * In both cases the browser half succeeds and the tokens sit parked forever
 * while the app reports "credentials not available", with nothing pointing at
 * the URL scheme as the cause.
 *
 * Claiming is one-shot, so whichever path gets there first wins and the other
 * finds nothing left to take — polling alongside a working deep link is safe.
 */
async function pollForGoogleConnect(state: string): Promise<void> {
  const deadline = Date.now() + CLAIM_POLL_TIMEOUT_MS;
  while (Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, CLAIM_POLL_INTERVAL_MS));
    // The deep link may have completed this already.
    if (await googleConnectLanded()) return;
    try {
      await persistGoogleConnect(await claimTokensViaBackend(state));
      console.log("[OAuth] Completed Google connect by polling (no deep link)");
      return;
    } catch {
      // Nothing parked yet — the user is still in the browser — or the deep
      // link claimed it first. Both are ordinary; keep waiting.
    }
  }
  console.log("[OAuth] Gave up waiting for Google connect tokens");
}

export async function completeSolomonGoogleConnect(state: string): Promise<void> {
  try {
    console.log("[OAuth] Claiming Solomon AI-managed Google tokens...");
    await persistGoogleConnect(await claimTokensViaBackend(state));
  } catch (error) {
    console.error("[OAuth] Failed to complete Solomon AI-managed Google connect:", error);
    await recordRelationshipSourceAuthorization({
      provider: "google",
      success: false,
      error: error instanceof Error ? error.message : "Failed to claim Google tokens",
    });
    emitOAuthEvent({
      provider: "google",
      success: false,
      error: error instanceof Error ? error.message : "Failed to claim Google tokens",
    });
  }
}

/**
 * Begin a rowboat-api connector OAuth connect: ask the api for the provider
 * authorize URL (which binds a pending ticket to this user) and open it in the
 * system browser. The browser completes at the api callback, which parks the
 * grant and deep-links back to solomon-ai://connection-complete?...&session=...,
 * where completeConnectorConnect redeems it.
 */
export async function connectConnector(
  connector: string,
): Promise<{ success: boolean; error?: string }> {
  try {
    await beginRelationshipSourceAuthorization(connector);
    const authorizeUrl = await startConnectorViaBackend(connector);
    await openTrustedExternal(authorizeUrl);
    return { success: true };
  } catch (error) {
    console.error(`[Connectors] start ${connector} failed:`, error);
    await recordRelationshipSourceAuthorization({
      provider: connector,
      success: false,
      error: error instanceof Error ? error.message : "Failed to start connector connect",
    });
    return {
      success: false,
      error: error instanceof Error ? error.message : "Failed to start connector connect",
    };
  }
}

/**
 * Complete a connector connect by claiming the grant the api callback parked
 * under `state`. Persistence happens server-side (the api verifies this user is
 * the one who started the flow); we only surface success/failure to the renderer.
 *
 * Called by the deep-link dispatcher (deeplink.ts) on
 * solomon-ai://connection-complete?connector=<name>&status=success&session=<state>.
 */
export async function completeConnectorConnect(connector: string, state: string): Promise<void> {
  try {
    console.log(`[Connectors] claiming ${connector} grant...`);
    await claimConnectorViaBackend(connector, state);
    invalidateCopilotInstructionsCache();
    await recordRelationshipSourceAuthorization({ provider: connector, success: true });
    emitOAuthEvent({ provider: connector, success: true });
    console.log(`[Connectors] ${connector} connect complete`);
  } catch (error) {
    console.error(`[Connectors] failed to claim ${connector}:`, error);
    await recordRelationshipSourceAuthorization({
      provider: connector,
      success: false,
      error: error instanceof Error ? error.message : "Failed to claim connector grant",
    });
    emitOAuthEvent({
      provider: connector,
      success: false,
      error: error instanceof Error ? error.message : "Failed to claim connector grant",
    });
  }
}

/**
 * Begin a Slack workspace install: open the api's browser-facing front door.
 * The api runs the OAuth v2 dance (it holds the client secret), parks the
 * sealed bundle, and deep-links back to
 * solomon-ai://oauth/slack/done?session=<state>&status=success, where
 * completeSolomonSlackConnect redeems it.
 */
export async function connectSlackWorkspace(): Promise<{ success: boolean; error?: string }> {
  try {
    await beginRelationshipSourceAuthorization("slack");
    await openTrustedExternal(slackStartURL());
    return { success: true };
  } catch (error) {
    console.error("[Slack] start workspace install failed:", error);
    await recordRelationshipSourceAuthorization({
      provider: "slack",
      success: false,
      error: error instanceof Error ? error.message : "Failed to start Slack install",
    });
    return {
      success: false,
      error: error instanceof Error ? error.message : "Failed to start Slack install",
    };
  }
}

/**
 * Complete a Slack workspace install by claiming the bundle the api callback
 * parked under `state`. The connection (team_id → user, what the api's Slack
 * events webhook resolves against) lives server-side; the bot token never
 * reaches the desktop, so we only surface success/failure to the renderer.
 *
 * Called by the deep-link dispatcher (deeplink.ts) on
 * solomon-ai://oauth/slack/done?session=<state>&status=success.
 */
export async function completeSolomonSlackConnect(state: string): Promise<void> {
  try {
    console.log("[Slack] claiming workspace connection...");
    const workspace = await claimSlackWorkspaceViaBackend(state);
    invalidateCopilotInstructionsCache();
    const grantedScopes = workspace.scope?.split(/[ ,]+/).filter(Boolean);
    await recordRelationshipSourceAuthorization({
      provider: "slack",
      success: true,
      sourceAccountId: workspace.teamId,
      grantedScopes,
    });
    emitOAuthEvent({
      provider: "slack",
      success: true,
      sourceAccountId: workspace.teamId,
      grantedScopes,
    });
    console.log(`[Slack] workspace connected: ${workspace.teamName ?? workspace.teamId}`);
  } catch (error) {
    console.error("[Slack] failed to claim workspace connection:", error);
    await recordRelationshipSourceAuthorization({
      provider: "slack",
      success: false,
      error: error instanceof Error ? error.message : "Failed to claim Slack workspace",
    });
    emitOAuthEvent({
      provider: "slack",
      success: false,
      error: error instanceof Error ? error.message : "Failed to claim Slack workspace",
    });
  }
}

/**
 * Disconnect a provider (clear tokens)
 */
export async function disconnectProvider(provider: string): Promise<{ success: boolean }> {
  try {
    const oauthRepo = getOAuthRepo();

    // For Solomon AI-managed Google, best-effort revoke at Google before clearing
    // local state. Google's revoke endpoint accepts an unauthenticated POST
    // with the access_token; failure is logged but doesn't block disconnect.
    if (provider === "google") {
      const connection = await oauthRepo.read(provider);
      if (isManagedAuthMode(connection.mode) && connection.tokens?.access_token) {
        try {
          const revokeUrl = `https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(connection.tokens.access_token)}`;
          const res = await fetch(revokeUrl, { method: "POST", signal: AbortSignal.timeout(5000) });
          if (!res.ok) {
            console.warn(
              `[OAuth] Google revoke returned ${res.status}; continuing with local disconnect`,
            );
          }
        } catch (error) {
          console.warn("[OAuth] Google revoke failed; continuing with local disconnect:", error);
        }
      }
    }

    await oauthRepo.delete(provider);
    if (isProductProvider(provider)) {
      analyticsCapture("user_signed_out");
      analyticsReset();
    }
    // Notify renderer so sidebar, voice, and billing re-check state
    emitOAuthEvent({ provider, success: false });
    return { success: true };
  } catch (error) {
    console.error("OAuth disconnect failed:", error);
    return { success: false };
  }
}

/**
 * Startup migration for Google scope changes. When a connected Google grant was
 * issued before a scope was added (e.g. old installs on gmail.readonly that
 * never received gmail.modify), invalidate it so the user is prompted to
 * reconnect and re-grant with the current scopes. The currently-requested
 * scopes in the provider config are the source of truth: a grant missing any
 * of them is treated as stale.
 *
 * We revoke + clear the stale token but DELIBERATELY keep the provider entry
 * with an `error` set rather than calling disconnectProvider (which deletes the
 * whole entry). The renderer's reconnect prompts — the sidebar "Reconnect your
 * accounts" alert and the connectors "Reconnect" row — key off this `error`
 * field, not off the connected flag. A fully deleted entry has no error and is
 * indistinguishable from "never connected", so no prompt would ever appear.
 *
 * Tokens with no recorded scopes (very old installs that never persisted them)
 * are also treated as stale. Safe to call on every startup — it's a no-op once
 * the grant covers all current scopes, and once invalidated the early return on
 * the missing token keeps it from re-running until the user reconnects.
 */
export async function disconnectGoogleIfScopesStale(): Promise<void> {
  try {
    const oauthRepo = getOAuthRepo();
    const connection = await oauthRepo.read("google");

    // Not connected (or already invalidated) — nothing to migrate.
    if (!connection.tokens) {
      return;
    }

    const providerConfig = await getProviderConfig("google");
    const requiredScopes = providerConfig.scopes ?? [];
    if (requiredScopes.length === 0) {
      return;
    }

    const granted = new Set(connection.tokens.scopes ?? []);
    const missingScopes = requiredScopes.filter((scope) => !granted.has(scope));
    if (missingScopes.length === 0) {
      return;
    }

    console.log(
      `[OAuth] Google grant is missing current scopes [${missingScopes.join(", ")}]; ` +
        "invalidating it so the user is prompted to reconnect with the new scopes.",
    );

    // Best-effort revoke at Google for Solomon AI-managed grants (mirrors disconnectProvider).
    if (isManagedAuthMode(connection.mode) && connection.tokens.access_token) {
      try {
        const revokeUrl = `https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(connection.tokens.access_token)}`;
        const res = await fetch(revokeUrl, { method: "POST", signal: AbortSignal.timeout(5000) });
        if (!res.ok) {
          console.warn(
            `[OAuth] Google revoke returned ${res.status}; continuing with local invalidation`,
          );
        }
      } catch (error) {
        console.warn("[OAuth] Google revoke failed; continuing with local invalidation:", error);
      }
    }

    // Drop the stale token but keep the entry with an error so the reconnect
    // prompt fires (see the note above).
    await oauthRepo.upsert("google", {
      tokens: null,
      error: "Google permissions changed. Please reconnect to continue.",
    });

    // Nudge any already-open window to re-read state. The renderer's initial
    // mount also re-reads, so the prompt shows even if no window is up yet.
    emitOAuthEvent({ provider: "google", success: false });
  } catch (error) {
    console.error("[OAuth] Google scope migration check failed:", error);
  }
}

/**
 * Get access token for a provider (internal use only)
 * Refreshes token if expired
 */
export async function getAccessToken(provider: string): Promise<string | null> {
  try {
    const oauthRepo = getOAuthRepo();

    let { tokens } = await oauthRepo.read(provider);
    if (!tokens) {
      return null;
    }

    // Check if token needs refresh
    if (oauthClient.isTokenExpired(tokens)) {
      if (!tokens.refresh_token) {
        // No refresh token, need to reconnect
        await oauthRepo.upsert(provider, { error: "Missing refresh token. Please reconnect." });
        return null;
      }

      try {
        // Get configuration for refresh
        const config = await getProviderConfiguration(provider);

        // Refresh token, preserving existing scopes
        const existingScopes = tokens.scopes;
        const refreshedTokens = await oauthClient.refreshTokens(
          config,
          tokens.refresh_token,
          existingScopes,
        );
        await oauthRepo.upsert(provider, { tokens: refreshedTokens });
        tokens = refreshedTokens;
      } catch (error) {
        const message = error instanceof Error ? error.message : "Token refresh failed";
        await oauthRepo.upsert(provider, { error: message });
        console.error("Token refresh failed:", error);
        return null;
      }
    }

    return tokens.access_token;
  } catch (error) {
    console.error("Get access token failed:", error);
    return null;
  }
}

/**
 * Get list of available providers
 */
export function listProviders(): { providers: string[] } {
  return { providers: getAvailableProviders() };
}
